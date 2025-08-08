import { CachedEmbeddingsService } from './CachedEmbeddingsService';
import { embeddingsCache } from './EmbeddingsCache';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
import { EmbeddingChunk } from './CachedEmbeddingsService';

// Mock dependencies
jest.mock('./EmbeddingsCache');
jest.mock('../utils/logger');

describe('CachedEmbeddingsService', () => {
    let service: CachedEmbeddingsService;
    let mockEmbedFunction: jest.Mock;
    let mockProvider: IAIProvider;

    beforeEach(() => {
        mockEmbedFunction = jest.fn();
        service = new CachedEmbeddingsService(mockEmbedFunction);

        mockProvider = {
            id: 'test-provider',
            name: 'Test Provider',
            type: 'openai' as const,
            model: 'test-model',
        };

        jest.clearAllMocks();
        (embeddingsCache.setEmbeddings as jest.Mock).mockResolvedValue(
            undefined
        );
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

        (embeddingsCache.getEmbeddings as jest.Mock).mockResolvedValue(
            cachedData
        );

        const result = await service.embedWithCache(params);

        expect(embeddingsCache.getEmbeddings).toHaveBeenCalledWith(
            'embed:test-provider:test-model'
        );
        expect(mockEmbedFunction).not.toHaveBeenCalled();
        expect(result).toEqual([[0.1, 0.2, 0.3]]);
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

        (embeddingsCache.getEmbeddings as jest.Mock).mockResolvedValue(
            cachedData
        );
        mockEmbedFunction.mockResolvedValue([[0.4, 0.5, 0.6]]);

        const result = await service.embedWithCache(params);

        expect(mockEmbedFunction).toHaveBeenCalledWith({
            ...params,
            input: ['test text'],
        });
        expect(result).toEqual([[0.4, 0.5, 0.6]]);
    });

    it('should handle cache errors gracefully', async () => {
        const params = {
            provider: mockProvider,
            input: ['test text'],
            chunks: ['test text'],
        };

        (embeddingsCache.getEmbeddings as jest.Mock).mockRejectedValue(
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

        (embeddingsCache.getEmbeddings as jest.Mock).mockResolvedValue(
            cachedData
        );
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

        const actualCachedChunks = (embeddingsCache.setEmbeddings as jest.Mock)
            .mock.calls[0][1].chunks;
        expect(actualCachedChunks).toHaveLength(2);
        expect(actualCachedChunks).toContainEqual(expectedChunksToCache[0]);
        expect(actualCachedChunks).toContainEqual(expectedChunksToCache[1]);
    });
});
