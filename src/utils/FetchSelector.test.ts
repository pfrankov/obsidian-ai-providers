import { FetchSelector } from './FetchSelector';
import {
    IAIProvider,
    IAIProvidersPluginSettings,
} from '@obsidian-ai-providers/sdk';
import { electronFetch } from './electronFetch';
import { obsidianFetch } from './obsidianFetch';
import { Platform } from 'obsidian';

// Mock dependencies
jest.mock('./electronFetch');
jest.mock('./obsidianFetch');
jest.mock('./logger');
jest.mock('obsidian', () => ({
    Platform: {
        isMobileApp: false,
    },
}));

describe('FetchSelector', () => {
    let fetchSelector: FetchSelector;
    let mockProvider: IAIProvider;
    let mockSettings: IAIProvidersPluginSettings;
    let mockElectronFetch: jest.MockedFunction<typeof electronFetch>;
    let mockObsidianFetch: jest.MockedFunction<typeof obsidianFetch>;

    beforeEach(() => {
        mockProvider = {
            id: 'test-provider',
            name: 'Test Provider',
            type: 'openai' as const,
            url: 'https://api.example.com',
            apiKey: 'test-key',
            model: 'test-model',
        };

        mockSettings = {
            useNativeFetch: false,
            providers: [],
            _version: 1,
        } as IAIProvidersPluginSettings;

        mockElectronFetch = electronFetch as jest.MockedFunction<
            typeof electronFetch
        >;
        mockObsidianFetch = obsidianFetch as jest.MockedFunction<
            typeof obsidianFetch
        >;

        fetchSelector = new FetchSelector(mockSettings);

        // Clear mocks
        mockElectronFetch.mockClear();
        mockObsidianFetch.mockClear();
    });

    describe('getFetchFunction', () => {
        it('should return electronFetch by default when useNativeFetch is false', () => {
            const fetchFn = fetchSelector.getFetchFunction(mockProvider);
            expect(fetchFn).toBe(electronFetch);
        });

        it('should return native fetch when useNativeFetch is true', () => {
            mockSettings.useNativeFetch = true;
            const fetchFn = fetchSelector.getFetchFunction(mockProvider);
            expect(fetchFn).toBe(globalThis.fetch);
        });

        it('should return obsidianFetch for CORS-blocked providers', () => {
            // Mark provider as CORS blocked
            fetchSelector.markProviderAsCorsBlocked(mockProvider);

            const fetchFn = fetchSelector.getFetchFunction(mockProvider);
            expect(fetchFn).toBe(obsidianFetch);
        });

        it('should return obsidianFetch on mobile platform regardless of settings', () => {
            (Platform as any).isMobileApp = true;
            mockSettings.useNativeFetch = false;

            const fetchFn = fetchSelector.getFetchFunction(mockProvider);
            expect(fetchFn).toBe(obsidianFetch);
        });

        it('should return obsidianFetch on mobile even when useNativeFetch is true', () => {
            (Platform as any).isMobileApp = true;
            mockSettings.useNativeFetch = true;

            const fetchFn = fetchSelector.getFetchFunction(mockProvider);
            expect(fetchFn).toBe(obsidianFetch);
        });
    });

    describe('executeWithCorsRetry', () => {
        it('should execute operation successfully with default fetch', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');

            const result = await fetchSelector.executeWithCorsRetry(
                mockProvider,
                mockOperation,
                'test-operation'
            );

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledWith(obsidianFetch);
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should retry with obsidianFetch on CORS error', async () => {
            const corsError = new Error('Access blocked by CORS policy');
            const mockOperation = jest
                .fn()
                .mockRejectedValueOnce(corsError)
                .mockResolvedValueOnce('retry-success');

            const result = await fetchSelector.executeWithCorsRetry(
                mockProvider,
                mockOperation,
                'test-operation'
            );

            expect(result).toBe('retry-success');
            expect(mockOperation).toHaveBeenCalledTimes(2);
            expect(mockOperation).toHaveBeenNthCalledWith(1, obsidianFetch);
            expect(mockOperation).toHaveBeenNthCalledWith(2, obsidianFetch);
            expect(fetchSelector.shouldUseFallback(mockProvider)).toBe(true);
        });

        it('should not retry on non-CORS error', async () => {
            const networkError = new Error('Network timeout');
            const mockOperation = jest.fn().mockRejectedValue(networkError);

            await expect(
                fetchSelector.executeWithCorsRetry(
                    mockProvider,
                    mockOperation,
                    'test-operation'
                )
            ).rejects.toThrow('Network timeout');

            expect(mockOperation).toHaveBeenCalledWith(obsidianFetch);
            expect(mockOperation).toHaveBeenCalledTimes(1);
            expect(fetchSelector.shouldUseFallback(mockProvider)).toBe(false);
        });

        it('should use obsidianFetch directly for already blocked providers', async () => {
            fetchSelector.markProviderAsCorsBlocked(mockProvider);
            const mockOperation = jest.fn().mockResolvedValue('success');

            const result = await fetchSelector.executeWithCorsRetry(
                mockProvider,
                mockOperation,
                'test-operation'
            );

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledWith(obsidianFetch);
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should handle retry failure gracefully', async () => {
            const corsError = new Error('Access blocked by CORS policy');
            const retryError = new Error('Retry failed');
            const mockOperation = jest
                .fn()
                .mockRejectedValueOnce(corsError)
                .mockRejectedValueOnce(retryError);

            await expect(
                fetchSelector.executeWithCorsRetry(
                    mockProvider,
                    mockOperation,
                    'test-operation'
                )
            ).rejects.toThrow('Retry failed');

            expect(mockOperation).toHaveBeenCalledTimes(2);
            expect(fetchSelector.shouldUseFallback(mockProvider)).toBe(true);
        });

        it('should use native fetch when useNativeFetch is true', async () => {
            mockSettings.useNativeFetch = true;
            const mockOperation = jest.fn().mockResolvedValue('success');

            const result = await fetchSelector.executeWithCorsRetry(
                mockProvider,
                mockOperation,
                'test-operation'
            );

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledWith(globalThis.fetch);
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should use electronFetch for execute operations', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');

            const result = await fetchSelector.executeWithCorsRetry(
                mockProvider,
                mockOperation,
                'execute'
            );

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledWith(electronFetch);
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should use obsidianFetch for fetchModels operations', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');

            const result = await fetchSelector.executeWithCorsRetry(
                mockProvider,
                mockOperation,
                'fetchModels'
            );

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledWith(obsidianFetch);
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should use obsidianFetch for embed operations', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');

            const result = await fetchSelector.executeWithCorsRetry(
                mockProvider,
                mockOperation,
                'embed'
            );

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledWith(obsidianFetch);
            expect(mockOperation).toHaveBeenCalledTimes(1);
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
                new Error('Connection error.'),
                new Error('Network error'),
                new Error('Failed to fetch'),
                new Error('TypeError: Failed to fetch'),
            ];

            corsErrors.forEach(error => {
                expect(fetchSelector.isCorsError(error)).toBe(true);
            });
        });

        it('should not detect non-CORS errors', () => {
            const nonCorsErrors = [
                new Error('Connection timeout'),
                new Error('Invalid API key'),
                new Error('Server error 500'),
                new Error('Not found'),
                new Error('Authentication failed'),
                new Error('Rate limit exceeded'),
            ];

            nonCorsErrors.forEach(error => {
                expect(fetchSelector.isCorsError(error)).toBe(false);
            });
        });

        it('should handle case-insensitive error detection', () => {
            const mixedCaseErrors = [
                new Error('CORS Policy Blocked'),
                new Error('Cross-origin request blocked'),
                new Error('ACCESS-CONTROL-ALLOW-ORIGIN not set'),
            ];

            mixedCaseErrors.forEach(error => {
                expect(fetchSelector.isCorsError(error)).toBe(true);
            });
        });
    });

    describe('Provider Management', () => {
        it('should not mark provider as blocked initially', () => {
            expect(fetchSelector.shouldUseFallback(mockProvider)).toBe(false);
            expect(fetchSelector.getBlockedProviderCount()).toBe(0);
        });

        it('should mark provider as CORS blocked', () => {
            fetchSelector.markProviderAsCorsBlocked(mockProvider);
            expect(fetchSelector.shouldUseFallback(mockProvider)).toBe(true);
            expect(fetchSelector.getBlockedProviderCount()).toBe(1);
        });

        it('should handle different providers separately', () => {
            const provider1 = {
                ...mockProvider,
                url: 'https://api1.example.com',
            };
            const provider2 = {
                ...mockProvider,
                url: 'https://api2.example.com',
            };

            fetchSelector.markProviderAsCorsBlocked(provider1);

            expect(fetchSelector.shouldUseFallback(provider1)).toBe(true);
            expect(fetchSelector.shouldUseFallback(provider2)).toBe(false);
            expect(fetchSelector.getBlockedProviderCount()).toBe(1);
        });

        it('should handle same provider marked multiple times', () => {
            fetchSelector.markProviderAsCorsBlocked(mockProvider);
            fetchSelector.markProviderAsCorsBlocked(mockProvider);

            expect(fetchSelector.shouldUseFallback(mockProvider)).toBe(true);
            expect(fetchSelector.getBlockedProviderCount()).toBe(1);
        });

        it('should differentiate providers by URL and type', () => {
            const provider1 = { ...mockProvider, type: 'openai' as const };
            const provider2 = { ...mockProvider, type: 'ollama' as const };

            fetchSelector.markProviderAsCorsBlocked(provider1);

            expect(fetchSelector.shouldUseFallback(provider1)).toBe(true);
            expect(fetchSelector.shouldUseFallback(provider2)).toBe(false);
        });

        it('should clear all blocked providers', () => {
            const provider1 = {
                ...mockProvider,
                url: 'https://api1.example.com',
            };
            const provider2 = {
                ...mockProvider,
                url: 'https://api2.example.com',
            };

            fetchSelector.markProviderAsCorsBlocked(provider1);
            fetchSelector.markProviderAsCorsBlocked(provider2);
            expect(fetchSelector.getBlockedProviderCount()).toBe(2);

            fetchSelector.clearAll();
            expect(fetchSelector.getBlockedProviderCount()).toBe(0);
            expect(fetchSelector.shouldUseFallback(provider1)).toBe(false);
            expect(fetchSelector.shouldUseFallback(provider2)).toBe(false);
        });
    });

    describe('Edge Cases', () => {
        it('should handle provider with undefined URL', () => {
            const providerWithoutUrl = { ...mockProvider, url: undefined };

            fetchSelector.markProviderAsCorsBlocked(providerWithoutUrl);
            expect(fetchSelector.shouldUseFallback(providerWithoutUrl)).toBe(
                true
            );
        });

        it('should handle provider with empty URL', () => {
            const providerWithEmptyUrl = { ...mockProvider, url: '' };

            fetchSelector.markProviderAsCorsBlocked(providerWithEmptyUrl);
            expect(fetchSelector.shouldUseFallback(providerWithEmptyUrl)).toBe(
                true
            );
        });

        it('should handle mobile platform with CORS blocked provider', () => {
            (Platform as any).isMobileApp = true;
            fetchSelector.markProviderAsCorsBlocked(mockProvider);

            const fetchFn = fetchSelector.getFetchFunction(mockProvider);
            expect(fetchFn).toBe(obsidianFetch);
        });
    });
});
