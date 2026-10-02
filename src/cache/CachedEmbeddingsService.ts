import {
    IAIProvider,
    IAIProvidersEmbedParams,
} from '@obsidian-ai-providers/sdk';
import { embeddingsCache } from './EmbeddingsCache';
import { logger } from '../utils/logger';
import { createSecureHash } from '../utils/hashUtils';

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
        params = { ...params, provider: { ...params.provider } };
        if (!params.chunks) {
            return this.embedFunction(params);
        }

        const abortController = params.abortController;
        this.ensureNotAborted(abortController);

        const cacheKey = await this.generateCacheKey(params);
        this.ensureNotAborted(abortController);

        const { chunks, onProgress } = params;
        const chunksMap = await this.loadCachedChunks(params, cacheKey);
        this.ensureNotAborted(abortController);
        const uncachedChunks = [
            ...new Set(chunks.filter(content => !chunksMap.has(content))),
        ];

        if (uncachedChunks.length > 0) {
            await this.embedAndCacheChunks(
                {
                    ...params,
                    onProgress: onProgress
                        ? processedChunkTexts => {
                              this.ensureNotAborted(abortController);
                              const processed = new Set(processedChunkTexts);
                              onProgress(
                                  chunks.filter(
                                      content =>
                                          chunksMap.has(content) ||
                                          processed.has(content)
                                  )
                              );
                          }
                        : undefined,
                },
                uncachedChunks,
                { chunksMap, cacheKey }
            );
        }

        const embeddings = chunks.map(content => {
            const embedding = chunksMap.get(content);
            if (!embedding) {
                throw new Error('Missing embedding for chunk');
            }
            return embedding;
        });
        this.ensureNotAborted(abortController);
        onProgress?.(chunks);
        this.ensureNotAborted(abortController);
        return embeddings;
    }

    private ensureNotAborted(abortController?: AbortController): void {
        if (abortController?.signal.aborted) {
            throw new Error('Aborted');
        }
    }

    private async embedAndCacheChunks(
        params: CachedEmbedParams,
        uncachedChunks: string[],
        cache: { chunksMap: Map<string, number[]>; cacheKey: string | null }
    ) {
        const { chunksMap, cacheKey } = cache;
        const abortController = params.abortController;
        this.ensureNotAborted(abortController);
        const newEmbeddings = await this.embedFunction({
            ...params,
            input: uncachedChunks,
        });
        this.ensureNotAborted(abortController);
        const additions = uncachedChunks.map((content, i) => {
            const embedding = newEmbeddings[i];
            chunksMap.set(content, embedding);
            return { content, embedding };
        });
        await this.saveCachedChunks(cacheKey, params.provider, additions);
        this.ensureNotAborted(abortController);
    }

    private async loadCachedChunks(
        params: CachedEmbedParams,
        cacheKey: string | null
    ): Promise<Map<string, number[]>> {
        if (cacheKey === null) return new Map();
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
        cacheKey: string | null,
        provider: IAIProvider,
        additions: EmbeddingChunk[]
    ): Promise<void> {
        if (cacheKey === null || !provider.model) return;

        await embeddingsCache
            .setEmbeddings(cacheKey, {
                providerId: provider.id,
                providerModel: provider.model,
                chunks: additions,
            })
            .catch(error => {
                logger.error('Error writing to embeddings cache:', error);
            });
    }

    private async generateCacheKey(
        params: IAIProvidersEmbedParams
    ): Promise<string | null> {
        const { id, type, url, model } = params.provider;
        try {
            const hash = await createSecureHash(
                JSON.stringify([id, type, url || '', model]),
                64
            );
            return `embed:v2:${hash}`;
        } catch {
            logger.error('Error generating embeddings cache key');
            return null;
        }
    }
}
