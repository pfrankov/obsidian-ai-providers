import { Plugin, PluginSettingTab, App, sanitizeHTMLToDom } from 'obsidian';
import { ExtendedApp, IAIProvidersService } from './types';

const FALLBACK_TIMEOUT = 100;
const REQUIRED_AI_PROVIDERS_VERSION = 3;
const AI_PROVIDERS_READY_EVENT = 'ai-providers-ready';

let aiProvidersReadyAiResolver: {
    promise: Promise<IAIProvidersService>;
    cancel: () => void;
} | null = null;

/**
 * Integration module for AI Providers in Obsidian plugins.
 * Provides tools for working with AI functionality through the AI Providers plugin.
 */

/**
 * Waits for AI Providers plugin to be ready
 * @param app - Obsidian app instance
 * @param plugin - Current plugin
 * @returns Promise with a control object for waiting
 * @example
 * const aiResolver = await waitForAIProviders(app, plugin);
 * const aiProviders = await aiResolver.promise;
 */
async function waitForAIProviders(app: ExtendedApp, plugin: Plugin) {
    if (aiProvidersReadyAiResolver) {
        return aiProvidersReadyAiResolver;
    }

    const abortController = new AbortController();
    let aiProvidersReady!: () => void;

    const result = {
        promise: new Promise<IAIProvidersService>((resolve, reject) => {
            aiProvidersReady = () => {
                app.workspace.off(AI_PROVIDERS_READY_EVENT, aiProvidersReady);
                aiProvidersReadyAiResolver = null;
                resolve(app.aiProviders as IAIProvidersService);
            };

            if (app.aiProviders) {
                aiProvidersReady();
            } else {
                const eventRef = app.workspace.on(
                    AI_PROVIDERS_READY_EVENT,
                    aiProvidersReady
                );
                plugin.registerEvent(eventRef);
            }

            abortController.signal.addEventListener('abort', () => {
                app.workspace.off(AI_PROVIDERS_READY_EVENT, aiProvidersReady);
                aiProvidersReadyAiResolver = null;
                reject(new Error('Waiting for AI Providers was cancelled'));
            });
        }),
        cancel: () => abortController.abort(),
    };

    if (!app.aiProviders) {
        aiProvidersReadyAiResolver = result;
    }
    return result;
}

class AIProvidersManager {
    private static instance: AIProvidersManager | null = null;
    private constructor(
        private readonly app: ExtendedApp,
        private readonly plugin: Plugin
    ) {}

    static getInstance(app?: ExtendedApp, plugin?: Plugin): AIProvidersManager {
        if (!this.instance) {
            if (!app || !plugin) {
                throw new Error(
                    'AIProvidersManager not initialized. Call initialize() first'
                );
            }
            this.instance = new AIProvidersManager(app, plugin);
        }
        return this.instance;
    }

    static reset(): void {
        this.instance = null;
    }

    getApp(): ExtendedApp {
        return this.app;
    }

    getPlugin(): Plugin {
        return this.plugin;
    }
}

/**
 * Initializes AI integration
 * @param app - Obsidian app instance
 * @param plugin - Current plugin
 * @param onDone - Callback called after successful initialization
 * @example
 * ```typescript
 * await initAI(app, plugin, async () => {
 *     // Initialization successful, AI is ready to use
 *     await this.loadSettings();
 *     await this.setupCommands();
 * });
 * ```
 */
export async function initAI(
    app: ExtendedApp,
    plugin: Plugin,
    onDone: () => Promise<void>,
    options?: { disableFallback?: boolean }
) {
    AIProvidersManager.getInstance(app, plugin);
    let isFallbackShown = false;

    // If the fallback is disabled, we don't need to wait for AI Providers to be ready
    if (options?.disableFallback) {
        await onDone();
        return;
    }

    try {
        const timeout = setTimeout(async () => {
            plugin.addSettingTab(
                new AIProvidersFallbackSettingsTab(app, plugin)
            );
            isFallbackShown = true;
        }, FALLBACK_TIMEOUT);

        const aiProvidersAiResolver = await waitForAIProviders(app, plugin);
        const aiProviders = await aiProvidersAiResolver.promise;
        clearTimeout(timeout);

        try {
            aiProviders.checkCompatibility(REQUIRED_AI_PROVIDERS_VERSION);
        } catch (error) {
            console.error(`AI Providers compatibility check failed: ${error}`);
            if (error.code === 'version_mismatch') {
                plugin.addSettingTab(
                    new AIProvidersFallbackSettingsTab(app, plugin)
                );
                throw new Error(
                    `AI Providers version ${REQUIRED_AI_PROVIDERS_VERSION} is required`
                );
            }
            throw error;
        }

        await onDone();
    } finally {
        if (isFallbackShown && app.plugins) {
            await app.plugins.disablePlugin(plugin.manifest.id);
            await app.plugins.enablePlugin(plugin.manifest.id);
        }
    }
}

/**
 * Waits for AI services to be ready
 * @returns Promise with a control object for waiting
 * @example
 * ```typescript
 * const aiResolver = await waitForAI();
 * try {
 *     const aiProviders = await aiResolver.promise;
 *     // Now you can use aiProviders
 * } catch (error) {
 *     console.error('Failed to get AI providers:', error);
 * }
 *
 * // If you need to cancel waiting:
 * aiResolver.cancel();
 * ```
 */
export async function waitForAI() {
    const manager = AIProvidersManager.getInstance();
    return waitForAIProviders(manager.getApp(), manager.getPlugin());
}

class AIProvidersFallbackSettingsTab extends PluginSettingTab {
    plugin: Plugin;

    constructor(app: App, plugin: Plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async display(): Promise<void> {
        const { containerEl } = this;

        containerEl.empty();

        const aiProvidersNotice = containerEl.createEl('div');
        aiProvidersNotice.addClass('ai-providers-notice');

        aiProvidersNotice.appendChild(
            sanitizeHTMLToDom(`
            <p>⚠️ This plugin requires <a href="obsidian://show-plugin?id=ai-providers">AI Providers</a> plugin to be installed.</p>
            <p>Please install and configure AI Providers plugin first.</p>
        `)
        );
    }
}

export const __testing__ = {
    resetManager: () => AIProvidersManager.reset(),
    waitForAIProviders,
};

export type {
    IAIProvider,
    IAIProvidersService,
    IAIProvidersExecuteParams,
    IChunkHandler,
    IAIProvidersEmbedParams,
    IAIHandler,
    IAIProvidersPluginSettings,
    AIProviderType,
    IAIDocument,
    IAIProvidersRetrievalParams,
    IAIProvidersRetrievalResult,
    IContentBlock,
} from './types';
