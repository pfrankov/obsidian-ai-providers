// Mock implementations
interface MockRequest {
    on: jest.Mock;
    write: jest.Mock;
    end: jest.Mock;
    abort: jest.Mock;
    removeAllListeners: jest.Mock;
}

const mockRequest: MockRequest = {
    on: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    abort: jest.fn(),
    removeAllListeners: jest.fn(),
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

            const response = await electronFetch.call({}, url);
            
            expect(mockRemote.net.request).toHaveBeenCalledWith({
                url,
                method: 'GET',
                headers: undefined,
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

            const response = await electronFetch.call({}, url, {
                method: 'POST',
                body,
                headers,
            });

            expect(mockRemote.net.request).toHaveBeenCalledWith({
                url,
                method: 'POST',
                headers,
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

            await expect(electronFetch.call({}, url)).rejects.toThrow(errorMessage);
        });

        it('should handle timeout', async () => {
            const url = 'https://api.example.com';
            jest.useFakeTimers();
            
            // Don't trigger any events to simulate timeout
            mockRequest.on.mockReturnValue(mockRequest);

            const fetchPromise = electronFetch.call({}, url);
            jest.advanceTimersByTime(11000); // Advance past the 10 second timeout

            await expect(fetchPromise).rejects.toThrow('Request timeout');
            jest.useRealTimers();
        }, 1000);

        it('should handle response errors', async () => {
            const url = 'https://api.example.com';
            const errorMessage = 'Response error';
            
            // Mock the request error instead of response error
            mockRequest.on.mockImplementation((event, callback) => {
                if (event === 'error') {
                    callback(new Error(errorMessage));
                }
                return mockRequest;
            });

            await expect(electronFetch.call({}, url)).rejects.toThrow(errorMessage);
        });
    });

    describe('Abort Handling', () => {
        it('should handle abort signal', async () => {
            const url = 'https://api.example.com';
            const controller = new AbortController();
            
            mockRequest.on.mockImplementation((event, callback) => {
                if (event === 'error') {
                    callback(new Error('Aborted'));
                }
                return mockRequest;
            });
            
            const fetchPromise = electronFetch.call({ controller }, url);
            controller.abort();
            
            await expect(fetchPromise).rejects.toThrow('Aborted');
            expect(mockRequest.abort).toHaveBeenCalled();
        });

        it('should handle pre-aborted signal', async () => {
            const url = 'https://api.example.com';
            const controller = new AbortController();
            controller.abort();
            
            await expect(electronFetch.call({ controller }, url)).rejects.toThrow('Aborted');
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
            
            const { electronFetch } = require('./electronFetch');
            await electronFetch(url);
            
            expect(global.fetch).toHaveBeenCalledWith(url, expect.any(Object));
        });
    });
}); 