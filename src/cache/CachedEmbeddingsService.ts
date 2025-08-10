import { IAIProvidersEmbedParams } from '@obsidian-ai-providers/sdk';
import { embeddingsCache } from './EmbeddingsCache';
import { logger } from '../utils/logger';
import { createCacheKeyHash } from '../utils/hashUtils';

export interface EmbeddingChunk {
    content: string;
    embedding: number[];
}

interface CachedEmbedParams extends IAIProvidersEmbedParams {
    chunks?: string[];
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
        if (!params.chunks) {
            return this.embedFunction(params);
        }

        const abortController: AbortController | undefined = (params as any)
            .abortController;
        if (abortController?.signal.aborted) {
            throw new Error('Aborted');
        }

        const cacheKey = await this.generateCacheKey(params);

        const { chunks } = params;
        const chunksMap = await this.loadCachedChunks(params, cacheKey);
        const uncachedChunks = chunks.filter(
            content => !chunksMap.has(content)
        );

        if (uncachedChunks.length > 0) {
            if (abortController?.signal.aborted) {
                throw new Error('Aborted');
            }
            await this.embedAndCacheChunks(
                params,
                uncachedChunks,
                chunksMap,
                cacheKey
            );
        }

        params.onProgress?.(chunks);
        return chunks.map(content => chunksMap.get(content)!);
    }

    private async embedAndCacheChunks(
        params: CachedEmbedParams,
        uncachedChunks: string[],
        chunksMap: Map<string, number[]>,
        cacheKey: string
    ) {
        const abortController: AbortController | undefined = (params as any)
            .abortController;
        if (abortController?.signal.aborted) {
            throw new Error('Aborted');
        }
        const newEmbeddings = await this.embedFunction({
            ...params,
            input: uncachedChunks,
        });
        uncachedChunks.forEach((content, i) =>
            chunksMap.set(content, newEmbeddings[i])
        );
        await this.saveCachedChunks(cacheKey, params.provider, chunksMap);
    }

    private async loadCachedChunks(
        params: CachedEmbedParams,
        cacheKey: string
    ): Promise<Map<string, number[]>> {
        const cached = await embeddingsCache
            .getEmbeddings(cacheKey)
            .catch(error => {
                logger.error('Error reading from embeddings cache:', error);
                return null;
            });

        if (
            cached?.providerId === params.provider.id &&
            cached?.providerModel === params.provider.model
        ) {
            return new Map(cached.chunks.map(c => [c.content, c.embedding]));
        }

        return new Map();
    }

    private async saveCachedChunks(
        cacheKey: string,
        provider: any,
        chunksMap: Map<string, number[]>
    ): Promise<void> {
        if (!provider.model) return;

        const chunksToCache = Array.from(chunksMap, ([content, embedding]) => ({
            content,
            embedding,
        }));

        await embeddingsCache
            .setEmbeddings(cacheKey, {
                providerId: provider.id,
                providerModel: provider.model,
                chunks: chunksToCache,
            })
            .catch(error => {
                logger.error('Error writing to embeddings cache:', error);
            });
    }

    private async generateCacheKey(
        params: IAIProvidersEmbedParams
    ): Promise<string> {
        return `embed:${params.provider.id}:${params.provider.model}`;
    }
}
