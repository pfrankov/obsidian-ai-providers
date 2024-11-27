import { App, Notice } from 'obsidian';
import { IAIProvider, IAIProvidersService, IAIProvidersExecuteParams, IChunkHandler } from './types';
import { OpenAIHandler } from './handlers/OpenAIHandler';
import { OllamaHandler } from './handlers/OllamaHandler';
import { I18n } from './i18n';

export class AIProvidersService implements IAIProvidersService {
    providers: IAIProvider[] = [];
    private app: App;
    private openaiHandler: OpenAIHandler;
    private ollamaHandler: OllamaHandler;

    constructor(app: App, initialProviders: IAIProvider[] = []) {
        this.providers = initialProviders;
        this.app = app;
        this.openaiHandler = new OpenAIHandler();
        this.ollamaHandler = new OllamaHandler();
    }

    private notifyProviderChange() {
        this.app.workspace.trigger('ai-providers-change', this.providers);
    }

    private getHandler(type: 'openai' | 'ollama') {
        return type === 'openai' ? this.openaiHandler : this.ollamaHandler;
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
} 