// Mock implementations
interface MockRequest {
    on: jest.Mock;
    write: jest.Mock;
    end: jest.Mock;
    abort: jest.Mock;
    removeAllListeners: jest.Mock;
    setHeader: jest.Mock;
}

const mockRequest: MockRequest = {
    on: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    abort: jest.fn(),
    removeAllListeners: jest.fn(),
    setHeader: jest.fn()
};

interface MockRemote {
    net: {
        request: jest.Mock;
    };
}

const mockRemote: MockRemote = {
    net: {
        request: jest.fn().mockReturnValue(mockRequest)
    }
};

jest.mock('electron', () => ({
    remote: mockRemote
}));

jest.mock('obsidian', () => ({
    Platform: {
        isMobileApp: false
    }
}));

// Simple mock for TransformStream
class MockTransformStream {
    readable: ReadableStream;
    writable: WritableStream;
    private chunks: Uint8Array[] = [];

    constructor() {
        this.writable = {
            getWriter: () => ({
                write: (chunk: Uint8Array) => {
                    this.chunks.push(chunk);
                    return Promise.resolve();
                },
                close: () => Promise.resolve(),
                abort: () => Promise.resolve(),
                releaseLock: () => {}
            })
        } as WritableStream;

        this.readable = {
            getReader: () => ({
                read: async () => {
                    const chunk = this.chunks.shift();
                    return chunk ? { done: false, value: chunk } : { done: true, value: undefined };
                },
                releaseLock: () => {}
            })
        } as ReadableStream;
    }
}

// Add to global if not available
if (typeof TransformStream === 'undefined') {
    (global as any).TransformStream = MockTransformStream;
}

if (typeof Response === 'undefined') {
    (global as any).Response = class {
        constructor(private readable: ReadableStream, public init: ResponseInit) {}
        
        async text() {
            const reader = this.readable.getReader();
            const { value } = await reader.read();
            reader.releaseLock();
            return new TextDecoder().decode(value);
        }
    };
}

if (typeof TextEncoder === 'undefined') {
    (global as any).TextEncoder = class {
        encode(text: string) {
            return Buffer.from(text);
        }
    };
}

if (typeof TextDecoder === 'undefined') {
    (global as any).TextDecoder = class {
        decode(buffer: Buffer) {
            return buffer.toString();
        }
    };
}

import { electronFetch } from './electronFetch';

describe('electronFetch', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset mock implementations
        mockRequest.on.mockReset();
        mockRequest.write.mockReset();
        mockRequest.end.mockReset();
        mockRequest.abort.mockReset();
        mockRequest.removeAllListeners.mockReset();
        mockRequest.setHeader.mockReset();
        mockRemote.net.request.mockReturnValue(mockRequest);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('Basic Request Handling', () => {
        it('should make a GET request successfully', async () => {
            const url = 'https://api.example.com';
            const mockResponseData = 'mock response';
            
            mockRequest.on.mockImplementation((event, callback) => {
                if (event === 'response') {
                    callback({
                        statusCode: 200,
                        headers: {},
                        on: (event: string, cb: (data?: Buffer) => void) => {
                            if (event === 'data') cb(Buffer.from(mockResponseData));
                            if (event === 'end') cb();
                        }
                    });
                }
                return mockRequest;
            });

            const response = await electronFetch(url, {
                headers: {}
            });
            
            expect(mockRemote.net.request).toHaveBeenCalledWith({
                url,
                method: 'GET'
            });
            
            expect(response).toBeInstanceOf(Response);
            const text = await response.text();
            expect(text).toBe(mockResponseData);
        });

        it('should make a POST request with body', async () => {
            const url = 'https://api.example.com';
            const body = JSON.stringify({ test: 'data' });
            const headers = { 'Content-Type': 'application/json' };
            const mockResponseData = 'mock response';
            
            mockRequest.on.mockImplementation((event, callback) => {
                if (event === 'response') {
                    callback({
                        statusCode: 200,
                        headers: {},
                        on: (event: string, cb: (data?: Buffer) => void) => {
                            if (event === 'data') cb(Buffer.from(mockResponseData));
                            if (event === 'end') cb();
                        }
                    });
                }
                return mockRequest;
            });

            const response = await electronFetch(url, {
                method: 'POST',
                body,
                headers
            });

            expect(mockRemote.net.request).toHaveBeenCalledWith({
                url,
                method: 'POST'
            });

            Object.entries(headers).forEach(([key, value]) => {
                expect(mockRequest.setHeader).toHaveBeenCalledWith(key, value);
            });

            expect(mockRequest.write).toHaveBeenCalledWith(body);
            expect(response).toBeInstanceOf(Response);
            const text = await response.text();
            expect(text).toBe(mockResponseData);
        });
    });

    describe('Error Handling', () => {
        it('should handle request errors', async () => {
            const url = 'https://api.example.com';
            const errorMessage = 'Network error';

            mockRequest.on.mockImplementation((event, callback) => {
                if (event === 'error') {
                    callback(new Error(errorMessage));
                }
                return mockRequest;
            });

            await expect(electronFetch(url, {
                headers: {}
            })).rejects.toThrow(errorMessage);
        });

        it('should handle timeout', async () => {
            const url = 'https://api.example.com';
            
            // Setup mock to call abort when error is triggered
            let errorCallback: ((error: Error) => void) | undefined;
            mockRequest.on.mockImplementation((event, callback) => {
                if (event === 'error') {
                    errorCallback = callback;
                }
                return mockRequest;
            });

            const controller = new AbortController();
            const fetchPromise = electronFetch.call({ controller }, url, {
                headers: {}
            });
            
            // Simulate timeout
            controller.abort();
            if (errorCallback) {
                errorCallback(new Error('Aborted'));
            }
            
            await expect(fetchPromise).rejects.toThrow('Aborted');
            expect(mockRequest.abort).toHaveBeenCalled();
        });

        it('should handle response errors', async () => {
            const url = 'https://api.example.com';
            const errorMessage = 'Response error';
            
            mockRequest.on.mockImplementation((event, callback) => {
                if (event === 'error') {
                    callback(new Error(errorMessage));
                }
                return mockRequest;
            });

            await expect(electronFetch(url, {
                headers: {}
            })).rejects.toThrow(errorMessage);
        });
    });

    describe('Abort Handling', () => {
        it('should handle abort signal', async () => {
            const url = 'https://api.example.com';
            const controller = new AbortController();
            
            // Setup mock to call abort when error is triggered
            let errorCallback: ((error: Error) => void) | undefined;
            mockRequest.on.mockImplementation((event, callback) => {
                if (event === 'error') {
                    errorCallback = callback;
                }
                return mockRequest;
            });
            
            const fetchPromise = electronFetch.call({ controller }, url, {
                headers: {}
            });
            
            // Ensure the request is created before aborting
            await Promise.resolve();
            controller.abort();
            if (errorCallback) {
                errorCallback(new Error('Aborted'));
            }
            
            await expect(fetchPromise).rejects.toThrow('Aborted');
            expect(mockRequest.abort).toHaveBeenCalled();
        });

        it('should handle pre-aborted signal', async () => {
            const url = 'https://api.example.com';
            const controller = new AbortController();
            controller.abort();
            
            // Setup mock to call abort when error is triggered
            let errorCallback: ((error: Error) => void) | undefined;
            mockRequest.on.mockImplementation((event, callback) => {
                if (event === 'error') {
                    errorCallback = callback;
                }
                return mockRequest;
            });
            
            const promise = electronFetch.call({ controller }, url, {
                headers: {}
            });
            
            if (errorCallback) {
                errorCallback(new Error('Aborted'));
            }
            
            await expect(promise).rejects.toThrow('Aborted');
            expect(mockRequest.abort).toHaveBeenCalled();
        });
    });

    describe('Platform Specific', () => {
        it('should use native fetch on mobile', async () => {
            const mockPlatform = { isMobileApp: true };
            jest.resetModules();
            jest.mock('obsidian', () => ({ Platform: mockPlatform }));
            
            const url = 'https://api.example.com';
            const mockResponse = new Response(new MockTransformStream().readable, { status: 200 });
            
            global.fetch = jest.fn().mockResolvedValue(mockResponse);
            
            // Re-import to get the updated module with mocked Platform
            const electronFetchModule = await import('./electronFetch');
            await electronFetchModule.electronFetch(url, {
                headers: {}
            });
            
            expect(global.fetch).toHaveBeenCalledWith(url, expect.any(Object));
        });
    });
}); 