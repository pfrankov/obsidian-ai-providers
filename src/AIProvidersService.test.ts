import { AIProvidersService } from './AIProvidersService';
import { App } from 'obsidian';
import AIProvidersPlugin from './main';
import {
    IAIProvider,
    IAIProvidersEmbedParams,
} from '@obsidian-ai-providers/sdk';

// Mock the handlers
jest.mock('./handlers/OpenAIHandler');
jest.mock('./handlers/OllamaHandler');

// Mock the cache
jest.mock('./cache/EmbeddingsCache', () => ({
    embeddingsCache: {
        init: jest.fn(),
        close: jest.fn(),
        isInitialized: jest.fn().mockReturnValue(true),
    },
}));

// Mock CachedEmbeddingsService
jest.mock('./cache/CachedEmbeddingsService');

describe('AIProvidersService', () => {
    let service: AIProvidersService;
    let mockApp: App;
    let mockPlugin: AIProvidersPlugin;
    let mockProvider: IAIProvider;

    beforeEach(() => {
        // Create mock app
        mockApp = {
            appId: 'test-app-id',
        } as any;

        // Create mock plugin with settings
        mockPlugin = {
            settings: {
                providers: [],
                _version: 1,
            },
            saveSettings: jest.fn(),
        } as any;

        // Create mock provider
        mockProvider = {
            id: 'test-provider',
            name: 'Test Provider',
            type: 'openai',
            apiKey: 'test-key',
            model: 'gpt-3.5-turbo',
        };

        // Create service instance
        service = new AIProvidersService(mockApp, mockPlugin);

        // Clear all mocks
        jest.clearAllMocks();
    });

    describe('embed method', () => {
        it('should always return a promise', async () => {
            // Mock the CachedEmbeddingsService to return a promise
            const mockEmbedWithCache = jest
                .fn()
                .mockResolvedValue([[0.1, 0.2, 0.3]]);
            (service as any).cachedEmbeddingsService = {
                embedWithCache: mockEmbedWithCache,
            };

            const params: IAIProvidersEmbedParams = {
                provider: mockProvider,
                input: 'test text',
            };

            // Call the embed method
            const result = service.embed(params);

            // Verify it returns a promise
            expect(result).toBeInstanceOf(Promise);

            // Verify the promise resolves correctly
            const embeddings = await result;
            expect(embeddings).toEqual([[0.1, 0.2, 0.3]]);
        });

        it('should return a promise even when input is empty', async () => {
            const params: IAIProvidersEmbedParams = {
                provider: mockProvider,
                input: '',
            };

            // Call the embed method with empty input
            const result = service.embed(params);

            // Verify it returns a promise even with empty input
            expect(result).toBeInstanceOf(Promise);

            // Verify the promise rejects with an error
            await expect(result).rejects.toThrow(
                'Input is required for embedding'
            );
        });

        it('should return a promise even when provider is invalid', async () => {
            const invalidProvider = {
                ...mockProvider,
                type: 'invalid-type' as any,
            };

            const params: IAIProvidersEmbedParams = {
                provider: invalidProvider,
                input: 'test text',
            };

            // Mock the embedForce method to reject
            const mockEmbedForce = jest
                .fn()
                .mockRejectedValue(
                    new Error(
                        'Handler not found for provider type: invalid-type'
                    )
                );
            (service as any).embedForce = mockEmbedForce;

            // Mock the CachedEmbeddingsService to call embedForce
            const mockEmbedWithCache = jest
                .fn()
                .mockImplementation(async () => {
                    return mockEmbedForce();
                });
            (service as any).cachedEmbeddingsService = {
                embedWithCache: mockEmbedWithCache,
            };

            // Call the embed method
            const result = service.embed(params);

            // Verify it returns a promise even with invalid provider
            expect(result).toBeInstanceOf(Promise);

            // Verify the promise rejects with an error
            await expect(result).rejects.toThrow(
                'Handler not found for provider type: invalid-type'
            );
        });

        it('should return a promise with array input', async () => {
            // Mock the CachedEmbeddingsService to return multiple embeddings
            const mockEmbedWithCache = jest.fn().mockResolvedValue([
                [0.1, 0.2, 0.3],
                [0.4, 0.5, 0.6],
            ]);
            (service as any).cachedEmbeddingsService = {
                embedWithCache: mockEmbedWithCache,
            };

            const params: IAIProvidersEmbedParams = {
                provider: mockProvider,
                input: ['text1', 'text2'],
            };

            // Call the embed method
            const result = service.embed(params);

            // Verify it returns a promise
            expect(result).toBeInstanceOf(Promise);

            // Verify the promise resolves correctly
            const embeddings = await result;
            expect(embeddings).toEqual([
                [0.1, 0.2, 0.3],
                [0.4, 0.5, 0.6],
            ]);
        });

        describe('multiple calls', () => {
            it('should handle multiple sequential calls correctly', async () => {
                const mockEmbedWithCache = jest
                    .fn()
                    .mockResolvedValueOnce([[0.1, 0.2, 0.3]])
                    .mockResolvedValueOnce([[0.4, 0.5, 0.6]])
                    .mockResolvedValueOnce([[0.7, 0.8, 0.9]]);

                (service as any).cachedEmbeddingsService = {
                    embedWithCache: mockEmbedWithCache,
                };

                const params1: IAIProvidersEmbedParams = {
                    provider: mockProvider,
                    input: 'first text',
                };

                const params2: IAIProvidersEmbedParams = {
                    provider: mockProvider,
                    input: 'second text',
                };

                const params3: IAIProvidersEmbedParams = {
                    provider: mockProvider,
                    input: 'third text',
                };

                // Make sequential calls
                const result1 = await service.embed(params1);
                const result2 = await service.embed(params2);
                const result3 = await service.embed(params3);

                // Verify all calls return promises and resolve correctly
                expect(result1).toEqual([[0.1, 0.2, 0.3]]);
                expect(result2).toEqual([[0.4, 0.5, 0.6]]);
                expect(result3).toEqual([[0.7, 0.8, 0.9]]);

                // Verify all calls were made to the cached service
                expect(mockEmbedWithCache).toHaveBeenCalledTimes(3);
            });

            it('should handle multiple concurrent calls correctly', async () => {
                const mockEmbedWithCache = jest
                    .fn()
                    .mockResolvedValueOnce([[0.1, 0.2, 0.3]])
                    .mockResolvedValueOnce([[0.4, 0.5, 0.6]])
                    .mockResolvedValueOnce([[0.7, 0.8, 0.9]]);

                (service as any).cachedEmbeddingsService = {
                    embedWithCache: mockEmbedWithCache,
                };

                const params1: IAIProvidersEmbedParams = {
                    provider: mockProvider,
                    input: 'concurrent text 1',
                };

                const params2: IAIProvidersEmbedParams = {
                    provider: mockProvider,
                    input: 'concurrent text 2',
                };

                const params3: IAIProvidersEmbedParams = {
                    provider: mockProvider,
                    input: 'concurrent text 3',
                };

                // Make concurrent calls
                const [result1, result2, result3] = await Promise.all([
                    service.embed(params1),
                    service.embed(params2),
                    service.embed(params3),
                ]);

                // Verify all results are distinct and correct
                expect(result1).toEqual([[0.1, 0.2, 0.3]]);
                expect(result2).toEqual([[0.4, 0.5, 0.6]]);
                expect(result3).toEqual([[0.7, 0.8, 0.9]]);

                // Verify all calls were made
                expect(mockEmbedWithCache).toHaveBeenCalledTimes(3);
            });

            it('should handle repeated calls with same input', async () => {
                const mockEmbedWithCache = jest
                    .fn()
                    .mockResolvedValue([[0.1, 0.2, 0.3]]);

                (service as any).cachedEmbeddingsService = {
                    embedWithCache: mockEmbedWithCache,
                };

                const params: IAIProvidersEmbedParams = {
                    provider: mockProvider,
                    input: 'repeated text',
                };

                // Make multiple calls with the same input
                const result1 = await service.embed(params);
                const result2 = await service.embed(params);

                // All should return the same result
                expect(result1).toEqual([[0.1, 0.2, 0.3]]);
                expect(result2).toEqual([[0.1, 0.2, 0.3]]);
                expect(mockEmbedWithCache).toHaveBeenCalledTimes(2);
            });

            it('should handle mixed success and failure calls', async () => {
                const mockEmbedWithCache = jest
                    .fn()
                    .mockResolvedValueOnce([[0.1, 0.2, 0.3]])
                    .mockRejectedValueOnce(new Error('Embedding failed'))
                    .mockResolvedValueOnce([[0.7, 0.8, 0.9]]);

                (service as any).cachedEmbeddingsService = {
                    embedWithCache: mockEmbedWithCache,
                };

                const params1: IAIProvidersEmbedParams = {
                    provider: mockProvider,
                    input: 'success text 1',
                };

                const params2: IAIProvidersEmbedParams = {
                    provider: mockProvider,
                    input: 'failure text',
                };

                const params3: IAIProvidersEmbedParams = {
                    provider: mockProvider,
                    input: 'success text 2',
                };

                // Make calls with mixed results
                const result1 = await service.embed(params1);
                await expect(service.embed(params2)).rejects.toThrow(
                    'Embedding failed'
                );
                const result3 = await service.embed(params3);

                // Verify successful calls work correctly
                expect(result1).toEqual([[0.1, 0.2, 0.3]]);
                expect(result3).toEqual([[0.7, 0.8, 0.9]]);

                // Verify all calls were attempted
                expect(mockEmbedWithCache).toHaveBeenCalledTimes(3);
            });
        });
    });

    describe('basic functionality', () => {
        it('should initialize with correct version', () => {
            expect(service.version).toBe(1);
        });

        it('should initialize with providers from plugin settings', () => {
            const providers = [mockProvider];
            const pluginWithProviders = {
                ...mockPlugin,
                settings: { ...mockPlugin.settings, providers },
            } as AIProvidersPlugin;

            const serviceWithProviders = new AIProvidersService(
                mockApp,
                pluginWithProviders
            );
            expect(serviceWithProviders.providers).toEqual(providers);
        });

        it('should initialize embeddings cache', async () => {
            const { embeddingsCache } = jest.requireMock(
                './cache/EmbeddingsCache'
            );

            await service.initEmbeddingsCache();

            expect(embeddingsCache.init).toHaveBeenCalledWith('test-app-id');
        });

        it('should handle cache initialization errors gracefully', async () => {
            const { embeddingsCache } = jest.requireMock(
                './cache/EmbeddingsCache'
            );
            embeddingsCache.init.mockRejectedValue(
                new Error('Cache init failed')
            );

            // Should not throw
            await expect(
                service.initEmbeddingsCache()
            ).resolves.toBeUndefined();
        });
    });

    describe('generateCacheKey', () => {
        it('should generate consistent cache keys for same input', async () => {
            const mockHashBuffer = new ArrayBuffer(32);
            new Uint8Array(mockHashBuffer).fill(42);

            global.crypto = {
                subtle: {
                    digest: jest.fn().mockResolvedValue(mockHashBuffer),
                },
            } as any;

            const params: IAIProvidersEmbedParams = {
                provider: mockProvider,
                input: 'test content',
            };

            const key1 = await (service as any).generateCacheKey(params, ['test content']);
            const key2 = await (service as any).generateCacheKey(params, ['test content']);

            expect(key1).toBe(key2);
            expect(key1).toBe('embed:test-provider:gpt-3.5-turbo:2a2a2a2a2a2a2a2a2a2a');
        });

        it('should include provider info in cache key', async () => {
            const mockHashBuffer = new ArrayBuffer(32);
            new Uint8Array(mockHashBuffer).fill(255);

            global.crypto = {
                subtle: {
                    digest: jest.fn().mockResolvedValue(mockHashBuffer),
                },
            } as any;

            const params: IAIProvidersEmbedParams = {
                provider: {
                    ...mockProvider,
                    id: 'different-provider',
                    model: 'different-model',
                },
                input: 'test content',
            };

            const key = await (service as any).generateCacheKey(params, ['test content']);
            expect(key).toBe('embed:different-provider:different-model:ffffffffffffffffffff');
        });
    });

    describe('cleanup', () => {
        it('should cleanup embeddings cache', async () => {
            const { embeddingsCache } = jest.requireMock(
                './cache/EmbeddingsCache'
            );

            await service.cleanup();

            expect(embeddingsCache.close).toHaveBeenCalled();
        });

        it('should handle cleanup errors gracefully', async () => {
            const { embeddingsCache } = jest.requireMock(
                './cache/EmbeddingsCache'
            );
            embeddingsCache.close.mockRejectedValue(
                new Error('Cleanup failed')
            );

            // Should not throw
            await expect(service.cleanup()).resolves.toBeUndefined();
        });
    });
});
