import type { Mock } from 'vitest';
import { CachedEmbeddingsService } from './CachedEmbeddingsService';
import { embeddingsCache } from './EmbeddingsCache';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
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
            'embed:test-provider:test-model'
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
                new Map(),
                'embed:test-provider:test-model'
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
            'embed:test-provider:test-model'
        );
        expect(mockEmbedFunction).toHaveBeenCalledWith({
            ...params,
            input: ['new text'],
        });
        expect(result).toEqual([
            [0.1, 0.2, 0.3], // from cache
            [0.4, 0.5, 0.6], // from new embedding
        ]);

        const expectedChunksToCache: EmbeddingChunk[] = [
            { content: 'cached text', embedding: [0.1, 0.2, 0.3] },
            { content: 'new text', embedding: [0.4, 0.5, 0.6] },
        ];

        // Use expect.any(Array) for the chunks because the order is not guaranteed
        expect(embeddingsCache.setEmbeddings).toHaveBeenCalledWith(
            'embed:test-provider:test-model',
            {
                providerId: 'test-provider',
                providerModel: 'test-model',
                chunks: expect.any(Array),
            }
        );

        const actualCachedChunks = (embeddingsCache.setEmbeddings as Mock).mock
            .calls[0][1].chunks;
        expect(actualCachedChunks).toHaveLength(2);
        expect(actualCachedChunks).toContainEqual(expectedChunksToCache[0]);
        expect(actualCachedChunks).toContainEqual(expectedChunksToCache[1]);
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
});
