import { EventEmitter } from 'node:events';
import { TransformStream } from 'node:stream/web';
import * as electron from 'electron';
import { electronFetch } from './electronFetch';

vi.mock('electron', () => ({ remote: { net: { request: vi.fn() } } }));
vi.mock('obsidian', () => ({ Platform: { isMobileApp: false } }));
vi.mock('./logger');

const { remote } = electron as any;

// Unlike the writer stubs in the unit tests, this fixture exercises real body
// reads, pending reads and consumer cancellation through a WHATWG stream.
describe('electronFetch stream lifecycle', () => {
    let incoming: EventEmitter & { statusCode: number; headers: object };
    let request: EventEmitter & {
        setHeader: ReturnType<typeof vi.fn>;
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
        abort: ReturnType<typeof vi.fn>;
    };
    let controller: AbortController;
    let removeListener: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.stubGlobal('TransformStream', TransformStream);
        incoming = Object.assign(new EventEmitter(), {
            statusCode: 200,
            headers: { 'content-type': 'text/plain' },
        });
        request = Object.assign(new EventEmitter(), {
            setHeader: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
            abort: vi.fn(() => {
                request.emit('abort');
                incoming.emit('aborted');
                queueMicrotask(() => request.emit('close'));
            }),
        });
        remote.net.request.mockReturnValue(request);
        controller = new AbortController();
        removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    const startFetch = () =>
        electronFetch('http://localhost:11434/api/chat', {
            signal: controller.signal,
        });

    const startResponse = async () => {
        const pending = startFetch();
        request.emit('response', incoming);
        return pending;
    };

    // A bounded race reports a hang as a normal assertion failure instead of
    // waiting for the global test timeout. Pending streams have no open handles.
    const rejection = async (pending: Promise<unknown>) => {
        let timer: ReturnType<typeof setTimeout>;
        try {
            return await Promise.race([
                pending.then(
                    () => 'resolved',
                    (error: Error) => error.message
                ),
                new Promise<string>(resolve => {
                    timer = setTimeout(() => resolve('pending'), 100);
                }),
            ]);
        } finally {
            clearTimeout(timer!);
        }
    };

    it('rejects abort before headers and removes its signal listener', async () => {
        const addListener = vi.spyOn(controller.signal, 'addEventListener');
        const pending = startFetch();
        controller.abort();
        await expect(pending).rejects.toThrow('Aborted');
        expect(request.abort).toHaveBeenCalledTimes(1);
        expect(removeListener).toHaveBeenCalledWith(
            'abort',
            addListener.mock.calls[0][1]
        );
    });

    it('rejects a pending body read when aborted after headers', async () => {
        const response = await startResponse();
        const pending = response.body!.getReader().read();
        controller.abort();
        expect(await rejection(pending)).toBe('Aborted');
        expect(removeListener).toHaveBeenCalledWith(
            'abort',
            expect.any(Function)
        );
    });

    it('preserves received bytes and rejects abort between chunks only once', async () => {
        const response = await startResponse();
        const reader = response.body!.getReader();
        const first = reader.read();
        incoming.emit('data', Buffer.from('hello'));
        expect(new TextDecoder().decode((await first).value)).toBe('hello');
        const pending = reader.read();
        controller.abort();
        controller.abort();
        expect(await rejection(pending)).toBe('Aborted');
        expect(request.abort).toHaveBeenCalledTimes(1);
    });

    it('rejects an Electron response aborted event without end or error', async () => {
        const response = await startResponse();
        const pending = response.body!.getReader().read();
        incoming.emit('aborted');
        request.emit('close');
        expect(await rejection(pending)).toBe('Aborted');
    });

    it('cancels the native request when the response body is cancelled', async () => {
        const response = await startResponse();
        await response.body!.cancel('consumer stopped');
        expect(request.abort).toHaveBeenCalledTimes(1);
        expect(removeListener).toHaveBeenCalledWith(
            'abort',
            expect.any(Function)
        );
        controller.abort();
        expect(request.abort).toHaveBeenCalledTimes(1);
    });

    it('cancels the native request with a reader and pending buffered write', async () => {
        const response = await startResponse();
        const reader = response.body!.getReader();
        incoming.emit('data', Buffer.from('unread'));
        await reader.cancel();
        await vi.waitFor(() => expect(request.abort).toHaveBeenCalledTimes(1));
    });

    it('preserves a request error before headers and removes the signal listener', async () => {
        const pending = startFetch();
        request.emit('error', new Error('connection failed'));
        request.emit('close');
        await expect(pending).rejects.toThrow('connection failed');
        expect(removeListener).toHaveBeenCalledWith(
            'abort',
            expect.any(Function)
        );
    });

    it('propagates a late request error to an already returned body', async () => {
        const response = await startResponse();
        const pending = response.body!.getReader().read();
        request.emit('error', new Error('late request failure'));
        expect(await rejection(pending)).toBe('late request failure');
    });

    it('preserves response errors on a pending reader', async () => {
        const response = await startResponse();
        const pending = response.body!.getReader().read();
        incoming.emit('error', new Error('connection reset'));
        request.emit('close');
        expect(await rejection(pending)).toBe('connection reset');
        expect(removeListener).toHaveBeenCalledWith(
            'abort',
            expect.any(Function)
        );
    });

    it.each(['response-first', 'request-first'])(
        'handles paired native errors (%s) until close',
        async order => {
            const response = await startResponse();
            const pending = response.body!.getReader().read();
            const first = order === 'response-first' ? incoming : request;
            const second = order === 'response-first' ? request : incoming;
            first.emit('error', new Error('first native failure'));
            expect(() =>
                second.emit('error', new Error('second native failure'))
            ).not.toThrow();
            expect(await rejection(pending)).toBe('first native failure');
            expect(request.abort).toHaveBeenCalledTimes(1);
            request.emit('close');
            // A companion error may still arrive after writable close.
            expect(() =>
                request.emit('error', new Error('late error'))
            ).not.toThrow();
            expect(removeListener).toHaveBeenCalledWith(
                'abort',
                expect.any(Function)
            );
        }
    );

    it('aborts an unread body while normal end is waiting for queued writes', async () => {
        const response = await startResponse();
        incoming.emit('data', Buffer.from('unread'));
        incoming.emit('end');
        request.emit('close');
        controller.abort();
        expect(await rejection(response.text())).toBe('Aborted');
    });

    it('keeps response delivery after the native writable request closes', async () => {
        const pending = startFetch();
        request.emit('finish');
        request.emit('close');
        request.emit('response', incoming);
        incoming.emit('data', Buffer.from('after upload close'));
        incoming.emit('end');
        const body = pending.then(response => response.text());
        expect(await rejection(body)).toBe('resolved');
        expect(await body).toBe('after upload close');
    });

    it('handles a late native request error after writable close', async () => {
        const pending = startFetch();
        request.emit('finish');
        request.emit('close');
        request.emit('error', new Error('failure after upload close'));
        await expect(pending).rejects.toThrow('failure after upload close');
    });

    it('drains multiple queued chunks in order for a delayed consumer', async () => {
        const response = await startResponse();
        incoming.emit('data', Buffer.from('one'));
        incoming.emit('data', Buffer.from('two'));
        incoming.emit('data', Buffer.from('three'));
        incoming.emit('end');
        request.emit('close');
        await Promise.resolve();
        expect(await response.text()).toBe('onetwothree');
    });

    it('registers terminal response events before starting data flow', async () => {
        const on = vi.spyOn(incoming, 'on');
        const response = await startResponse();
        const events = on.mock.calls.map(([event]) => event);
        expect(events.indexOf('end')).toBeLessThan(events.indexOf('data'));
        expect(events.indexOf('error')).toBeLessThan(events.indexOf('data'));
        expect(events.indexOf('aborted')).toBeLessThan(events.indexOf('data'));
        incoming.emit('end');
        request.emit('close');
        expect(await response.text()).toBe('');
    });

    it('drains data on normal end and close, then detaches cancellation', async () => {
        const response = await startResponse();
        const text = response.text();
        incoming.emit('data', Buffer.from('one'));
        incoming.emit('data', Buffer.from('two'));
        incoming.emit('end');
        request.emit('close');
        expect(await text).toBe('onetwo');
        // The end listener awaits writer.close before running cleanup.
        await Promise.resolve();
        expect(removeListener).toHaveBeenCalledWith(
            'abort',
            expect.any(Function)
        );
        controller.abort();
        expect(request.abort).not.toHaveBeenCalled();
    });
});
