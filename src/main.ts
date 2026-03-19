import { Plugin, addIcon } from 'obsidian';
import type { App } from 'obsidian';
import {
    IAIProvider,
    IAIProvidersPluginSettings,
} from '@obsidian-ai-providers/sdk';
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
    ai302Icon,
    anthropicIcon,
    mistralIcon,
    togetherIcon,
    fireworksIcon,
    perplexityIcon,
    deepseekIcon,
    xaiIcon,
    novitaIcon,
    deepinfraIcon,
    sambanovaIcon,
    cerebrasIcon,
    zaiIcon,
} from './utils/icons';

type AppWithAIProviders = App & {
    aiProviders?: AIProvidersService;
    secretStorage?: SecretStorageLike;
};

type SecretStorageLike = {
    getSecret(key: string): Promise<string | null>;
    setSecret(key: string, value: string): Promise<void>;
    deleteSecret(key: string): Promise<void>;
};

const SECRET_PREFIX = 'ai-providers-';
const MAX_SECRET_ID_LENGTH = 64;
const SECRET_SLUG_LENGTH = 46;

export default class AIProvidersPlugin extends Plugin {
    settings!: IAIProvidersPluginSettings;
    aiProviders!: AIProvidersService;
    private providerIds = new Set<string>();

    async onload() {
        await this.loadSettings();
        addIcon('ai-providers-openai', openAIIcon);
        addIcon('ai-providers-ollama', ollamaIcon);
        addIcon('ai-providers-ollama-openwebui', ollamaOpenWebUIIcon);
        addIcon('ai-providers-gemini', geminiIcon);
        addIcon('ai-providers-openrouter', openRouterIcon);
        addIcon('ai-providers-lmstudio', lmstudioIcon);
        addIcon('ai-providers-groq', groqIcon);
        addIcon('ai-providers-ai302', ai302Icon);
        addIcon('ai-providers-anthropic', anthropicIcon);
        addIcon('ai-providers-mistral', mistralIcon);
        addIcon('ai-providers-together', togetherIcon);
        addIcon('ai-providers-fireworks', fireworksIcon);
        addIcon('ai-providers-perplexity', perplexityIcon);
        addIcon('ai-providers-deepseek', deepseekIcon);
        addIcon('ai-providers-xai', xaiIcon);
        addIcon('ai-providers-novita', novitaIcon);
        addIcon('ai-providers-deepinfra', deepinfraIcon);
        addIcon('ai-providers-sambanova', sambanovaIcon);
        addIcon('ai-providers-cerebras', cerebrasIcon);
        addIcon('ai-providers-zai', zaiIcon);

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
        const appWithProviders = this.app as AppWithAIProviders;
        delete appWithProviders.aiProviders;
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );
        await this.migrateProviderSecrets();
        await this.hydrateProviderSecrets();
        this.providerIds = this.collectProviderIds();
        logger.setEnabled(this.settings.debugLogging ?? false);
    }

    async saveSettings() {
        const removedProviderIds = this.getRemovedProviderIds();
        const settingsToPersist = await this.createPersistedSettings();

        await this.saveData(settingsToPersist);
        await this.deleteSecrets(removedProviderIds);
        this.providerIds = this.collectProviderIds();
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
        const appWithProviders = this.app as AppWithAIProviders;
        appWithProviders.aiProviders = this.aiProviders;

        // Reinitialize cache if workspace is ready
        if (this.app.workspace.layoutReady) {
            this.aiProviders.initEmbeddingsCache().catch(error => {
                console.error('Error reinitializing embeddings cache:', error);
            });
        }
    }

    private getSecretStorage(): SecretStorageLike | null {
        const appWithProviders = this.app as AppWithAIProviders;
        return appWithProviders.secretStorage ?? null;
    }

    private collectProviderIds(): Set<string> {
        return new Set(this.getProviders().map(provider => provider.id));
    }

    private getRemovedProviderIds(): string[] {
        const currentIds = this.collectProviderIds();

        return Array.from(this.providerIds).filter(id => !currentIds.has(id));
    }

    private getProviders(): IAIProvider[] {
        return this.settings.providers ?? [];
    }

    private getSecretId(providerId: string): string {
        const normalizedId =
            providerId
                .toLowerCase()
                .replace(/[^a-z0-9-]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, SECRET_SLUG_LENGTH) || 'provider';

        const hash = Array.from(providerId)
            .reduce(
                (value, character) =>
                    (value * 31 + character.charCodeAt(0)) >>> 0,
                0
            )
            .toString(36);

        return `${SECRET_PREFIX}${normalizedId}-${hash}`.slice(
            0,
            MAX_SECRET_ID_LENGTH
        );
    }

    private async readSecret(providerId: string): Promise<string | null> {
        const secretStorage = this.getSecretStorage();
        if (!secretStorage) {
            return null;
        }

        try {
            return await secretStorage.getSecret(this.getSecretId(providerId));
        } catch (error) {
            logger.warn('Failed to read provider secret', { providerId, error });
            return null;
        }
    }

    private async writeSecret(provider: IAIProvider): Promise<boolean> {
        const secretStorage = this.getSecretStorage();
        if (!secretStorage || !provider.apiKey) {
            return false;
        }

        try {
            await secretStorage.setSecret(
                this.getSecretId(provider.id),
                provider.apiKey
            );
            return true;
        } catch (error) {
            logger.warn('Failed to write provider secret', {
                providerId: provider.id,
                error,
            });
            return false;
        }
    }

    private async deleteSecret(providerId: string): Promise<void> {
        const secretStorage = this.getSecretStorage();
        if (!secretStorage) {
            return;
        }

        try {
            await secretStorage.deleteSecret(this.getSecretId(providerId));
        } catch (error) {
            logger.warn('Failed to delete provider secret', {
                providerId,
                error,
            });
        }
    }

    private async deleteSecrets(providerIds: string[]): Promise<void> {
        await Promise.all(providerIds.map(id => this.deleteSecret(id)));
    }

    private async hydrateProviderSecrets(): Promise<void> {
        const providers = await Promise.all(
            this.getProviders().map(async provider => {
                const storedApiKey = await this.readSecret(provider.id);
                if (storedApiKey === null) {
                    return provider;
                }

                return {
                    ...provider,
                    apiKey: storedApiKey,
                };
            })
        );

        this.settings.providers = providers;
    }

    private async migrateProviderSecrets(): Promise<void> {
        const providers = this.getProviders();
        let didMigrate = false;

        for (const provider of providers) {
            if (!provider.apiKey) {
                continue;
            }

            const didStoreSecret = await this.writeSecret(provider);
            if (didStoreSecret) {
                didMigrate = true;
            }
        }

        if (!didMigrate) {
            return;
        }

        await this.saveData(await this.createPersistedSettings());
    }

    private async createPersistedSettings(): Promise<IAIProvidersPluginSettings> {
        const providers = await Promise.all(
            this.getProviders().map(async provider => {
                if (!provider.apiKey) {
                    return this.omitApiKey(provider);
                }

                const didStoreSecret = await this.writeSecret(provider);
                return didStoreSecret ? this.omitApiKey(provider) : provider;
            })
        );

        return {
            ...this.settings,
            providers,
        };
    }

    private omitApiKey(provider: IAIProvider): IAIProvider {
        const persistedProvider = { ...provider };
        delete persistedProvider.apiKey;
        return persistedProvider;
    }
}
