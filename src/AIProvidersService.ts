import { App, Notice } from 'obsidian';
import {
    AIProviderType,
    IAIDocument,
    IAIHandler,
    IAIProvider,
    IAIProvidersEmbedParams,
    IAIProvidersExecuteParams,
    IAIProvidersRetrievalParams,
    IAIProvidersRetrievalResult,
    IAIProvidersService,
    IChunkHandler,
} from '@obsidian-ai-providers/sdk';
import { OpenAIHandler } from './handlers/OpenAIHandler';
import { OllamaHandler } from './handlers/OllamaHandler';
import { I18n } from './i18n';
import AIProvidersPlugin from './main';
import { ConfirmationModal } from './modals/ConfirmationModal';
import { CachedEmbeddingsService } from './cache/CachedEmbeddingsService';
import { embeddingsCache } from './cache/EmbeddingsCache';
import { logger } from './utils/logger';
import { preprocessContent, splitContent } from './utils/textProcessing';
import { IAIProvidersRetrievalChunk } from '@obsidian-ai-providers/sdk/types';
import { AnthropicHandler } from './handlers/AnthropicHandler';

export class AIProvidersService implements IAIProvidersService {
    providers: IAIProvider[] = [];
    version = 3;
    private app: App;
    private plugin: AIProvidersPlugin;
    private handlers: Record<string, IAIHandler>;
    private cachedEmbeddingsService: CachedEmbeddingsService;

    constructor(app: App, plugin: AIProvidersPlugin) {
        this.plugin = plugin;
        this.providers = plugin.settings.providers || [];
        this.app = app;

        // Initialize handlers for each provider type
        this.handlers = {
            openai: new OpenAIHandler(plugin.settings),
            openrouter: new OpenAIHandler(plugin.settings),
            ollama: new OllamaHandler(plugin.settings),
            'ollama-openwebui': new OllamaHandler(plugin.settings),
            gemini: new OpenAIHandler(plugin.settings),
            lmstudio: new OpenAIHandler(plugin.settings),
            groq: new OpenAIHandler(plugin.settings),
            ai302: new OpenAIHandler(plugin.settings),
            anthropic: new AnthropicHandler(plugin.settings),
            mistral: new OpenAIHandler(plugin.settings),
            together: new OpenAIHandler(plugin.settings),
            fireworks: new OpenAIHandler(plugin.settings),
            perplexity: new OpenAIHandler(plugin.settings),
            deepseek: new OpenAIHandler(plugin.settings),
            xai: new OpenAIHandler(plugin.settings),
            novita: new OpenAIHandler(plugin.settings),
            deepinfra: new OpenAIHandler(plugin.settings),
            sambanova: new OpenAIHandler(plugin.settings),
            cerebras: new OpenAIHandler(plugin.settings),
            zai: new OpenAIHandler(plugin.settings),
        };

        // Initialize cached embeddings service
        this.cachedEmbeddingsService = new CachedEmbeddingsService(
            this.embedForce.bind(this)
        );
    }

    /**
     * Initialize embeddings cache with vault ID
     * Should be called by the plugin when the app is ready
     */
    async initEmbeddingsCache(): Promise<void> {
        try {
            const vaultId =
                (this.app as unknown as { appId?: string }).appId || 'default';
            await embeddingsCache.init(vaultId);
        } catch (error) {
            logger.error('Failed to initialize embeddings cache:', error);
            // Don't throw - allow the service to work without cache
        }
    }

    private getHandler(type: AIProviderType) {
        return this.handlers[type];
    }

    private async embedForce(
        params: IAIProvidersEmbedParams
    ): Promise<number[][]> {
        const handler = this.getHandler(params.provider.type);
        if (!handler) {
            throw new Error(
                `Handler not found for provider type: ${params.provider.type}`
            );
        }
        return handler.embed(params);
    }

    async embed(params: IAIProvidersEmbedParams): Promise<number[][]> {
        try {
            // Check if input exists
            if (!params.input) {
                throw new Error('Input is required for embedding');
            }

            const abortController = params.abortController;
            if (abortController?.signal.aborted) {
                throw new Error('Aborted');
            }

            // Normalize input to array
            const inputArray = Array.isArray(params.input)
                ? params.input
                : [params.input];

            // Use cached embeddings service with automatic caching
            const cachedParams = {
                ...params,
                input: inputArray,
                chunks: inputArray, // Store input as chunks for caching
            };

            return this.cachedEmbeddingsService.embedWithCache(cachedParams);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : I18n.t('errors.failedToEmbed');
            new Notice(message);
            throw error;
        }
    }

    async fetchModels(
        params:
            | { provider: IAIProvider; abortController?: AbortController }
            | IAIProvider
    ): Promise<string[]> {
        try {
            const provider = 'provider' in params ? params.provider : params;
            const abortController =
                'abortController' in params
                    ? params.abortController
                    : undefined;

            if (abortController?.signal.aborted) {
                throw new Error('Aborted');
            }
            const handler = this.getHandler(provider.type);
            if (!handler || !handler.fetchModels) {
                throw new Error(
                    `Handler not found or does not support fetchModels for provider type: ${provider.type}`
                );
            }
            return handler.fetchModels({ provider, abortController });
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : I18n.t('errors.failedToFetchModels');
            new Notice(message);
            throw error;
        }
    }

    async execute(
        params: IAIProvidersExecuteParams & {
            onProgress?: undefined;
            abortController?: undefined;
        }
    ): Promise<IChunkHandler>;
    async execute(
        params: IAIProvidersExecuteParams &
            (
                | {
                      onProgress?: (
                          chunk: string,
                          accumulatedText: string
                      ) => void;
                  }
                | { abortController?: AbortController }
            )
    ): Promise<string>;
    async execute(
        params: IAIProvidersExecuteParams
    ): Promise<string | IChunkHandler> {
        const handler = this.getHandler(params.provider.type);
        if (!handler) {
            throw new Error(
                `Handler not found for provider type: ${params.provider.type}`
            );
        }

        const extendedParams = params as IAIProvidersExecuteParams & {
            onProgress?: (chunk: string, accumulatedText: string) => void;
            abortController?: AbortController;
        };

        const hasOnData = Boolean(extendedParams.onProgress);
        const hasAbort = Boolean(extendedParams.abortController);
        const useLegacyWrapper = !hasOnData && !hasAbort;

        if (!useLegacyWrapper) {
            // Ensure a provided abortController (if any) is forwarded unchanged
            return await handler.execute(params);
        }

        const internalAbortController = new AbortController();
        const handlers = {
            data: [] as ((chunk: string, accumulatedText: string) => void)[],
            end: [] as ((fullText: string) => void)[],
            error: [] as ((error: Error) => void)[],
        };

        handler
            .execute({
                ...params,
                abortController: internalAbortController,
                onProgress: (chunk: string, acc: string) => {
                    handlers.data.forEach(handler => handler(chunk, acc));
                },
            })
            .then((full: string) => {
                handlers.end.forEach(handler => handler(full));
            })
            .catch((err: unknown) => {
                const errorObj =
                    err instanceof Error ? err : new Error(String(err));
                handlers.error.forEach(handler => handler(errorObj));
            });

        const legacyHandler: IChunkHandler = {
            onData(callback: (chunk: string, accumulatedText: string) => void) {
                handlers.data.push(callback);
            },
            onEnd(callback: (fullText: string) => void) {
                handlers.end.push(callback);
            },
            onError(callback: (error: Error) => void) {
                handlers.error.push(callback);
            },
            abort: () => {
                internalAbortController.abort();
            },
        };
        return legacyHandler;
    }

    async migrateProvider(provider: IAIProvider): Promise<IAIProvider | false> {
        const fieldsToCompare = ['type', 'apiKey', 'url', 'model'] as const;
        this.plugin.settings.providers = this.plugin.settings.providers || [];

        const existingProvider = this.plugin.settings.providers.find(
            (p: IAIProvider) =>
                fieldsToCompare.every(
                    field =>
                        p[field as keyof IAIProvider] ===
                        provider[field as keyof IAIProvider]
                )
        );
        if (existingProvider) {
            return Promise.resolve(existingProvider);
        }

        return new Promise<IAIProvider | false>(resolve => {
            new ConfirmationModal(
                this.app,
                `Migrate provider ${provider.name}?`,
                async () => {
                    this.plugin.settings.providers?.push(provider);
                    await this.plugin.saveSettings();
                    resolve(provider);
                },
                () => {
                    // When canceled, return false to indicate the migration was not performed
                    resolve(false);
                }
            ).open();
        });
    }

    // Allows not passing version with every method call
    checkCompatibility(requiredVersion: number) {
        if (requiredVersion > this.version) {
            new Notice(I18n.t('errors.pluginMustBeUpdatedFormatted'));
            throw new Error(I18n.t('errors.pluginMustBeUpdated'));
        }
    }

    async retrieve(
        params: IAIProvidersRetrievalParams
    ): Promise<IAIProvidersRetrievalResult[]> {
        const abortController = params.abortController;
        if (abortController?.signal.aborted) {
            throw new Error('Aborted');
        }
        // Validate input parameters
        if (!params.query) {
            return [];
        }
        if (!params.documents || params.documents.length === 0) {
            return [];
        }

        // Check if handler exists for provider
        const handler = this.getHandler(params.embeddingProvider.type);
        if (!handler) {
            throw new Error(
                `Handler not found for provider type: ${params.embeddingProvider.type}`
            );
        }

        // Process documents into chunks with references
        const { chunks, totalChunks, documentChunkCounts } =
            this.processDocuments(params.documents);
        if (chunks.length === 0) {
            return [];
        }

        // Initialize progress tracking
        const totalDocuments = params.documents.length;

        // Report initial progress
        params.onProgress?.({
            totalDocuments,
            totalChunks,
            processedDocuments: [],
            processedChunks: [],
            processingType: 'embedding',
        });

        // Generate embeddings for query and chunks
        const [queryEmbedding, chunkEmbeddings] = await Promise.all([
            this.embed({
                provider: params.embeddingProvider,
                input: params.query,
                abortController: params.abortController,
            }),
            this.embed({
                provider: params.embeddingProvider,
                input: chunks.map(chunk => chunk.content),
                abortController: params.abortController,
                onProgress: (processedChunkTexts: string[]) => {
                    if (abortController?.signal.aborted) {
                        return;
                    }
                    const processedChunkCount = processedChunkTexts.length;
                    const processedChunks = chunks.slice(
                        0,
                        processedChunkCount
                    );
                    const processedDocs = this.getProcessedDocs(
                        processedChunks,
                        documentChunkCounts,
                        params.documents
                    );
                    params.onProgress?.({
                        totalDocuments,
                        totalChunks,
                        processedDocuments: processedDocs,
                        processedChunks,
                        processingType: 'embedding',
                    });
                },
            }),
        ]).catch(error => {
            if (params.abortController?.signal?.aborted) {
                throw new Error('Aborted');
            }
            throw error;
        });

        // L2-normalize embeddings so dot product equals cosine similarity.
        // Different providers can output vectors with very different lengths.
        // Normalization keeps similarity stable; without it, a few large vectors may dominate the ranking.
        const normQuery = this.l2Normalize(queryEmbedding[0]);
        const normChunks = chunkEmbeddings.map(e => this.l2Normalize(e));

        // No waiting for fuzzy: vector-only retrieval

        // Report search progress
        params.onProgress?.({
            totalDocuments,
            totalChunks,
            processedDocuments: this.getProcessedDocs(
                chunks,
                documentChunkCounts,
                params.documents
            ),
            processedChunks: chunks,
            processingType: 'embedding',
        });

        // Perform vector-only search
        return this.rankChunks(normQuery, chunks, normChunks);
    }

    private processDocuments(documents: IAIDocument[]) {
        interface ProcessedChunk {
            content: string;
            document: IAIDocument;
        }

        const chunks: ProcessedChunk[] = [];
        const documentChunkCounts: { [docId: string]: number } = {};

        for (const document of documents) {
            const preprocessed = preprocessContent(document.content);
            const documentChunks = splitContent(preprocessed);
            const docId = document.meta?.id || document.content;
            documentChunkCounts[docId] = 0;

            for (const chunk of documentChunks) {
                if (chunk.trim().length > 0) {
                    chunks.push({
                        content: chunk.trim(),
                        document: document,
                    });
                    documentChunkCounts[docId]++;
                }
            }
        }

        return { chunks, totalChunks: chunks.length, documentChunkCounts };
    }

    private getProcessedDocs(
        processedChunks: IAIProvidersRetrievalChunk[],
        documentChunkCounts: { [docId: string]: number },
        documents: IAIDocument[]
    ) {
        const processedChunksPerDoc: { [docId: string]: number } = {};
        for (const chunk of processedChunks) {
            const docId = chunk.document.meta?.id || chunk.document.content;
            processedChunksPerDoc[docId] =
                (processedChunksPerDoc[docId] || 0) + 1;
        }

        const processedDocs: IAIDocument[] = [];
        for (const document of documents) {
            const docId = document.meta?.id || document.content;
            if (
                documentChunkCounts[docId] > 0 &&
                processedChunksPerDoc[docId] === documentChunkCounts[docId]
            ) {
                processedDocs.push(document);
            }
        }

        return processedDocs;
    }

    private rankChunks(
        queryEmbedding: number[],
        chunks: IAIProvidersRetrievalChunk[],
        chunkEmbeddings: number[][]
    ): IAIProvidersRetrievalResult[] {
        // With L2-normalized vectors, dot product equals cosine similarity.
        const similarities = chunkEmbeddings.map(embedding =>
            this.dotProduct(queryEmbedding, embedding)
        );

        return chunks
            .map((chunk, index) => ({
                document: chunk.document,
                score: similarities[index],
                content: chunk.content,
            }))
            .sort((a, b) => b.score - a.score);
    }

    private dotProduct(vecA: number[], vecB: number[]): number {
        return vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
    }

    private l2Normalize(vec: number[]): number[] {
        // Different embedding models may output vectors with different magnitudes.
        // Normalizing to unit length focuses similarity on direction (semantics);
        // without it, large-norm vectors can overshadow better matches.
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map(v => v / norm);
    }

    /**
     * Cleanup method to be called when plugin is unloaded
     * Properly closes embeddings cache to prevent memory leaks
     */
    async cleanup(): Promise<void> {
        try {
            if (embeddingsCache.isInitialized()) {
                await embeddingsCache.close();
            }
        } catch (error) {
            logger.error('Error during cleanup:', error);
        }
    }
}
