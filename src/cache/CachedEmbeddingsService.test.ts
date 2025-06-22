import { CachedEmbeddingsService } from './CachedEmbeddingsService';
import { embeddingsCache } from './EmbeddingsCache';
import {
    IAIProvidersEmbedParams,
    IAIProvider,
} from '@obsidian-ai-providers/sdk';

// Local type for tests
interface TestCachedEmbedParams extends IAIProvidersEmbedParams {
    cacheKey?: string;
    chunks?: string[];
}

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

        // Reset mocks
        jest.clearAllMocks();
    });

    describe('embedWithCache', () => {
        it('should call embed function directly when no cache key provided', async () => {
            const params: TestCachedEmbedParams = {
                provider: mockProvider,
                input: ['test text'],
            };

            mockEmbedFunction.mockResolvedValue([[0.1, 0.2, 0.3]]);

            const result = await service.embedWithCache(params);

            expect(mockEmbedFunction).toHaveBeenCalledWith(params);
            expect(embeddingsCache.getEmbeddings).not.toHaveBeenCalled();
            expect(result).toEqual([[0.1, 0.2, 0.3]]);
        });

        it('should use cached embeddings when available', async () => {
            const params: TestCachedEmbedParams = {
                provider: mockProvider,
                input: ['test text'],
                cacheKey: 'test-key',
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
                'test-key'
            );
            expect(mockEmbedFunction).not.toHaveBeenCalled();
            expect(result).toEqual([[0.1, 0.2, 0.3]]);
        });

        it('should generate new embeddings when provider changes', async () => {
            const params: TestCachedEmbedParams = {
                provider: mockProvider,
                input: ['test text'],
                cacheKey: 'test-key',
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

            expect(embeddingsCache.getEmbeddings).toHaveBeenCalledWith(
                'test-key'
            );
            expect(mockEmbedFunction).toHaveBeenCalledWith(params);
            expect(result).toEqual([[0.4, 0.5, 0.6]]);
        });

        it('should generate new embeddings when model changes', async () => {
            const params: TestCachedEmbedParams = {
                provider: mockProvider,
                input: ['test text'],
                cacheKey: 'test-key',
                chunks: ['test text'],
            };

            const cachedData = {
                providerId: 'test-provider',
                providerModel: 'old-model', // Different model
                chunks: [{ content: 'test text', embedding: [0.1, 0.2, 0.3] }],
            };

            (embeddingsCache.getEmbeddings as jest.Mock).mockResolvedValue(
                cachedData
            );
            mockEmbedFunction.mockResolvedValue([[0.7, 0.8, 0.9]]);

            const result = await service.embedWithCache(params);

            expect(embeddingsCache.getEmbeddings).toHaveBeenCalledWith(
                'test-key'
            );
            expect(mockEmbedFunction).toHaveBeenCalledWith(params);
            expect(embeddingsCache.setEmbeddings).toHaveBeenCalledWith(
                'test-key',
                {
                    providerId: 'test-provider',
                    providerModel: 'test-model',
                    chunks: [
                        { content: 'test text', embedding: [0.7, 0.8, 0.9] },
                    ],
                }
            );
            expect(result).toEqual([[0.7, 0.8, 0.9]]);
        });

        it("should generate new embeddings when chunks don't match", async () => {
            const params: TestCachedEmbedParams = {
                provider: mockProvider,
                input: ['new text'],
                cacheKey: 'test-key',
                chunks: ['new text'],
            };

            const cachedData = {
                providerId: 'test-provider',
                providerModel: 'test-model',
                chunks: [{ content: 'old text', embedding: [0.1, 0.2, 0.3] }],
            };

            (embeddingsCache.getEmbeddings as jest.Mock).mockResolvedValue(
                cachedData
            );
            mockEmbedFunction.mockResolvedValue([[0.7, 0.8, 0.9]]);

            const result = await service.embedWithCache(params);

            expect(mockEmbedFunction).toHaveBeenCalledWith(params);
            expect(result).toEqual([[0.7, 0.8, 0.9]]);
        });

        it('should handle cache errors gracefully', async () => {
            const params: TestCachedEmbedParams = {
                provider: mockProvider,
                input: ['test text'],
                cacheKey: 'test-key',
            };

            (embeddingsCache.getEmbeddings as jest.Mock).mockRejectedValue(
                new Error('Cache error')
            );
            mockEmbedFunction.mockResolvedValue([[0.1, 0.2, 0.3]]);

            const result = await service.embedWithCache(params);

            expect(mockEmbedFunction).toHaveBeenCalledWith(params);
            expect(result).toEqual([[0.1, 0.2, 0.3]]);
        });
    });
});
