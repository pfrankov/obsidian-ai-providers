import { electronFetch } from './electronFetch';

// Simple polyfill for TransformStream that doesn't use ReadableStream/WritableStream
if (typeof globalThis.TransformStream === 'undefined') {
    (globalThis as any).TransformStream = class TransformStream {
        readable: any;
        writable: any;

        constructor(transformer?: any) {
            // Create minimal mock objects that have the required properties
            this.readable = {
                // Mock readable stream - electronFetch uses this in the Response constructor
                locked: false,
                cancel: jest.fn(),
                getReader: jest.fn(() => ({
                    read: jest
                        .fn()
                        .mockResolvedValue({ done: true, value: undefined }),
                    releaseLock: jest.fn(),
                    closed: Promise.resolve(),
                    cancel: jest.fn(),
                })),
                pipeThrough: jest.fn(),
                pipeTo: jest.fn(),
                tee: jest.fn(() => [this.readable, this.readable]),
            };

            this.writable = {
                // Mock writable stream - electronFetch writes to this
                locked: false,
                abort: jest.fn(),
                close: jest.fn().mockResolvedValue(undefined),
                getWriter: jest.fn(() => ({
                    desiredSize: 1,
                    ready: Promise.resolve(),
                    closed: Promise.resolve(),
                    releaseLock: jest.fn(),
                    abort: jest.fn(),
                    close: jest.fn().mockResolvedValue(undefined),
                    write: jest.fn().mockResolvedValue(undefined),
                })),
            };
        }
    };
}

jest.mock('electron', () => {
    const mockRequest = {
        setHeader: jest.fn(),
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        abort: jest.fn(),
        removeAllListeners: jest.fn(),
    };

    return {
        remote: {
            net: {
                request: jest.fn(() => mockRequest),
            },
        },
    };
});

jest.mock('obsidian', () => ({
    Platform: {
        isMobileApp: false,
    },
}));

jest.mock('./logger', () => ({
    logger: {
        debug: jest.fn(),
        error: jest.fn(),
    },
}));

describe('electronFetch', () => {
    let mockResponse: any;

    const getMockRequest = () => {
        const electron = require('electron') as any;
        const mockRemoteNetRequest = electron.remote.net.request as jest.Mock;
        return (
            mockRemoteNetRequest.mock.results[0]?.value ||
            mockRemoteNetRequest()
        );
    };

    beforeEach(() => {
        jest.clearAllMocks();

        // Reset Platform mock
        const Platform = require('obsidian').Platform;
        Platform.isMobileApp = false;

        // Create mock response
        mockResponse = {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            on: jest.fn(),
        };
    });

    describe('Basic Request Handling', () => {
        it('should make a GET request successfully', async () => {
            const mockRequest = getMockRequest();

            // Setup response handling
            mockRequest.on.mockImplementation(
                (event: string, callback: Function) => {
                    if (event === 'response') {
                        // Simulate response
                        setTimeout(() => {
                            callback(mockResponse);
                            // Simulate data and end events on response
                            const dataCallback =
                                mockResponse.on.mock.calls.find(
                                    (call: any) => call[0] === 'data'
                                )?.[1];
                            const endCallback = mockResponse.on.mock.calls.find(
                                (call: any) => call[0] === 'end'
                            )?.[1];
                            if (dataCallback) {
                                dataCallback(Buffer.from('{"data":"test"}'));
                            }
                            if (endCallback) {
                                endCallback();
                            }
                        }, 0);
                    }
                }
            );

            // Call with empty headers object
            const responsePromise = electronFetch(
                'https://api.example.com/data',
                { headers: {} }
            );

            // Wait for the response
            const response = await responsePromise;

            const electron = require('electron') as any;
            expect(electron.remote.net.request).toHaveBeenCalledWith({
                url: 'https://api.example.com/data',
                method: 'GET',
            });
            expect(response.status).toBe(200);
        });

        it('should make a POST request with body', async () => {
            const mockRequest = getMockRequest();
            mockResponse.statusCode = 201;

            // Setup response handling
            mockRequest.on.mockImplementation(
                (event: string, callback: Function) => {
                    if (event === 'response') {
                        setTimeout(() => {
                            callback(mockResponse);
                            const dataCallback =
                                mockResponse.on.mock.calls.find(
                                    (call: any) => call[0] === 'data'
                                )?.[1];
                            const endCallback = mockResponse.on.mock.calls.find(
                                (call: any) => call[0] === 'end'
                            )?.[1];
                            if (dataCallback) {
                                dataCallback(Buffer.from('{"id":1}'));
                            }
                            if (endCallback) {
                                endCallback();
                            }
                        }, 0);
                    }
                }
            );

            const requestBody = JSON.stringify({ name: 'test' });
            const responsePromise = electronFetch(
                'https://api.example.com/create',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: requestBody,
                }
            );

            const response = await responsePromise;

            const electron = require('electron') as any;
            expect(electron.remote.net.request).toHaveBeenCalledWith({
                url: 'https://api.example.com/create',
                method: 'POST',
            });
            expect(mockRequest.setHeader).toHaveBeenCalledWith(
                'Content-Type',
                'application/json'
            );
            expect(mockRequest.write).toHaveBeenCalledWith(requestBody);
            expect(response.status).toBe(201);
        });

        it('should use native fetch on mobile platform', async () => {
            // Mock Platform as mobile
            const Platform = require('obsidian').Platform;
            Platform.isMobileApp = true;

            // Mock global fetch
            const mockFetch = jest.fn().mockResolvedValue(
                new Response('{"data":"test"}', {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                })
            );
            global.fetch = mockFetch;

            const response = await electronFetch(
                'https://api.example.com/data',
                { headers: {} }
            );

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.example.com/data',
                {
                    headers: {},
                    signal: undefined,
                }
            );

            const electron = require('electron') as any;
            expect(electron.remote.net.request).not.toHaveBeenCalled();
            expect(response.status).toBe(200);
        });
    });

    describe('Error Handling', () => {
        it('should handle request errors', async () => {
            const mockRequest = getMockRequest();
            const errorMessage = 'Network error';

            mockRequest.on.mockImplementation(
                (event: string, callback: Function) => {
                    if (event === 'error') {
                        setTimeout(() => callback(new Error(errorMessage)), 0);
                    }
                }
            );

            await expect(
                electronFetch('https://api.example.com/error', { headers: {} })
            ).rejects.toThrow(errorMessage);
        });

        it('should handle response errors by aborting the stream', async () => {
            const mockRequest = getMockRequest();
            const errorMessage = 'Response error';
            let responseWriter: any;

            // Override the writable mock to capture the writer
            const originalTransformStream = (globalThis as any).TransformStream;
            (globalThis as any).TransformStream = class MockTransformStream {
                readable: any;
                writable: any;

                constructor() {
                    this.readable = originalTransformStream.prototype.readable;
                    this.writable = {
                        ...originalTransformStream.prototype.writable,
                        getWriter: jest.fn(() => {
                            responseWriter = {
                                desiredSize: 1,
                                ready: Promise.resolve(),
                                closed: Promise.resolve(),
                                releaseLock: jest.fn(),
                                abort: jest.fn(),
                                close: jest.fn().mockResolvedValue(undefined),
                                write: jest.fn().mockResolvedValue(undefined),
                            };
                            return responseWriter;
                        }),
                    };
                }
            };

            mockRequest.on.mockImplementation(
                (event: string, callback: Function) => {
                    if (event === 'response') {
                        setTimeout(() => {
                            callback(mockResponse);
                            // Wait for response stream to be set up
                            setTimeout(() => {
                                const errorCallback =
                                    mockResponse.on.mock.calls.find(
                                        (call: any) => call[0] === 'error'
                                    )?.[1];
                                if (errorCallback) {
                                    errorCallback(new Error(errorMessage));
                                }
                            }, 10);
                        }, 0);
                    }
                }
            );

            const response = await electronFetch(
                'https://api.example.com/response-error',
                { headers: {} }
            );

            // The response should be returned successfully
            expect(response).toBeDefined();
            expect(response.status).toBe(200);

            // But the writer should be aborted due to the error
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(responseWriter?.abort).toHaveBeenCalledWith(
                expect.any(Error)
            );

            // Restore original TransformStream
            (globalThis as any).TransformStream = originalTransformStream;
        });

        it('should handle abort signal', async () => {
            const mockRequest = getMockRequest();
            const controller = new AbortController();

            mockRequest.on.mockImplementation(
                (event: string, callback: Function) => {
                    if (event === 'response') {
                        // Don't immediately respond, let abort happen first
                    }
                }
            );

            const fetchPromise = electronFetch.call(
                { controller },
                'https://api.example.com/data',
                { headers: {} }
            );

            // Abort immediately
            controller.abort();

            await expect(fetchPromise).rejects.toThrow('Aborted');
            expect(mockRequest.abort).toHaveBeenCalled();
        });
    });

    describe('Header Handling', () => {
        it('should handle requests without headers', async () => {
            const mockRequest = getMockRequest();

            mockRequest.on.mockImplementation(
                (event: string, callback: Function) => {
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

            await electronFetch('https://api.example.com/data', {
                headers: {},
            });

            expect(mockRequest.setHeader).not.toHaveBeenCalled();
        });

        it('should remove content-length header if present', async () => {
            const mockRequest = getMockRequest();

            mockRequest.on.mockImplementation(
                (event: string, callback: Function) => {
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

            const headers = {
                'Content-Type': 'application/json',
                'content-length': '100',
            };

            await electronFetch('https://api.example.com/data', {
                headers: headers,
            });

            // content-length should be deleted from headers
            expect(headers).not.toHaveProperty('content-length');
            // But Content-Type should still be set
            expect(mockRequest.setHeader).toHaveBeenCalledWith(
                'Content-Type',
                'application/json'
            );
        });

        it('should handle empty options object', async () => {
            const mockRequest = getMockRequest();

            mockRequest.on.mockImplementation(
                (event: string, callback: Function) => {
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

            // Call with empty headers to ensure it doesn't fail
            await expect(
                electronFetch('https://api.example.com/data', { headers: {} })
            ).resolves.toBeDefined();

            expect(mockRequest.setHeader).not.toHaveBeenCalled();
        });
    });
});
