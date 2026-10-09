import { EventEmitter } from 'node:events';
import { TransformStream } from 'node:stream/web';
import { inspect } from 'node:util';
import { Platform, requestUrl } from 'obsidian';
import * as electron from 'electron';
import { electronFetch } from './electronFetch';
import { obsidianFetch } from './obsidianFetch';
import { logger } from './logger';

vi.mock('electron', () => ({ remote: { net: { request: vi.fn() } } }));
vi.mock('obsidian', () => ({
    requestUrl: vi.fn(),
    Platform: { isMobileApp: false },
}));

const url = 'https://example.com/chat';
const headers = {
    Authorization: 'Bearer synthetic-credential',
    'x-custom-token': 'synthetic-custom-header',
};
const body = JSON.stringify({ prompt: 'synthetic-private-prompt' });
const responseHeaders = { 'x-private-header': 'synthetic-response-header' };
const responseText = 'synthetic-response-body';
const options = { method: 'POST', headers, body };
const { remote } = electron as any;

// Exercise the real logger: a mocked logger cannot prove what reaches console.
describe('transport logging with chunk logging disabled', () => {
    let logs: unknown[][];
    let enabled: boolean;
    let chunkLoggingEnabled: boolean;

    beforeEach(() => {
        enabled = logger.isEnabled();
        chunkLoggingEnabled = logger.isChunkLoggingEnabled();
        logger.configure({ enabled: true, chunkLoggingEnabled: false });
        logs = [];
        for (const method of ['log', 'info', 'warn', 'error'] as const) {
            vi.spyOn(console, method).mockImplementation((...args) => {
                logs.push(args);
            });
        }
        vi.stubGlobal('TransformStream', TransformStream);
        Platform.isMobileApp = false;
    });

    afterEach(() => {
        logger.configure({ enabled, chunkLoggingEnabled });
        Platform.isMobileApp = false;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function expectMetadataOnly() {
        const output = inspect(logs, { depth: null });
        for (const value of [
            ...Object.values(headers),
            body,
            'synthetic-private-prompt',
            ...Object.values(responseHeaders),
            responseText,
        ]) {
            expect(output).not.toContain(value);
        }
        expect(output).toContain('POST');
        expect(output).toContain('hasBody: true');
    }

    it.each([200, 401, 429])(
        'preserves Obsidian HTTP %i data without logging raw headers or bodies',
        async status => {
            vi.mocked(requestUrl).mockResolvedValue({
                status,
                headers: responseHeaders,
                text: responseText,
            } as any);

            const response = await obsidianFetch(url, options);

            expect(requestUrl).toHaveBeenLastCalledWith({
                url,
                ...options,
                throw: false,
            });
            expect(response.status).toBe(status);
            expect(response.headers.get('x-private-header')).toBe(
                responseHeaders['x-private-header']
            );
            expect(await response.text()).toBe(responseText);
            expectMetadataOnly();
            expect(inspect(logs)).toContain(`status: ${status}`);
            expect(inspect(logs)).toContain(
                `contentLength: ${responseText.length}`
            );
        }
    );

    it('preserves Obsidian transport failures without appending request headers', async () => {
        const error = new Error('Synthetic network failure');
        vi.mocked(requestUrl).mockRejectedValue(error);

        await expect(obsidianFetch(url, options)).rejects.toBe(error);

        expect(requestUrl).toHaveBeenLastCalledWith({
            url,
            ...options,
            throw: false,
        });
        expectMetadataOnly();
        expect(logs).toContainEqual([
            expect.any(String),
            'Request failed:',
            error,
        ]);
    });

    function mockDesktop() {
        const request = Object.assign(new EventEmitter(), {
            setHeader: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
            abort: vi.fn(),
        });
        remote.net.request.mockReturnValue(request);
        return request;
    }

    function expectDesktopRequest(request: ReturnType<typeof mockDesktop>) {
        expect(remote.net.request).toHaveBeenLastCalledWith({
            url,
            method: 'POST',
        });
        for (const [name, value] of Object.entries(headers)) {
            expect(request.setHeader).toHaveBeenCalledWith(name, value);
        }
        expect(request.write).toHaveBeenCalledExactlyOnceWith(body);
        expect(request.end).toHaveBeenCalledOnce();
        expectMetadataOnly();
        expect(inspect(logs)).toContain("platform: 'desktop'");
    }

    it.each([200, 401])(
        'preserves Electron HTTP %i data without logging raw headers or bodies',
        async status => {
            const request = mockDesktop();
            const incoming = Object.assign(new EventEmitter(), {
                statusCode: status,
                headers: responseHeaders,
            });
            const pending = electronFetch(url, options);
            request.emit('response', incoming);
            const response = await pending;
            const text = response.text();
            incoming.emit('data', Buffer.from(responseText));
            incoming.emit('end');

            expect(await text).toBe(responseText);
            await Promise.resolve();
            expect(response.status).toBe(status);
            expect(response.headers.get('x-private-header')).toBe(
                responseHeaders['x-private-header']
            );
            expectDesktopRequest(request);
            expect(inspect(logs)).toContain(`status: ${status}`);
            expect(inspect(logs)).toContain('Response stream completed');
        }
    );

    it('preserves Electron transport error identity', async () => {
        const request = mockDesktop();
        const error = new Error('Synthetic network failure');
        const pending = electronFetch(url, options);
        request.emit('error', error);

        await expect(pending).rejects.toBe(error);
        expectDesktopRequest(request);
        expect(request.abort).toHaveBeenCalledOnce();
    });

    it('preserves Electron response failures without logging response headers', async () => {
        const request = mockDesktop();
        const incoming = Object.assign(new EventEmitter(), {
            statusCode: 200,
            headers: responseHeaders,
        });
        const pending = electronFetch(url, options);
        request.emit('response', incoming);
        const response = await pending;
        const text = response.text();
        const error = new Error('Synthetic response failure');
        incoming.emit('error', error);

        await expect(text).rejects.toBe(error);
        expectDesktopRequest(request);
        expect(request.abort).toHaveBeenCalledOnce();
    });

    it('preserves the mobile fetch request and response', async () => {
        Platform.isMobileApp = true;
        const response = new Response(responseText, {
            headers: responseHeaders,
        });
        const fetchMock = vi.fn().mockResolvedValue(response);
        vi.stubGlobal('fetch', fetchMock);

        await expect(electronFetch(url, options)).resolves.toBe(response);

        expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url, {
            ...options,
            signal: undefined,
        });
        expectMetadataOnly();
        expect(inspect(logs)).toContain("platform: 'mobile'");
    });

    it('still suppresses transport logs when debug logging is disabled', async () => {
        logger.setEnabled(false);
        vi.mocked(requestUrl).mockResolvedValue({
            status: 200,
            headers: responseHeaders,
            text: responseText,
        } as any);

        await obsidianFetch(url, options);

        expect(logs).toEqual([]);
    });
});
