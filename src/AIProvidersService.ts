import { App, Notice } from 'obsidian';
import {
    IAIProvider,
    IAIProvidersService,
    IAIProvidersExecuteParams,
    IChunkHandler,
    IAIProvidersEmbedParams,
    IAIHandler,
    AIProviderType,
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

export class AIProvidersService implements IAIProvidersService {
    providers: IAIProvider[] = [];
    version = 1;
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
