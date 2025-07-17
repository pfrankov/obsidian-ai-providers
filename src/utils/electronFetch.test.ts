import { electronFetch } from './electronFetch';

// Simple polyfill for TransformStream
if (typeof globalThis.TransformStream === 'undefined') {
    (globalThis as any).TransformStream = class TransformStream {
        readable: any;
        writable: any;

        constructor() {
            this.readable = {
                locked: false,
                getReader: jest.fn(() => ({
                    read: jest
                        .fn()
                        .mockResolvedValue({ done: true, value: undefined }),
                    releaseLock: jest.fn(),
                })),
            };

            this.writable = {
                locked: false,
                getWriter: jest.fn(() => ({
                    write: jest.fn().mockResolvedValue(undefined),
                    close: jest.fn().mockResolvedValue(undefined),
                    abort: jest.fn(),
                    releaseLock: jest.fn(),
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

jest.mock('./logger');

jest.mock('obsidian', () => ({
    Platform: { isMobileApp: false },
}));

describe('electronFetch', () => {
    let mockResponse: any;

    const getMockRequest = () => {
        const electron = require('electron') as any;
        return electron.remote.net.request();
    };

    beforeEach(() => {
        jest.clearAllMocks();

        mockResponse = {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            on: jest.fn(),
        };
    });

    it('should make a GET request successfully', async () => {
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

        const response = await electronFetch('https://api.example.com/data', {
            headers: {},
        });

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

    it('should handle abort signal', async () => {
        const mockRequest = getMockRequest();
        const controller = new AbortController();

        // Mock the request to simulate a long-running operation
        mockRequest.on.mockImplementation(
            (event: string, callback: Function) => {
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
});
