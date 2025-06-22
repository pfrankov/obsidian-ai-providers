import { electronFetch } from './electronFetch';

describe('electronFetch', () => {
    const mockElectronAPI = (window as any).electronAPI;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Basic Request Handling', () => {
        it('should make a GET request successfully', async () => {
            const mockResponse = {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ data: 'test' }),
            };

            mockElectronAPI.fetch.mockResolvedValue(mockResponse);

            const response = await electronFetch(
                'https://api.example.com/data'
            );

            expect(mockElectronAPI.fetch).toHaveBeenCalledWith({
                url: 'https://api.example.com/data',
            });
            expect(response.status).toBe(200);
            expect(response.statusText).toBe('OK');
        });

        it('should make a POST request with body', async () => {
            const mockResponse = {
                status: 201,
                statusText: 'Created',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: 1 }),
            };

            mockElectronAPI.fetch.mockResolvedValue(mockResponse);

            const requestBody = JSON.stringify({ name: 'test' });
            const response = await electronFetch(
                'https://api.example.com/create',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: requestBody,
                }
            );

            expect(mockElectronAPI.fetch).toHaveBeenCalledWith({
                url: 'https://api.example.com/create',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: requestBody,
            });
            expect(response.status).toBe(201);
        });
    });

    describe('Error Handling', () => {
        it('should handle request errors', async () => {
            const errorMessage = 'Network error';
            mockElectronAPI.fetch.mockRejectedValue(new Error(errorMessage));

            await expect(
                electronFetch('https://api.example.com/error')
            ).rejects.toThrow(errorMessage);
        });
    });
});
