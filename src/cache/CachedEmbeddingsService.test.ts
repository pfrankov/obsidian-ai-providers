import type { Mock } from 'vitest';
import { CachedEmbeddingsService } from './CachedEmbeddingsService';
import { embeddingsCache } from './EmbeddingsCache';
import {
    IAIProvider,
    IAIProvidersEmbedParams,
} from '@obsidian-ai-providers/sdk';
import { EmbeddingChunk } from './CachedEmbeddingsService';

// Mock dependencies
vi.mock('./EmbeddingsCache');
vi.mock('../utils/logger');

describe('CachedEmbeddingsService', () => {
    let service: CachedEmbeddingsService;
    let mockEmbedFunction: Mock;
    let mockProvider: IAIProvider;

    beforeEach(() => {
        mockEmbedFunction = vi.fn();
        service = new CachedEmbeddingsService(mockEmbedFunction);

        mockProvider = {
            id: 'test-provider',
            name: 'Test Provider',
            type: 'openai' as const,
            model: 'test-model',
        };

        vi.clearAllMocks();
        (embeddingsCache.setEmbeddings as Mock).mockResolvedValue(undefined);
    });

    it('should use cached embeddings when available', async () => {
        const params = {
            provider: mockProvider,
            input: ['test text'],
            chunks: ['test text'],
        };

        const cachedData = {
            providerId: 'test-provider',
            providerModel: 'test-model',
            chunks: [{ content: 'test text', embedding: [0.1, 0.2, 0.3] }],
        };

        (embeddingsCache.getEmbeddings as Mock).mockResolvedValue(cachedData);

        const result = await service.embedWithCache(params);

        expect(embeddingsCache.getEmbeddings).toHaveBeenCalledWith(
            expect.stringMatching(/^embed:v2:[a-f0-9]{64}$/)
        );
        expect(mockEmbedFunction).not.toHaveBeenCalled();
        expect(result).toEqual([[0.1, 0.2, 0.3]]);
    });

    it('should call embedFunction directly when chunks are not provided', async () => {
        mockEmbedFunction.mockResolvedValue([[0.9, 0.8, 0.7]]);
        const result = await service.embedWithCache({
            provider: mockProvider,
            input: 'direct',
        });

        expect(mockEmbedFunction).toHaveBeenCalledWith({
            provider: mockProvider,
            input: 'direct',
        });
        expect(result).toEqual([[0.9, 0.8, 0.7]]);
    });

    it('should generate new embeddings when provider changes', async () => {
        const params = {
            provider: mockProvider,
            input: ['test text'],
            chunks: ['test text'],
        };

        const cachedData = {
            providerId: 'old-provider', // Different provider
            providerModel: 'test-model',
            chunks: [{ content: 'test text', embedding: [0.1, 0.2, 0.3] }],
        };

        (embeddingsCache.getEmbeddings as Mock).mockResolvedValue(cachedData);
        mockEmbedFunction.mockResolvedValue([[0.4, 0.5, 0.6]]);

        const result = await service.embedWithCache(params);

        expect(mockEmbedFunction).toHaveBeenCalledWith({
            ...params,
            input: ['test text'],
            onProgress: undefined,
        });
        expect(result).toEqual([[0.4, 0.5, 0.6]]);
    });

    it('should throw when aborted before embedding', async () => {
        const abortController = new AbortController();
        abortController.abort();

        await expect(
            service.embedWithCache({
                provider: mockProvider,
                input: ['test text'],
                chunks: ['test text'],
                abortController,
            } as any)
        ).rejects.toThrow('Aborted');
    });

    it('throws when aborted before embedding uncached chunks', async () => {
        const abortController = new AbortController();

        (service as any).generateCacheKey = vi
            .fn()
            .mockResolvedValue('embed:test-provider:test-model');
        (service as any).loadCachedChunks = vi
            .fn()
            .mockImplementation(async () => {
                abortController.abort();
                return new Map();
            });

        await expect(
            service.embedWithCache({
                provider: mockProvider,
                input: ['test text'],
                chunks: ['test text'],
                abortController,
            } as any)
        ).rejects.toThrow('Aborted');
    });

    it('throws when aborted inside embedAndCacheChunks', async () => {
        const abortController = new AbortController();
        abortController.abort();

        await expect(
            (service as any).embedAndCacheChunks(
                {
                    provider: mockProvider,
                    input: ['test text'],
                    chunks: ['test text'],
                    abortController,
                },
                ['test text'],
                {
                    chunksMap: new Map(),
                    cacheKey: 'embed:test-provider:test-model',
                }
            )
        ).rejects.toThrow('Aborted');
    });

    it('should handle cache errors gracefully', async () => {
        const params = {
            provider: mockProvider,
            input: ['test text'],
            chunks: ['test text'],
        };

        (embeddingsCache.getEmbeddings as Mock).mockRejectedValue(
            new Error('Cache error')
        );
        mockEmbedFunction.mockResolvedValue([[0.1, 0.2, 0.3]]);

        const result = await service.embedWithCache(params);

        expect(mockEmbedFunction).toHaveBeenCalledWith({
            ...params,
            input: ['test text'],
            onProgress: undefined,
        });
        expect(result).toEqual([[0.1, 0.2, 0.3]]);
    });

    it('should skip cache save when provider model is missing', async () => {
        const providerWithoutModel = { ...mockProvider, model: '' };
        (embeddingsCache.getEmbeddings as Mock).mockResolvedValue(null);
        mockEmbedFunction.mockResolvedValue([[0.2, 0.3, 0.4]]);

        await service.embedWithCache({
            provider: providerWithoutModel,
            input: ['test text'],
            chunks: ['test text'],
        });

        expect(embeddingsCache.setEmbeddings).not.toHaveBeenCalled();
    });

    it('should continue when cache save fails', async () => {
        (embeddingsCache.getEmbeddings as Mock).mockResolvedValue(null);
        (embeddingsCache.setEmbeddings as Mock).mockRejectedValueOnce(
            new Error('write error')
        );
        mockEmbedFunction.mockResolvedValue([[0.5, 0.6, 0.7]]);

        const result = await service.embedWithCache({
            provider: mockProvider,
            input: ['test text'],
            chunks: ['test text'],
        });

        expect(result).toEqual([[0.5, 0.6, 0.7]]);
    });

    it('should embed only new chunks and use cache for existing ones', async () => {
        const params = {
            provider: mockProvider,
            input: ['cached text', 'new text'],
            chunks: ['cached text', 'new text'],
        };

        const cachedData = {
            providerId: 'test-provider',
            providerModel: 'test-model',
            chunks: [{ content: 'cached text', embedding: [0.1, 0.2, 0.3] }],
        };

        (embeddingsCache.getEmbeddings as Mock).mockResolvedValue(cachedData);
        mockEmbedFunction.mockResolvedValue([[0.4, 0.5, 0.6]]); // Embedding for 'new text'

        const result = await service.embedWithCache(params);

        expect(embeddingsCache.getEmbeddings).toHaveBeenCalledWith(
            expect.stringMatching(/^embed:v2:[a-f0-9]{64}$/)
        );
        expect(mockEmbedFunction).toHaveBeenCalledWith({
            ...params,
            input: ['new text'],
            onProgress: undefined,
        });
        expect(result).toEqual([
            [0.1, 0.2, 0.3], // from cache
            [0.4, 0.5, 0.6], // from new embedding
        ]);

        const expectedChunksToCache: EmbeddingChunk[] = [
            { content: 'new text', embedding: [0.4, 0.5, 0.6] },
        ];

        // Use expect.any(Array) for the chunks because the order is not guaranteed
        expect(embeddingsCache.setEmbeddings).toHaveBeenCalledWith(
            expect.stringMatching(/^embed:v2:[a-f0-9]{64}$/),
            {
                providerId: 'test-provider',
                providerModel: 'test-model',
                chunks: expect.any(Array),
            }
        );

        const actualCachedChunks = (embeddingsCache.setEmbeddings as Mock).mock
            .calls[0][1].chunks;
        expect(actualCachedChunks).toEqual(expectedChunksToCache);
    });

    it('reports progress for cached chunks', async () => {
        const onProgress = vi.fn();
        const params = {
            provider: mockProvider,
            input: ['test text'],
            chunks: ['test text'],
            onProgress,
        };

        (embeddingsCache.getEmbeddings as Mock).mockResolvedValue({
            providerId: 'test-provider',
            providerModel: 'test-model',
            chunks: [{ content: 'test text', embedding: [0.1, 0.2, 0.3] }],
        });

        await service.embedWithCache(params as any);

        expect(onProgress).toHaveBeenCalledWith(['test text']);
    });

    it('deduplicates missing inputs and reports cached and processed occurrences in input order', async () => {
        const chunks = ['first', 'cached', 'later', 'first', 'cached', 'later'];
        const cachedEmbedding = [1, 1];
        const firstEmbedding = [1, 0];
        const laterEmbedding = [0, 1];
        const onProgress = vi.fn();
        (embeddingsCache.getEmbeddings as Mock).mockResolvedValue({
            providerId: mockProvider.id,
            providerModel: mockProvider.model,
            chunks: [{ content: 'cached', embedding: cachedEmbedding }],
        });
        mockEmbedFunction.mockImplementation(
            async (params: IAIProvidersEmbedParams) => {
                params.onProgress?.([]);
                params.onProgress?.(['later', 'unrelated']);
                params.onProgress?.(['later', 'first']);
                return [firstEmbedding, laterEmbedding];
            }
        );

        const result = await service.embedWithCache({
            provider: mockProvider,
            input: chunks,
            chunks,
            onProgress,
        });

        expect(mockEmbedFunction.mock.calls[0][0].input).toEqual([
            'first',
            'later',
        ]);
        expect(onProgress.mock.calls).toEqual([
            [['cached', 'cached']],
            [['cached', 'later', 'cached', 'later']],
            [chunks],
            [chunks],
        ]);
        expect(result).toEqual([
            firstEmbedding,
            cachedEmbedding,
            laterEmbedding,
            firstEmbedding,
            cachedEmbedding,
            laterEmbedding,
        ]);
        expect(result[0]).toBe(result[3]);
        expect(result[2]).toBe(result[5]);
    });

    it('retains duplicate occurrences in all-hit progress and results', async () => {
        const chunks = ['cached', 'cached'];
        const onProgress = vi.fn();
        (embeddingsCache.getEmbeddings as Mock).mockResolvedValue({
            providerId: mockProvider.id,
            providerModel: mockProvider.model,
            chunks: [{ content: 'cached', embedding: [1, 0] }],
        });

        const result = await service.embedWithCache({
            provider: mockProvider,
            input: chunks,
            chunks,
            onProgress,
        });

        expect(mockEmbedFunction).not.toHaveBeenCalled();
        expect(embeddingsCache.setEmbeddings).not.toHaveBeenCalled();
        expect(onProgress.mock.calls).toEqual([[chunks]]);
        expect(result).toEqual([
            [1, 0],
            [1, 0],
        ]);
    });

    it('observes cancellation after generating the cache key before reading', async () => {
        const abortController = new AbortController();
        const onProgress = vi.fn();
        vi.spyOn(service as any, 'generateCacheKey').mockImplementation(
            async () => {
                abortController.abort();
                return 'cache-key';
            }
        );

        await expect(
            service.embedWithCache({
                provider: mockProvider,
                input: ['text'],
                chunks: ['text'],
                abortController,
                onProgress,
            })
        ).rejects.toThrow('Aborted');
        expect(embeddingsCache.getEmbeddings).not.toHaveBeenCalled();
        expect(mockEmbedFunction).not.toHaveBeenCalled();
        expect(onProgress).not.toHaveBeenCalled();
    });

    it.each(['hit', 'miss', 'failure'])(
        'observes cancellation during a cache read: %s',
        async outcome => {
            const abortController = new AbortController();
            const onProgress = vi.fn();
            (embeddingsCache.getEmbeddings as Mock).mockImplementation(
                async () => {
                    abortController.abort();
                    if (outcome === 'failure') throw new Error('read failed');
                    return outcome === 'hit'
                        ? {
                              providerId: mockProvider.id,
                              providerModel: mockProvider.model,
                              chunks: [{ content: 'text', embedding: [1, 0] }],
                          }
                        : undefined;
                }
            );

            await expect(
                service.embedWithCache({
                    provider: mockProvider,
                    input: ['text'],
                    chunks: ['text'],
                    abortController,
                    onProgress,
                })
            ).rejects.toThrow('Aborted');
            expect(mockEmbedFunction).not.toHaveBeenCalled();
            expect(embeddingsCache.setEmbeddings).not.toHaveBeenCalled();
            expect(onProgress).not.toHaveBeenCalled();
        }
    );

    it.each([false, true])(
        'observes cancellation at provider completion, with progress: %s',
        async reportsProgress => {
            const abortController = new AbortController();
            const onProgress = vi.fn();
            (embeddingsCache.getEmbeddings as Mock).mockResolvedValue(
                undefined
            );
            mockEmbedFunction.mockImplementation(
                async (params: IAIProvidersEmbedParams) => {
                    abortController.abort();
                    if (reportsProgress) params.onProgress?.(['text']);
                    return [[1, 0]];
                }
            );

            await expect(
                service.embedWithCache({
                    provider: mockProvider,
                    input: ['text'],
                    chunks: ['text'],
                    abortController,
                    onProgress,
                })
            ).rejects.toThrow('Aborted');
            expect(embeddingsCache.setEmbeddings).not.toHaveBeenCalled();
            expect(onProgress).not.toHaveBeenCalled();
        }
    );

    it('preserves a provider rejection during cancellation', async () => {
        const abortController = new AbortController();
        const onProgress = vi.fn();
        const providerError = new Error('Request was aborted.');
        providerError.name = 'AbortError';
        (embeddingsCache.getEmbeddings as Mock).mockResolvedValue(undefined);
        mockEmbedFunction.mockImplementation(async () => {
            abortController.abort();
            throw providerError;
        });

        await expect(
            service.embedWithCache({
                provider: mockProvider,
                input: ['text'],
                chunks: ['text'],
                abortController,
                onProgress,
            })
        ).rejects.toBe(providerError);
        expect(embeddingsCache.setEmbeddings).not.toHaveBeenCalled();
        expect(onProgress).not.toHaveBeenCalled();
    });

    it('does not save when a provider progress callback cancels the request', async () => {
        const abortController = new AbortController();
        const onProgress = vi.fn(() => abortController.abort());
        (embeddingsCache.getEmbeddings as Mock).mockResolvedValue(undefined);
        mockEmbedFunction.mockImplementation(
            async (params: IAIProvidersEmbedParams) => {
                params.onProgress?.(['text']);
                return [[1, 0]];
            }
        );

        await expect(
            service.embedWithCache({
                provider: mockProvider,
                input: ['text'],
                chunks: ['text'],
                abortController,
                onProgress,
            })
        ).rejects.toThrow('Aborted');
        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(embeddingsCache.setEmbeddings).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        'observes cancellation after a cache write, with write failure: %s',
        async fails => {
            const abortController = new AbortController();
            const onProgress = vi.fn();
            (embeddingsCache.getEmbeddings as Mock).mockResolvedValue(
                undefined
            );
            mockEmbedFunction.mockResolvedValue([[1, 0]]);
            (embeddingsCache.setEmbeddings as Mock).mockImplementation(
                async () => {
                    abortController.abort();
                    if (fails) throw new Error('write failed');
                }
            );

            await expect(
                service.embedWithCache({
                    provider: mockProvider,
                    input: ['text'],
                    chunks: ['text'],
                    abortController,
                    onProgress,
                })
            ).rejects.toThrow('Aborted');
            expect(onProgress).not.toHaveBeenCalled();
        }
    );

    it.each([false, true])(
        'observes cancellation in final progress, with cache hit: %s',
        async cached => {
            const abortController = new AbortController();
            const onProgress = vi.fn(() => abortController.abort());
            (embeddingsCache.getEmbeddings as Mock).mockResolvedValue(
                cached
                    ? {
                          providerId: mockProvider.id,
                          providerModel: mockProvider.model,
                          chunks: [{ content: 'text', embedding: [1, 0] }],
                      }
                    : undefined
            );
            mockEmbedFunction.mockResolvedValue([[1, 0]]);

            await expect(
                service.embedWithCache({
                    provider: mockProvider,
                    input: ['text'],
                    chunks: ['text'],
                    abortController,
                    onProgress,
                })
            ).rejects.toThrow('Aborted');
            expect(onProgress.mock.calls).toEqual([[['text']]]);
        }
    );

    it('rejects an incomplete provider result before final progress', async () => {
        const onProgress = vi.fn();
        (embeddingsCache.getEmbeddings as Mock).mockResolvedValue(undefined);
        mockEmbedFunction.mockResolvedValue([]);

        await expect(
            service.embedWithCache({
                provider: mockProvider,
                input: ['missing'],
                chunks: ['missing'],
                onProgress,
            })
        ).rejects.toThrow('Missing embedding for chunk');
        expect(onProgress).not.toHaveBeenCalled();
    });

    it('throws when a chunk embedding is missing', async () => {
        (service as any).generateCacheKey = vi
            .fn()
            .mockResolvedValue('embed:test-provider:test-model');
        (service as any).loadCachedChunks = vi
            .fn()
            .mockResolvedValue(new Map());
        (service as any).embedAndCacheChunks = vi.fn();

        await expect(
            service.embedWithCache({
                provider: mockProvider,
                input: ['missing'],
                chunks: ['missing'],
            })
        ).rejects.toThrow('Missing embedding for chunk');
    });
});
