import { IAIProvidersEmbedParams } from '@obsidian-ai-providers/sdk';
import { embeddingsCache } from './EmbeddingsCache';
import { logger } from '../utils/logger';

export interface EmbeddingChunk {
    content: string;
    embedding: number[];
}

interface CachedEmbedParams extends IAIProvidersEmbedParams {
    cacheKey?: string;
    chunks?: string[];
}

interface CachedEmbeddingData {
    providerId: string;
    providerModel: string;
    chunks: EmbeddingChunk[];
}

export class CachedEmbeddingsService {
    constructor(
        private embedFunction: (
            params: IAIProvidersEmbedParams
        ) => Promise<number[][]>
    ) {}

    /**
     * Generate embeddings with caching support
     */
    async embedWithCache(params: CachedEmbedParams): Promise<number[][]> {
        // If no cache key provided, directly call embed function
        if (!params.cacheKey) {
            return this.embedFunction(params);
        }

        try {
            const cached = await embeddingsCache.getEmbeddings(params.cacheKey);

            // Try to use cached embeddings if valid
            const cachedResult = this.tryUseCachedEmbeddings(cached, params);
            if (cachedResult) {
                return cachedResult;
            }

            // Generate and cache new embeddings
            return this.generateAndCacheEmbeddings(params);
        } catch (error) {
            logger.error('Error in embedWithCache:', error);
            // Fall back to direct embedding on cache error
            return this.embedFunction(params);
        }
    }

    /**
     * Try to use cached embeddings if they are valid
     */
    private tryUseCachedEmbeddings(
        cached: CachedEmbeddingData | undefined,
        params: CachedEmbedParams
    ): number[][] | null {
        if (!cached) {
            return null;
        }

        // Check if cache is valid (provider/model)
        if (!this.isCacheValid(cached, params)) {
            return null;
        }

        // If chunks are provided, ensure they match
        if (params.chunks && !this.chunksMatch(params.chunks, cached.chunks)) {
            return null;
        }

        return cached.chunks.map((chunk: EmbeddingChunk) => chunk.embedding);
    }

    /**
     * Check if cached data is valid
     */
    private isCacheValid(
        cached: CachedEmbeddingData,
        params: CachedEmbedParams
    ): boolean {
        // If provider doesn't have a model, cache is invalid
        if (!params.provider.model) {
            return false;
        }

        return (
            cached.providerId === params.provider.id &&
            cached.providerModel === params.provider.model
        );
    }

    /**
     * Check if chunks match with cached chunks (more efficient comparison)
     */
    private chunksMatch(
        newChunks: string[],
        cachedChunks: EmbeddingChunk[]
    ): boolean {
        if (newChunks.length !== cachedChunks.length) {
            return false;
        }

        // Use early return for better performance
        for (let i = 0; i < newChunks.length; i++) {
            if (newChunks[i] !== cachedChunks[i].content) {
                return false;
            }
        }

        return true;
    }

    /**
     * Generate new embeddings and cache them
     */
    private async generateAndCacheEmbeddings(
        params: CachedEmbedParams
    ): Promise<number[][]> {
        const embeddings = await this.embedFunction(params);

        // Cache the embeddings if chunks are provided
        if (params.chunks && embeddings.length === params.chunks.length) {
            await this.cacheEmbeddings(params, embeddings);
        }

        return embeddings;
    }

    /**
     * Cache the generated embeddings
     */
    private async cacheEmbeddings(
        params: CachedEmbedParams,
        embeddings: number[][]
    ): Promise<void> {
        // Only cache if provider has a model specified
        if (!params.provider.model) {
            return;
        }

        const chunks: EmbeddingChunk[] = params.chunks!.map(
            (content, index) => ({
                content,
                embedding: embeddings[index],
            })
        );

        await embeddingsCache.setEmbeddings(params.cacheKey!, {
            providerId: params.provider.id,
            providerModel: params.provider.model,
            chunks,
        });
    }
}
