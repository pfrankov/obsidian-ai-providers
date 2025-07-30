import { Plugin, addIcon } from 'obsidian';
import { IAIProvidersPluginSettings } from '@obsidian-ai-providers/sdk';
import { DEFAULT_SETTINGS, AIProvidersSettingTab } from './settings';
import { AIProvidersService } from './AIProvidersService';
import { logger } from './utils/logger';
import {
    openAIIcon,
    ollamaIcon,
    ollamaOpenWebUIIcon,
    geminiIcon,
    openRouterIcon,
    lmstudioIcon,
    groqIcon,
    ai320Icon,
} from './utils/icons';

export default class AIProvidersPlugin extends Plugin {
    settings!: IAIProvidersPluginSettings;
    aiProviders!: AIProvidersService;

    async onload() {
        await this.loadSettings();
        addIcon('ai-providers-openai', openAIIcon);
        addIcon('ai-providers-ollama', ollamaIcon);
        addIcon('ai-providers-ollama-openwebui', ollamaOpenWebUIIcon);
        addIcon('ai-providers-gemini', geminiIcon);
        addIcon('ai-providers-openrouter', openRouterIcon);
        addIcon('ai-providers-lmstudio', lmstudioIcon);
        addIcon('ai-providers-groq', groqIcon);
        addIcon('ai-providers-ai320', ai320Icon);

        const settingTab = new AIProvidersSettingTab(this.app, this);
        this.exposeAIProviders();

        // Initialize embeddings cache when workspace is ready
        this.app.workspace.onLayoutReady(async () => {
            await this.aiProviders.initEmbeddingsCache();
        });

        this.app.workspace.trigger('ai-providers-ready');

        this.addSettingTab(settingTab);
    }

    async onunload() {
        // Properly cleanup embeddings cache to prevent memory leaks
        if (this.aiProviders) {
            await this.aiProviders.cleanup();
        }
        delete (this.app as any).aiProviders;
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );
        logger.setEnabled(this.settings.debugLogging ?? false);
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.exposeAIProviders();
    }

    exposeAIProviders() {
        // Cleanup old service if exists to prevent memory leaks
        if (this.aiProviders) {
            // Note: cleanup is async but we can't await here safely
            // The cleanup will handle its own errors
            this.aiProviders.cleanup().catch(error => {
                console.error('Error during aiProviders cleanup:', error);
            });
        }

        this.aiProviders = new AIProvidersService(this.app, this);
        (this.app as any).aiProviders = this.aiProviders;

        // Reinitialize cache if workspace is ready
        if (this.app.workspace.layoutReady) {
            this.aiProviders.initEmbeddingsCache().catch(error => {
                console.error('Error reinitializing embeddings cache:', error);
            });
        }
    }
}
