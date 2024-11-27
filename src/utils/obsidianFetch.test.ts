import { RequestUrlResponse } from "obsidian";
import { obsidianFetch } from './obsidianFetch';

jest.mock('obsidian', () => {
    return {
        requestUrl: jest.fn()
    };
});

// Mock Response if not available in test environment
if (typeof Response === 'undefined') {
    (global as any).Response = class {
        public status: number;
        public headers: Record<string, string>;
        private body: string;

        constructor(body: string, init: ResponseInit) {
            this.body = body;
            this.status = init.status || 200;
            this.headers = init.headers as Record<string, string>;
        }
        
        async text() {
            return this.body;
        }
    };
}

describe('obsidianFetch', () => {
    let requestUrlMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        requestUrlMock = jest.requireMock('obsidian').requestUrl;
    });

    describe('Basic Request Handling', () => {
        it('should make a GET request successfully', async () => {
            const mockResponseData = 'mock response';
            const mockResponse: Partial<RequestUrlResponse> = {
                status: 200,
                text: mockResponseData,
                headers: { 'content-type': 'text/plain' },
            };
            
            requestUrlMock.mockResolvedValue(mockResponse);

            const url = 'https://api.example.com';
            const response = await obsidianFetch(url, { headers: {} });

            expect(requestUrlMock).toHaveBeenCalledWith({
                url,
                method: 'GET',
                headers: {},
            });

            expect(response).toBeInstanceOf(Response);
            const text = await response.text();
            expect(text).toBe(mockResponseData);
        });

        it('should make a POST request with JSON body', async () => {
            const mockResponseData = 'mock response';
            const mockResponse: Partial<RequestUrlResponse> = {
                status: 200,
                text: mockResponseData,
                headers: { 'content-type': 'application/json' },
            };
            
            requestUrlMock.mockResolvedValue(mockResponse);

            const url = 'https://api.example.com';
            const body = { test: 'data' };
            const headers = { 'Content-Type': 'application/json' };

            const response = await obsidianFetch(url, {
                method: 'POST',
                body: JSON.stringify(body),
                headers,
            });

            expect(requestUrlMock).toHaveBeenCalledWith({
                url,
                method: 'POST',
                body: JSON.stringify(body),
                headers,
            });

            expect(response).toBeInstanceOf(Response);
            const text = await response.text();
            expect(text).toBe(mockResponseData);
        });

        it('should make a POST request with string body', async () => {
            const mockResponseData = 'mock response';
            const mockResponse: Partial<RequestUrlResponse> = {
                status: 200,
                text: mockResponseData,
                headers: { 'content-type': 'text/plain' },
            };
            
            requestUrlMock.mockResolvedValue(mockResponse);

            const url = 'https://api.example.com';
            const body = 'test data';
            const headers = { 'Content-Type': 'text/plain' };

            const response = await obsidianFetch(url, {
                method: 'POST',
                body: body,
                headers,
            });

            expect(requestUrlMock).toHaveBeenCalledWith({
                url,
                method: 'POST',
                body: body,
                headers,
            });

            expect(response).toBeInstanceOf(Response);
            const text = await response.text();
            expect(text).toBe(mockResponseData);
        });

        it('should handle Buffer body as string', async () => {
            const mockResponseData = 'mock response';
            const mockResponse: Partial<RequestUrlResponse> = {
                status: 200,
                text: mockResponseData,
                headers: { 'content-type': 'application/octet-stream' },
            };
            
            requestUrlMock.mockResolvedValue(mockResponse);

            const url = 'https://api.example.com';
            const body = Buffer.from('test data');
            const headers = { 'Content-Type': 'application/octet-stream' };

            const response = await obsidianFetch(url, {
                method: 'POST',
                body: body.toString(),
                headers,
            });

            expect(requestUrlMock).toHaveBeenCalledWith({
                url,
                method: 'POST',
                body: body.toString(),
                headers,
            });

            expect(response).toBeInstanceOf(Response);
            const text = await response.text();
            expect(text).toBe(mockResponseData);
        });
    });

    describe('Error Handling', () => {
        it('should handle request errors', async () => {
            const errorMessage = 'Network error';
            requestUrlMock.mockRejectedValue(new Error(errorMessage));

            const url = 'https://api.example.com';
            await expect(obsidianFetch(url, { headers: {} })).rejects.toThrow(errorMessage);
        });

        it('should handle non-200 status codes', async () => {
            const mockResponse: Partial<RequestUrlResponse> = {
                status: 404,
                text: 'Not Found',
                headers: { 'content-type': 'text/plain' },
            };
            
            requestUrlMock.mockResolvedValue(mockResponse);

            const url = 'https://api.example.com';
            const response = await obsidianFetch(url, { headers: {} });

            expect(response.status).toBe(404);
            const text = await response.text();
            expect(text).toBe('Not Found');
        });
    });

    describe('Header Handling', () => {
        it('should pass through custom headers', async () => {
            const mockResponse: Partial<RequestUrlResponse> = {
                status: 200,
                text: 'mock response',
                headers: { 'content-type': 'application/json' },
            };
            
            requestUrlMock.mockResolvedValue(mockResponse);

            const url = 'https://api.example.com';
            const headers = {
                'Authorization': 'Bearer token',
                'Custom-Header': 'custom value'
            };

            await obsidianFetch(url, { headers });

            expect(requestUrlMock).toHaveBeenCalledWith({
                url,
                method: 'GET',
                headers,
            });
        });

        it('should handle response headers', async () => {
            const mockResponse: Partial<RequestUrlResponse> = {
                status: 200,
                text: 'mock response',
                headers: {
                    'content-type': 'application/json',
                    'x-custom-header': 'custom value'
                },
            };
            
            requestUrlMock.mockResolvedValue(mockResponse);

            const url = 'https://api.example.com';
            const response = await obsidianFetch(url, { headers: {} });

            expect(response.headers).toEqual(mockResponse.headers);
        });
    });
}); 