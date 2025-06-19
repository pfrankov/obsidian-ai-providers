import { CorsRetryManager, corsRetryManager, withCorsRetry } from './corsRetryManager';
import { IAIProvider } from '@obsidian-ai-providers/sdk';

describe('CorsRetryManager', () => {
    let manager: CorsRetryManager;
    let mockProvider: IAIProvider;

    beforeEach(() => {
        // Get a fresh instance and clear it
        manager = CorsRetryManager.getInstance();
        manager.clearAll();
        
        mockProvider = {
            id: 'test-provider',
            name: 'Test Provider',
            type: 'openai' as const,
            url: 'https://api.example.com',
            apiKey: 'test-key',
            model: 'test-model'
        };
    });

    afterEach(() => {
        manager.clearAll();
    });

    describe('Singleton Pattern', () => {
        it('should return the same instance', () => {
            const instance1 = CorsRetryManager.getInstance();
            const instance2 = CorsRetryManager.getInstance();
            expect(instance1).toBe(instance2);
        });

        it('should use the global instance', () => {
            expect(corsRetryManager).toBe(CorsRetryManager.getInstance());
        });
    });

    describe('Provider Management', () => {
        it('should not mark provider as blocked initially', () => {
            expect(manager.shouldUseFallback(mockProvider)).toBe(false);
            expect(manager.getBlockedProviderCount()).toBe(0);
        });

        it('should mark provider as CORS blocked', () => {
            manager.markProviderAsCorsBlocked(mockProvider);
            expect(manager.shouldUseFallback(mockProvider)).toBe(true);
            expect(manager.getBlockedProviderCount()).toBe(1);
        });

        it('should handle different providers separately', () => {
            const provider1 = { ...mockProvider, url: 'https://api1.example.com' };
            const provider2 = { ...mockProvider, url: 'https://api2.example.com' };

            manager.markProviderAsCorsBlocked(provider1);
            
            expect(manager.shouldUseFallback(provider1)).toBe(true);
            expect(manager.shouldUseFallback(provider2)).toBe(false);
            expect(manager.getBlockedProviderCount()).toBe(1);
        });

        it('should handle same provider marked multiple times', () => {
            manager.markProviderAsCorsBlocked(mockProvider);
            manager.markProviderAsCorsBlocked(mockProvider);
            
            expect(manager.shouldUseFallback(mockProvider)).toBe(true);
            expect(manager.getBlockedProviderCount()).toBe(1);
        });

        it('should differentiate providers by URL and type', () => {
            const provider1 = { ...mockProvider, type: 'openai' as const };
            const provider2 = { ...mockProvider, type: 'ollama' as const };

            manager.markProviderAsCorsBlocked(provider1);
            
            expect(manager.shouldUseFallback(provider1)).toBe(true);
            expect(manager.shouldUseFallback(provider2)).toBe(false);
        });
    });

    describe('CORS Error Detection', () => {
        it('should detect CORS errors', () => {
            const corsErrors = [
                new Error('CORS policy blocked the request'),
                new Error('Cross-Origin Request Blocked'),
                new Error('Access blocked by CORS policy'),
                new Error('Not allowed by Access-Control-Allow-Origin'),
                new Error('Something cors related happened'),
                new Error('Connection error.'), // Common Electron/browser CORS error
                new Error('Network error'),
                new Error('Failed to fetch'),
                new Error('TypeError: Failed to fetch')
            ];

            corsErrors.forEach(error => {
                expect(manager.isCorsError(error)).toBe(true);
            });
        });

        it('should not detect non-CORS errors', () => {
            const nonCorsErrors = [
                new Error('Connection timeout'),
                new Error('Invalid API key'),
                new Error('Server error 500'),
                new Error('Not found'),
                new Error('Authentication failed'),
                new Error('Rate limit exceeded')
            ];

            nonCorsErrors.forEach(error => {
                expect(manager.isCorsError(error)).toBe(false);
            });
        });

        it('should handle case-insensitive error detection', () => {
            const mixedCaseErrors = [
                new Error('CORS Policy Blocked'),
                new Error('Cross-origin request blocked'),
                new Error('ACCESS-CONTROL-ALLOW-ORIGIN not set')
            ];

            mixedCaseErrors.forEach(error => {
                expect(manager.isCorsError(error)).toBe(true);
            });
        });

        // Специальный тест для ошибки из логов пользователя
        it('should detect "Connection error." as CORS error (real-world case)', () => {
            const realWorldError = new Error('Connection error.');
            expect(manager.isCorsError(realWorldError)).toBe(true);
        });
    });

    describe('Clear Operations', () => {
        it('should clear all blocked providers', () => {
            const provider1 = { ...mockProvider, url: 'https://api1.example.com' };
            const provider2 = { ...mockProvider, url: 'https://api2.example.com' };

            manager.markProviderAsCorsBlocked(provider1);
            manager.markProviderAsCorsBlocked(provider2);
            expect(manager.getBlockedProviderCount()).toBe(2);

            manager.clearAll();
            expect(manager.getBlockedProviderCount()).toBe(0);
            expect(manager.shouldUseFallback(provider1)).toBe(false);
            expect(manager.shouldUseFallback(provider2)).toBe(false);
        });
    });

    describe('Edge Cases', () => {
        it('should handle provider with undefined URL', () => {
            const providerWithoutUrl = { ...mockProvider, url: undefined };
            
            manager.markProviderAsCorsBlocked(providerWithoutUrl);
            expect(manager.shouldUseFallback(providerWithoutUrl)).toBe(true);
        });

        it('should handle provider with empty URL', () => {
            const providerWithEmptyUrl = { ...mockProvider, url: '' };
            
            manager.markProviderAsCorsBlocked(providerWithEmptyUrl);
            expect(manager.shouldUseFallback(providerWithEmptyUrl)).toBe(true);
        });
    });
});

describe('withCorsRetry', () => {
    let mockProvider: IAIProvider;
    const mockDefaultFetch = jest.fn();
    const mockObsidianFetch = jest.fn();

    beforeEach(() => {
        mockProvider = {
            id: 'test-provider-cors',
            name: 'Test Provider',
            type: 'openai' as const,
            url: 'https://api.test.com',
            apiKey: 'test-key',
            model: 'test-model'
        };
        corsRetryManager.clearAll();
        mockDefaultFetch.mockClear();
        mockObsidianFetch.mockClear();
    });

    it('should return operation result on success', async () => {
        const mockOperation = jest.fn().mockImplementation(async (fetch) => {
            if (fetch === mockDefaultFetch) {
                return 'success';
            }
            throw new Error('Wrong fetch used');
        });

        const result = await withCorsRetry(
            mockProvider,
            mockOperation,
            mockDefaultFetch,
            'test-operation'
        );

        expect(result).toBe('success');
        expect(mockOperation).toHaveBeenCalledWith(mockDefaultFetch);
        expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should retry on CORS error', async () => {
        const corsError = new Error('Access blocked by CORS policy');
        const mockOperation = jest.fn()
            .mockRejectedValueOnce(corsError)
            .mockResolvedValueOnce('retry-success');

        const result = await withCorsRetry(
            mockProvider,
            mockOperation,
            mockDefaultFetch,
            'test-operation'
        );

        expect(result).toBe('retry-success');
        expect(mockOperation).toHaveBeenCalledTimes(2);
        expect(mockOperation).toHaveBeenCalledWith(mockDefaultFetch);
        expect(corsRetryManager.shouldUseFallback(mockProvider)).toBe(true);
    });

    it('should not retry on non-CORS error', async () => {
        const networkError = new Error('Network timeout');
        const mockOperation = jest.fn().mockRejectedValue(networkError);

        await expect(withCorsRetry(
            mockProvider,
            mockOperation,
            mockDefaultFetch,
            'test-operation'
        )).rejects.toThrow('Network timeout');

        expect(mockOperation).toHaveBeenCalledWith(mockDefaultFetch);
        expect(mockOperation).toHaveBeenCalledTimes(1);
        expect(corsRetryManager.shouldUseFallback(mockProvider)).toBe(false);
    });

    // Тест для реальной ошибки из логов пользователя
    it('should retry on "Connection error." (real-world CORS case)', async () => {
        const realWorldCorsError = new Error('Connection error.');
        const mockOperation = jest.fn()
            .mockRejectedValueOnce(realWorldCorsError)
            .mockResolvedValueOnce('retry-success');

        const result = await withCorsRetry(
            mockProvider,
            mockOperation,
            mockDefaultFetch,
            'test-operation'
        );

        expect(result).toBe('retry-success');
        expect(mockOperation).toHaveBeenCalledTimes(2);
        expect(corsRetryManager.shouldUseFallback(mockProvider)).toBe(true);
    });
}); 