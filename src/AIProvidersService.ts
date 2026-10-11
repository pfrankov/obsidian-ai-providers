import { reasoningRequestFields } from './utils/reasoningModes';
import { App, Notice } from 'obsidian';
import {
    AIProviderType,
    IAIDocument,
    IAIAssistantToolMessage,
    IAIHandler,
    IAIModelCapabilities,
    IAIProvider,
    IAIProvidersEmbedParams,
    IAIProvidersExecuteParams,
    IAIProvidersToolsExecuteParams,
    IAIProvidersRetrievalParams,
    IAIProvidersRetrievalResult,
    IAIProvidersService,
    IChunkHandler,
    recommendedPluginVersionForApi,
} from '@obsidian-ai-providers/sdk';
import { OpenAIHandler } from './handlers/OpenAIHandler';
import { OpenCodeGoHandler } from './handlers/OpenCodeGoHandler';
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
import { probeModelCapabilities } from './utils/modelCapabilityChecker';
import { AI_PROVIDERS_SERVICE_VERSION } from './constants/serviceApiVersion';

export class AIProvidersService implements IAIProvidersService {
    providers: IAIProvider[] = [];
    version = AI_PROVIDERS_SERVICE_VERSION;
    /** Manifest version of the installed AI Providers plugin (e.g. "1.12.0"). */
    pluginVersion: string;
    private app: App;
    private plugin: AIProvidersPlugin;
    private handlers: Record<string, IAIHandler>;
    private cachedEmbeddingsService: CachedEmbeddingsService;

    constructor(app: App, plugin: AIProvidersPlugin) {
        this.plugin = plugin;
        this.providers = plugin.settings.providers || [];
        this.app = app;
        this.pluginVersion = plugin.manifest?.version ?? '';

        // Initialize handlers for each provider type
        this.handlers = {
            'opencode-go': new OpenCodeGoHandler(plugin.settings),
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
            onProgress: (chunk: string, accumulatedText: string) => void;
            abortController?: AbortController;
        }
    ): Promise<string>;
    async execute(
        params: IAIProvidersExecuteParams & {
            abortController: AbortController;
            onProgress?: (chunk: string, accumulatedText: string) => void;
        }
    ): Promise<string>;
    async execute(
        params: IAIProvidersExecuteParams & {
            onProgress?: undefined;
            abortController?: undefined;
        }
    ): Promise<IChunkHandler>;
    async execute(
        params: IAIProvidersExecuteParams
    ): Promise<string | IChunkHandler>;
    async execute(
        params: IAIProvidersExecuteParams
    ): Promise<string | IChunkHandler> {
        const handler = this.getHandler(params.provider.type);
        if (!handler) {
            throw new Error(
                `Handler not found for provider type: ${params.provider.type}`
            );
        }

        // Apply model override: if params.model is set, use it instead of the provider's default
        const resolvedParams = params.model
            ? {
                  ...params,
                  provider: { ...params.provider, model: params.model },
              }
            : params;

        reasoningRequestFields(resolvedParams);

        const extendedParams = resolvedParams as IAIProvidersExecuteParams & {
            onProgress?: (chunk: string, accumulatedText: string) => void;
            abortController?: AbortController;
        };

        const hasOnData = Boolean(extendedParams.onProgress);
        const hasAbort = Boolean(extendedParams.abortController);
        const useLegacyWrapper = !hasOnData && !hasAbort;

        if (!useLegacyWrapper) {
            // Ensure a provided abortController (if any) is forwarded unchanged
            return await handler.execute(resolvedParams);
        }

        const internalAbortController = new AbortController();
        const handlers = {
            data: [] as ((chunk: string, accumulatedText: string) => void)[],
            end: [] as ((fullText: string) => void)[],
            error: [] as ((error: Error) => void)[],
        };

        handler
            .execute({
                ...resolvedParams,
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

    async toolsExecute(
        params: IAIProvidersToolsExecuteParams
    ): Promise<IAIAssistantToolMessage> {
        const handler = this.getHandler(params.provider.type);
        if (!handler) {
            throw new Error(
                `Handler not found for provider type: ${params.provider.type}`
            );
        }

        // Apply model override: if params.model is set, use it instead of the provider's default
        const resolvedParams = params.model
            ? {
                  ...params,
                  provider: { ...params.provider, model: params.model },
              }
            : params;

        reasoningRequestFields(resolvedParams);
        return handler.toolsExecute(resolvedParams);
    }

    getModelCapabilities({
        provider,
        model,
    }: {
        provider: IAIProvider;
        model?: string;
    }): IAIModelCapabilities | null {
        const targetModel = model || provider.model;
        if (!targetModel) {
            return null;
        }

        return provider.modelCapabilities?.[targetModel] || null;
    }

    getModels({
        provider,
    }: {
        provider: IAIProvider;
    }): Record<string, IAIModelCapabilities | null> {
        const models = provider.availableModels || [];
        const result: Record<string, IAIModelCapabilities | null> = {};
        for (const id of models) {
            result[id] = provider.modelCapabilities?.[id] || null;
        }
        return result;
    }

    async checkModelCapabilities({
        provider,
        model,
    }: {
        provider: IAIProvider;
        model?: string;
    }): Promise<IAIModelCapabilities> {
        const targetModel = model || provider.model;
        const probeProvider = { ...provider, model: targetModel };

        const probed = await probeModelCapabilities({
            aiProviders: this,
            provider: probeProvider,
        });
        // Only save results for the configuration that was actually probed.
        // The default model may change: results belong to the captured targetModel.
        const identityFields = ['id', 'type', 'url', 'apiKey'] as const;
        const settingsProvider = this.plugin.settings.providers?.find(p =>
            identityFields.every(field => p[field] === probeProvider[field])
        );
        const currentProvider = settingsProvider || probeProvider;
        const capabilities = {
            ...currentProvider.modelCapabilities?.[targetModel || ''],
            ...probed,
        };

        // Persist capabilities in settings
        if (targetModel && settingsProvider) {
            settingsProvider.modelCapabilities = {
                ...settingsProvider.modelCapabilities,
                [targetModel]: capabilities,
            };
            await this.plugin.saveSettings();
        }

        return capabilities;
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
            // Known API levels map to a plugin release; unknown (≥6, etc.) stay as "API vN"
            // — never recommend the already-installed pluginVersion as the upgrade target.
            const recommended = recommendedPluginVersionForApi(requiredVersion);
            new Notice(
                I18n.t('errors.aiProvidersOutdatedFormatted', {
                    required: String(requiredVersion),
                    current: String(this.version),
                    pluginVersion: recommended,
                })
            );
            const error = new Error(
                I18n.t('errors.aiProvidersOutdated', {
                    required: String(requiredVersion),
                    current: String(this.version),
                })
            ) as Error & {
                code?: string;
                requiredVersion?: number;
                currentVersion?: number;
                pluginVersion?: string;
            };
            error.code = 'version_mismatch';
            error.requiredVersion = requiredVersion;
            error.currentVersion = this.version;
            error.pluginVersion = this.pluginVersion;
            throw error;
        }
    }

    async retrieve(
        params: IAIProvidersRetrievalParams
    ): Promise<IAIProvidersRetrievalResult[]> {
        const abortController = params.abortController;
        this.ensureNotAborted(abortController);
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
                    const processedTexts = new Set(processedChunkTexts);
                    const processedChunks = chunks.filter(chunk =>
                        processedTexts.has(chunk.content)
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
            this.ensureNotAborted(abortController);
            throw error;
        });

        this.ensureNotAborted(abortController);

        // L2-normalize embeddings: with unit vectors, dot product equals cosine similarity.
        // This keeps ranking stable regardless of provider-specific vector magnitudes.
        const normQuery = this.l2Normalize(queryEmbedding[0]);
        const normChunks = chunkEmbeddings.map(e => this.l2Normalize(e));

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

        this.ensureNotAborted(abortController);

        // Perform vector-only search
        return this.rankChunks(normQuery, chunks, normChunks);
    }

    private ensureNotAborted(abortController?: AbortController): void {
        if (abortController?.signal.aborted) {
            throw new Error('Aborted');
        }
    }

    private processDocuments(documents: IAIDocument[]) {
        interface ProcessedChunk {
            content: string;
            document: IAIDocument;
        }

        const chunks: ProcessedChunk[] = [];
        const documentChunkCounts = new Map<IAIDocument, number>();

        for (const document of documents) {
            const preprocessed = preprocessContent(document.content);
            const documentChunks = splitContent(preprocessed);

            for (const chunk of documentChunks) {
                if (chunk.trim().length > 0) {
                    chunks.push({
                        content: chunk.trim(),
                        document: document,
                    });
                    documentChunkCounts.set(
                        document,
                        (documentChunkCounts.get(document) || 0) + 1
                    );
                }
            }
        }

        return { chunks, totalChunks: chunks.length, documentChunkCounts };
    }

    private getProcessedDocs(
        processedChunks: IAIProvidersRetrievalChunk[],
        documentChunkCounts: Map<IAIDocument, number>,
        documents: IAIDocument[]
    ) {
        const processedChunksPerDoc = new Map<IAIDocument, number>();
        for (const chunk of processedChunks) {
            processedChunksPerDoc.set(
                chunk.document,
                (processedChunksPerDoc.get(chunk.document) || 0) + 1
            );
        }

        const processedDocs: IAIDocument[] = [];
        for (const document of documents) {
            const totalChunks = documentChunkCounts.get(document) || 0;
            if (
                totalChunks > 0 &&
                processedChunksPerDoc.get(document) === totalChunks
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
