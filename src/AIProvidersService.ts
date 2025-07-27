import { App, Notice } from 'obsidian';
import {
    IAIProvider,
    IAIProvidersService,
    IAIProvidersExecuteParams,
    IChunkHandler,
    IAIProvidersEmbedParams,
    IAIHandler,
    AIProviderType,
    IAIProvidersRetrievalParams,
    IAIProvidersRetrievalResult,
    IAIDocument,
} from '@obsidian-ai-providers/sdk';
import { OpenAIHandler } from './handlers/OpenAIHandler';
import { OllamaHandler } from './handlers/OllamaHandler';
import { I18n } from './i18n';
import AIProvidersPlugin from './main';
import { ConfirmationModal } from './modals/ConfirmationModal';
import { CachedEmbeddingsService } from './cache/CachedEmbeddingsService';
import { embeddingsCache } from './cache/EmbeddingsCache';
import { logger } from './utils/logger';
import { createCacheKeyHash } from './utils/hashUtils';
import { preprocessContent, splitContent } from './utils/textProcessing';

export class AIProvidersService implements IAIProvidersService {
    providers: IAIProvider[] = [];
    version = 2;
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
            const vaultId = (this.app as any).appId || 'default';
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

            // Normalize input to array
            const inputArray = Array.isArray(params.input)
                ? params.input
                : [params.input];

            // Create automatic cache key based on input content and provider
            const cacheKey = await this.generateCacheKey(params, inputArray);

            // Use cached embeddings service with automatic caching
            const cachedParams = {
                ...params,
                input: inputArray,
                cacheKey,
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

    private async generateCacheKey(
        params: IAIProvidersEmbedParams,
        inputArray: string[]
    ): Promise<string> {
        // Generate cache key based on provider and input content
        const contentHash = await createCacheKeyHash(inputArray.join('|'));
        return `embed:${params.provider.id}:${params.provider.model}:${contentHash}`;
    }

    async fetchModels(provider: IAIProvider): Promise<string[]> {
        try {
            const handler = this.getHandler(provider.type);
            if (!handler) {
                throw new Error(
                    `Handler not found for provider type: ${provider.type}`
                );
            }
            return handler.fetchModels(provider);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : I18n.t('errors.failedToFetchModels');
            new Notice(message);
            throw error;
        }
    }

    async execute(params: IAIProvidersExecuteParams): Promise<IChunkHandler> {
        try {
            const handler = this.getHandler(params.provider.type);
            if (!handler) {
                throw new Error(
                    `Handler not found for provider type: ${params.provider.type}`
                );
            }
            return handler.execute(params);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : I18n.t('errors.failedToExecuteRequest');
            new Notice(message);
            throw error;
        }
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
        try {
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
            interface ProcessedChunk {
                content: string;
                document: IAIDocument;
            }

            const chunks: ProcessedChunk[] = [];

            for (const document of params.documents) {
                const preprocessed = preprocessContent(document.content);
                const documentChunks = splitContent(preprocessed);

                for (const chunk of documentChunks) {
                    if (chunk.trim().length > 0) {
                        chunks.push({
                            content: chunk.trim(),
                            document: document, // Reference to original document
                        });
                    }
                }
            }

            if (chunks.length === 0) {
                return [];
            }

            // Generate embeddings for query and chunks
            const queryEmbedding = await this.embed({
                provider: params.embeddingProvider,
                input: params.query,
            });

            const chunkTexts = chunks.map(chunk => chunk.content);
            const chunkEmbeddings = await this.embed({
                provider: params.embeddingProvider,
                input: chunkTexts,
            });

            // Calculate similarity scores using cosine similarity
            const queryVector = queryEmbedding[0];
            const results: IAIProvidersRetrievalResult[] = [];

            for (let i = 0; i < chunks.length; i++) {
                const chunkVector = chunkEmbeddings[i];
                const similarity = this.cosineSimilarity(
                    queryVector,
                    chunkVector
                );

                results.push({
                    content: chunks[i].content,
                    score: similarity,
                    document: chunks[i].document,
                });
            }

            // Sort by similarity score (descending)
            results.sort((a, b) => b.score - a.score);

            return results;
        } catch (error) {
            throw error;
        }
    }

    private cosineSimilarity(vectorA: number[], vectorB: number[]): number {
        if (vectorA.length !== vectorB.length) {
            throw new Error('Vectors must have the same length');
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vectorA.length; i++) {
            dotProduct += vectorA[i] * vectorB[i];
            normA += vectorA[i] * vectorA[i];
            normB += vectorB[i] * vectorB[i];
        }

        normA = Math.sqrt(normA);
        normB = Math.sqrt(normB);

        if (normA === 0 || normB === 0) {
            return 0;
        }

        return dotProduct / (normA * normB);
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
