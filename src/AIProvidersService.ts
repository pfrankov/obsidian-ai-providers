import { App, Notice } from 'obsidian';
import { IAIProvider, IAIProvidersService, IAIProvidersExecuteParams, IChunkHandler, IAIProvidersEmbedParams, IAIHandler, IAIProvidersPluginSettings } from './types';
import { OpenAIHandler } from './handlers/OpenAIHandler';
import { OllamaHandler } from './handlers/OllamaHandler';
import { I18n } from './i18n';
import AIProvidersPlugin from './main';
import { ConfirmationModal } from './modals/ConfirmationModal';
export class AIProvidersService implements IAIProvidersService {
    providers: IAIProvider[] = [];
    version = 1;
    private app: App;
    private plugin: AIProvidersPlugin;
    private handlers: Record<string, IAIHandler>;

    constructor(app: App, plugin: AIProvidersPlugin) {
        this.plugin = plugin;
        this.providers = plugin.settings.providers || [];
        this.app = app;
        this.handlers = {
            openai: new OpenAIHandler(plugin.settings),
            ollama: new OllamaHandler(plugin.settings)
        };
    }

    private getHandler(type: 'openai' | 'ollama') {
        return this.handlers[type];
    }

    async embed(params: IAIProvidersEmbedParams): Promise<number[][]> {
        try {
            return await this.getHandler(params.provider.type).embed(params);
        } catch (error) {
            const message = error instanceof Error ? error.message : I18n.t('errors.failedToEmbed');
            new Notice(message);
            throw error;
        }
    }

    async fetchModels(provider: IAIProvider): Promise<string[]> {
        try {
            return await this.getHandler(provider.type).fetchModels(provider);
        } catch (error) {
            const message = error instanceof Error ? error.message : I18n.t('errors.failedToFetchModels');
            new Notice(message);
            throw error;
        }
    }

    async execute(params: IAIProvidersExecuteParams): Promise<IChunkHandler> {
        try {
            return await this.getHandler(params.provider.type).execute(params);
        } catch (error) {
            const message = error instanceof Error ? error.message : I18n.t('errors.failedToExecuteRequest');
            new Notice(message);
            throw error;
        }
    }

    async migrateProvider(provider: IAIProvider) {
        const fieldsToCompare = ['type', 'apiKey', 'url', 'model'];
        this.plugin.settings.providers = this.plugin.settings.providers || [];
        
        const existingProvider = this.plugin.settings.providers.find(p => fieldsToCompare.every(field => p[field] === provider[field]));
        if (existingProvider) {
            return Promise.resolve(existingProvider);
        }

        return new Promise((resolve) => {
            new ConfirmationModal(
                this.app,
                `Migrate provider ${provider.name}?`,
                async () => {
                    this.plugin.settings.providers?.push(provider);
                    await this.plugin.saveSettings();
                    resolve(provider);
                },
                () => {
                    resolve(false);
                }
            ).open();
        });
    }

    // Позволяет не передавать version при каждом вызове методов
    // AIProvidersService.registerPlugin({ app, requiredVersion })
    checkCompatibility(requiredVersion: number) {
        if (requiredVersion > this.version) {
            new Notice(I18n.t('errors.pluginMustBeUpdatedFormatted'));
            throw new Error(I18n.t('errors.pluginMustBeUpdated'));
        }
    }
} 
