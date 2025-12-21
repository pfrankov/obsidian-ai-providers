import * as electron from 'electron';
import { Platform } from 'obsidian';
import { electronFetch } from './electronFetch';

const { remote } = electron as any;

// Simple polyfill for TransformStream
if (typeof globalThis.TransformStream === 'undefined') {
    (globalThis as any).TransformStream = class TransformStream {
        readable: any;
        writable: any;

        constructor() {
            this.readable = {
                locked: false,
                getReader: vi.fn(() => ({
                    read: vi
                        .fn()
                        .mockResolvedValue({ done: true, value: undefined }),
                    releaseLock: vi.fn(),
                })),
            };

            this.writable = {
                locked: false,
                getWriter: vi.fn(() => ({
                    write: vi.fn().mockResolvedValue(undefined),
                    close: vi.fn().mockResolvedValue(undefined),
                    abort: vi.fn(),
                    releaseLock: vi.fn(),
                })),
            };
        }
    };
}

vi.mock('electron', () => {
    const mockRequest = {
        setHeader: vi.fn(),
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        abort: vi.fn(),
        removeAllListeners: vi.fn(),
    };

    return {
        remote: {
            net: {
                request: vi.fn(() => mockRequest),
            },
        },
    };
});

vi.mock('./logger');

vi.mock('obsidian', () => ({
    Platform: { isMobileApp: false },
}));

describe('electronFetch', () => {
    let mockResponse: any;
    let originalTransformStream: typeof TransformStream | undefined;

    const getMockRequest = () => remote.net.request();

    beforeEach(() => {
        vi.clearAllMocks();
        originalTransformStream = globalThis.TransformStream;

        mockResponse = {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            on: vi.fn(),
        };
    });

    afterEach(() => {
        if (originalTransformStream) {
            globalThis.TransformStream = originalTransformStream;
        }
        (Platform as any).isMobileApp = false;
    });

    it('should make a GET request successfully', async () => {
        const mockRequest = getMockRequest();

        mockRequest.on.mockImplementation(
            (event: string, callback: (...args: any[]) => void) => {
                if (event === 'response') {
                    setTimeout(() => {
                        callback(mockResponse);
                        const endCallback = mockResponse.on.mock.calls.find(
                            (call: any) => call[0] === 'end'
                        )?.[1];
                        if (endCallback) {
                            endCallback();
                        }
                    }, 0);
                }
            }
        );

        const response = await electronFetch('https://api.example.com/data', {
            headers: {},
        });

        expect(remote.net.request).toHaveBeenCalledWith({
            url: 'https://api.example.com/data',
            method: 'GET',
        });
        expect(response.status).toBe(200);
    });

    it('defaults status to 200 when response has no statusCode', async () => {
        const mockRequest = getMockRequest();
        mockResponse.statusCode = undefined;

        mockRequest.on.mockImplementation(
            (event: string, callback: (...args: any[]) => void) => {
                if (event === 'response') {
                    setTimeout(() => {
                        callback(mockResponse);
                        const endCallback = mockResponse.on.mock.calls.find(
                            (call: any) => call[0] === 'end'
                        )?.[1];
                        if (endCallback) {
                            endCallback();
                        }
                    }, 0);
                }
            }
        );

        const response = await electronFetch('https://api.example.com/data', {
            headers: {},
        });

        expect(response.status).toBe(200);
    });

    it('should make a POST request with body', async () => {
        const mockRequest = getMockRequest();
        mockResponse.statusCode = 201;

        mockRequest.on.mockImplementation(
            (event: string, callback: (...args: any[]) => void) => {
                if (event === 'response') {
                    setTimeout(() => {
                        callback(mockResponse);
                        const endCallback = mockResponse.on.mock.calls.find(
                            (call: any) => call[0] === 'end'
                        )?.[1];
                        if (endCallback) {
                            endCallback();
                        }
                    }, 0);
                }
            }
        );

        const requestBody = JSON.stringify({ name: 'test' });
        const response = await electronFetch('https://api.example.com/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: requestBody,
        });

        expect(mockRequest.setHeader).toHaveBeenCalledWith(
            'Content-Type',
            'application/json'
        );
        expect(mockRequest.write).toHaveBeenCalledWith(requestBody);
        expect(response.status).toBe(201);
    });

    it('should handle request errors', async () => {
        const mockRequest = getMockRequest();
        const errorMessage = 'Network error';

        mockRequest.on.mockImplementation(
            (event: string, callback: (...args: any[]) => void) => {
                if (event === 'error') {
                    setTimeout(() => callback(new Error(errorMessage)), 0);
                }
            }
        );

        await expect(
            electronFetch('https://api.example.com/error', { headers: {} })
        ).rejects.toThrow(errorMessage);
    });

    it('should handle abort signal', async () => {
        const mockRequest = getMockRequest();
        const controller = new AbortController();

        // Mock the request to simulate a long-running operation
        mockRequest.on.mockImplementation(
            (event: string, callback: (...args: any[]) => void) => {
                if (event === 'response') {
                    // Don't call the callback immediately to simulate pending request
                    setTimeout(() => {
                        callback(mockResponse);
                    }, 100);
                }
            }
        );

        const fetchPromise = electronFetch('https://api.example.com/data', {
            headers: {},
            signal: controller.signal,
        });

        // Abort the request after a short delay
        setTimeout(() => controller.abort(), 10);

        await expect(fetchPromise).rejects.toThrow();
        expect(mockRequest.abort).toHaveBeenCalled();
    }, 10000);

    it('uses native fetch on mobile platform', async () => {
        (Platform as any).isMobileApp = true;
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('ok'));

        const response = await electronFetch('https://api.example.com/mobile', {
            headers: {},
        });

        expect(fetchSpy).toHaveBeenCalled();
        expect(await response.text()).toBe('ok');
        fetchSpy.mockRestore();
    });

    it('rejects when request is already aborted', async () => {
        const mockRequest = getMockRequest();
        const controller = new AbortController();
        controller.abort();

        await expect(
            electronFetch('https://api.example.com/abort', {
                signal: controller.signal,
            })
        ).rejects.toThrow('Aborted');
        expect(mockRequest.abort).toHaveBeenCalled();
    });

    it('uses controller from context when provided', async () => {
        const mockRequest = getMockRequest();
        const controller = new AbortController();

        const promise = electronFetch.call(
            { controller },
            'https://api.example.com/data',
            { headers: {} }
        );

        controller.abort();
        await expect(promise).rejects.toThrow('Aborted');
        expect(mockRequest.abort).toHaveBeenCalled();
    });

    it('ignores response when aborted before response handler', async () => {
        const mockRequest = getMockRequest();
        const controller = new AbortController();

        mockRequest.on.mockImplementation(
            (event: string, callback: (...args: any[]) => void) => {
                if (event === 'response') {
                    setTimeout(() => {
                        callback(mockResponse);
                    }, 0);
                }
            }
        );

        const promise = electronFetch('https://api.example.com/data', {
            headers: {},
            signal: controller.signal,
        });

        controller.abort();

        await expect(promise).rejects.toThrow('Aborted');
        expect(mockResponse.on).not.toHaveBeenCalled();
    });

    it('streams data through transform', async () => {
        const mockRequest = getMockRequest();
        const handlers = new Map<string, (...args: any[]) => void>();
        const enqueueSpy = vi.fn();
        const writer = {
            ready: Promise.resolve(),
            write: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            abort: vi.fn(),
        };

        globalThis.TransformStream = class {
            readable = { locked: false, getReader: vi.fn() };
            writable = {
                locked: false,
                getWriter: vi.fn(() => ({
                    ...writer,
                    write: vi.fn(async (chunk: any) => {
                        if (this.transform) {
                            this.transform(chunk, { enqueue: enqueueSpy });
                        }
                    }),
                })),
            };
            transform?: (
                chunk: any,
                controller: { enqueue: (data: any) => void }
            ) => void;

            constructor({
                transform,
            }: {
                transform: (
                    chunk: any,
                    controller: { enqueue: (data: any) => void }
                ) => void;
            }) {
                this.transform = transform;
            }
        } as any;

        mockResponse.on.mockImplementation(
            (event: string, callback: (...args: any[]) => void) => {
                handlers.set(event, callback);
            }
        );

        mockRequest.on.mockImplementation(
            (event: string, callback: (...args: any[]) => void) => {
                if (event === 'response') {
                    callback(mockResponse);
                    const dataHandler = handlers.get('data');
                    dataHandler?.(Buffer.from('hello'));
                    const endHandler = handlers.get('end');
                    endHandler?.();
                }
            }
        );

        const response = await electronFetch('https://api.example.com/data', {
            headers: {},
        });

        expect(response).toBeInstanceOf(Response);
        expect(enqueueSpy).toHaveBeenCalled();
    });

    it('handles response error events', async () => {
        const mockRequest = getMockRequest();
        const error = new Error('response error');
        const handlers = new Map<string, (...args: any[]) => void>();

        mockResponse.on.mockImplementation(
            (event: string, callback: (...args: any[]) => void) => {
                handlers.set(event, callback);
            }
        );

        mockRequest.on.mockImplementation(
            (event: string, callback: (...args: any[]) => void) => {
                if (event === 'response') {
                    callback(mockResponse);
                    const responseError = handlers.get('error');
                    responseError?.(error);
                }
            }
        );

        const response = await electronFetch('https://api.example.com/data', {
            headers: {},
        });

        expect(response).toBeInstanceOf(Response);
    });

    it('handles stream write and close errors', async () => {
        const mockRequest = getMockRequest();
        const error = new Error('write failed');
        const handlers = new Map<string, (...args: any[]) => void>();
        const writer = {
            ready: Promise.resolve(),
            write: vi.fn().mockRejectedValue(error),
            close: vi.fn().mockRejectedValue(new Error('close failed')),
            abort: vi.fn(),
        };

        globalThis.TransformStream = class {
            readable = { locked: false, getReader: vi.fn() };
            writable = {
                locked: false,
                getWriter: vi.fn(() => writer),
            };
        } as any;

        mockResponse.on.mockImplementation(
            (event: string, callback: (...args: any[]) => void) => {
                handlers.set(event, callback);
            }
        );

        mockRequest.on.mockImplementation(
            (event: string, callback: (...args: any[]) => void) => {
                if (event === 'response') {
                    callback(mockResponse);
                    const dataHandler = handlers.get('data');
                    dataHandler?.(Buffer.from('chunk'));
                    const endHandler = handlers.get('end');
                    endHandler?.();
                }
            }
        );

        const response = await electronFetch('https://api.example.com/data', {
            headers: {},
        });

        expect(response).toBeInstanceOf(Response);
        expect(writer.write).toHaveBeenCalled();
        expect(writer.abort).toHaveBeenCalled();
        expect(writer.close).toHaveBeenCalled();
    });
});
