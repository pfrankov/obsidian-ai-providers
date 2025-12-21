import { FetchSelector } from './FetchSelector';
import {
    IAIProvider,
    IAIProvidersPluginSettings,
} from '@obsidian-ai-providers/sdk';
import { electronFetch } from './electronFetch';
import { obsidianFetch } from './obsidianFetch';
import { Platform } from 'obsidian';

// Mock dependencies
vi.mock('./electronFetch');
vi.mock('./obsidianFetch');
vi.mock('./logger');
vi.mock('obsidian', () => ({
    Platform: {
        isMobileApp: false,
    },
}));

describe('FetchSelector', () => {
    let fetchSelector: FetchSelector;
    let mockProvider: IAIProvider;
    let mockSettings: IAIProvidersPluginSettings;

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

        fetchSelector = new FetchSelector(mockSettings);
        (Platform as any).isMobileApp = false;
    });

    describe('getFetch and getStreamingFetch', () => {
        it('uses obsidianFetch for API calls by default', () => {
            const fetchFn = fetchSelector.getFetch(mockProvider);
            expect(fetchFn).toBe(obsidianFetch);
        });

        it('defaults to obsidianFetch when useNativeFetch is undefined', () => {
            mockSettings.useNativeFetch = undefined;
            fetchSelector = new FetchSelector(mockSettings);

            expect(fetchSelector.getFetch(mockProvider)).toBe(obsidianFetch);
        });

        it('uses electronFetch for streaming by default', () => {
            const fetchFn = fetchSelector.getStreamingFetch(mockProvider);
            expect(fetchFn).toBe(electronFetch);
        });

        it('uses obsidianFetch on mobile platform', () => {
            (Platform as any).isMobileApp = true;
            expect(fetchSelector.getFetch(mockProvider)).toBe(obsidianFetch);
            expect(fetchSelector.getStreamingFetch(mockProvider)).toBe(
                obsidianFetch
            );
        });

        it('uses native fetch when enabled', () => {
            mockSettings.useNativeFetch = true;
            expect(fetchSelector.getFetch(mockProvider)).toBe(globalThis.fetch);
            expect(fetchSelector.getStreamingFetch(mockProvider)).toBe(
                globalThis.fetch
            );
        });

        it('uses obsidianFetch when provider is blocked', () => {
            fetchSelector.markBlocked(mockProvider);
            expect(fetchSelector.getFetch(mockProvider)).toBe(obsidianFetch);
            expect(fetchSelector.getStreamingFetch(mockProvider)).toBe(
                obsidianFetch
            );
        });
    });

    describe('CORS Error Detection', () => {
        it('returns false for undefined errors', () => {
            expect(
                fetchSelector.isCorsError(undefined as unknown as Error)
            ).toBe(false);
        });

        it('returns false for empty error messages', () => {
            const error = { message: '', name: '' } as Error;
            expect(fetchSelector.isCorsError(error)).toBe(false);
        });

        it('should detect CORS errors', () => {
            const corsErrors = [
                new Error('CORS policy blocked the request'),
                new Error('Failed to fetch'),
                new Error('Network error'),
            ];

            corsErrors.forEach(error => {
                expect(fetchSelector.isCorsError(error)).toBe(true);
            });
        });

        it('should not detect non-CORS errors', () => {
            const nonCorsErrors = [
                new Error('Invalid API key'),
                new Error('Server error 500'),
            ];

            nonCorsErrors.forEach(error => {
                expect(fetchSelector.isCorsError(error)).toBe(false);
            });
        });
    });

    describe('Provider Management', () => {
        it('should mark and check blocked providers', () => {
            expect(fetchSelector.isBlocked(mockProvider)).toBe(false);

            fetchSelector.markBlocked(mockProvider);
            expect(fetchSelector.isBlocked(mockProvider)).toBe(true);
            expect(fetchSelector.getBlockedProviderCount()).toBe(1);
        });

        it('should clear blocked providers', () => {
            fetchSelector.markBlocked(mockProvider);
            fetchSelector.clear();
            expect(fetchSelector.getBlockedProviderCount()).toBe(0);
        });

        it('generates provider key with unknown when url is missing', () => {
            const providerWithoutUrl = { ...mockProvider, url: '' };
            fetchSelector.markBlocked(providerWithoutUrl);
            expect(fetchSelector.isBlocked(providerWithoutUrl)).toBe(true);
        });
    });

    describe('execute and request', () => {
        it('uses obsidianFetch for blocked providers', async () => {
            fetchSelector.markBlocked(mockProvider);
            const operation = vi.fn().mockResolvedValue('ok');

            const result = await fetchSelector.execute(mockProvider, operation);

            expect(result).toBe('ok');
            expect(operation).toHaveBeenCalledWith(obsidianFetch);
        });

        it('uses obsidianFetch for blocked providers during request', async () => {
            fetchSelector.markBlocked(mockProvider);
            const operation = vi.fn().mockResolvedValue('ok');

            const result = await fetchSelector.request(mockProvider, operation);

            expect(result).toBe('ok');
            expect(operation).toHaveBeenCalledWith(obsidianFetch);
        });

        it('returns result without retry when no CORS error in execute', async () => {
            const operation = vi.fn().mockResolvedValue('ok');

            const result = await fetchSelector.execute(mockProvider, operation);

            expect(result).toBe('ok');
            expect(operation).toHaveBeenCalledTimes(1);
        });

        it('retries with obsidianFetch on CORS errors', async () => {
            const operation = vi.fn().mockImplementation((fetchFn: any) => {
                if (fetchFn === electronFetch) {
                    throw new Error('CORS error');
                }
                return Promise.resolve('ok');
            });

            const result = await fetchSelector.execute(mockProvider, operation);
            expect(result).toBe('ok');
            expect(operation).toHaveBeenCalledTimes(2);
            expect(fetchSelector.isBlocked(mockProvider)).toBe(true);
        });

        it('rethrows non-CORS errors from execute', async () => {
            const operation = vi.fn().mockRejectedValue(new Error('boom'));
            await expect(
                fetchSelector.execute(mockProvider, operation)
            ).rejects.toThrow('boom');
        });

        it('returns result without retry when no CORS error in request', async () => {
            const operation = vi.fn().mockResolvedValue('ok');

            const result = await fetchSelector.request(mockProvider, operation);

            expect(result).toBe('ok');
            expect(operation).toHaveBeenCalledTimes(1);
        });

        it('retries with obsidianFetch on request CORS errors', async () => {
            mockSettings.useNativeFetch = true;
            const operation = vi.fn().mockImplementation((fetchFn: any) => {
                if (fetchFn === obsidianFetch) {
                    return Promise.resolve('ok');
                }
                throw new Error('CORS policy blocked the request');
            });

            const result = await fetchSelector.request(mockProvider, operation);
            expect(result).toBe('ok');
            expect(operation).toHaveBeenCalledTimes(2);
            expect(fetchSelector.isBlocked(mockProvider)).toBe(true);
        });

        it('rethrows non-CORS errors from request', async () => {
            const operation = vi.fn().mockRejectedValue(new Error('nope'));
            await expect(
                fetchSelector.request(mockProvider, operation)
            ).rejects.toThrow('nope');
        });
    });
});
