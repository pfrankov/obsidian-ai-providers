import { Plugin, PluginSettingTab, App, sanitizeHTMLToDom } from 'obsidian';
import { ExtendedApp, IAIProvidersService } from './types';

const FALLBACK_TIMEOUT = 100;
/** Latest service API version this SDK was published against. */
const REQUIRED_AI_PROVIDERS_VERSION = 6;
/**
 * Minimum AI Providers *plugin* version that ships service API 6
 * (OpenCode Go and conversation sessions). Shown in outdated-fallback copy.
 */
const RECOMMENDED_AI_PROVIDERS_PLUGIN_VERSION = '1.13.0';
const AI_PROVIDERS_READY_EVENT = 'ai-providers-ready';

let aiProvidersReadyAiResolver: {
    promise: Promise<IAIProvidersService>;
    cancel: () => void;
} | null = null;

type FallbackReason = 'missing' | 'outdated';

interface FallbackOptions {
    reason?: FallbackReason;
    requiredVersion?: number;
    currentVersion?: number;
    recommendedPluginVersion?: string;
}

export interface InitAIOptions {
    disableFallback?: boolean;
    /**
     * Soft minimum service API version required to finish init.
     * Defaults to {@link REQUIRED_AI_PROVIDERS_VERSION} (hard gate, previous behavior).
     * Pass a lower value (e.g. `4`) to load against older AI Providers and
     * feature-detect with {@link supportsVersion} instead of bricking.
     */
    minVersion?: number;
}

/**
 * Human plugin version recommendation for a service API level.
 * Unknown levels fall back to an "API vN" label.
 */
export function recommendedPluginVersionForApi(apiVersion: number): string {
    // Only known API↔plugin mappings get a concrete version string.
    if (apiVersion === 6) {
        return `${RECOMMENDED_AI_PROVIDERS_PLUGIN_VERSION}+`;
    }
    if (apiVersion === 5) {
        return '1.12.0+';
    }
    if (apiVersion >= 1 && apiVersion <= 4) {
        return '1.11.0+';
    }
    return `API v${apiVersion}`;
}

/** True when the live service exposes at least `requiredVersion`. */
export function supportsVersion(
    service: Pick<IAIProvidersService, 'version'> | null | undefined,
    requiredVersion: number
): boolean {
    return (
        typeof service?.version === 'number' &&
        service.version >= requiredVersion
    );
}

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
 * @param options - Optional: disableFallback, minVersion (soft gate)
 * @example
 * ```typescript
 * // Soft-load against API v4+, feature-detect v5 for reasoning:
 * await initAI(app, plugin, async () => { ... }, { minVersion: 4 });
 * const ai = await (await waitForAI()).promise;
 * if (supportsVersion(ai, 5)) {
 *     // enable reasoning UI
 * }
 * ```
 */
export async function initAI(
    app: ExtendedApp,
    plugin: Plugin,
    onDone: () => Promise<void>,
    options?: InitAIOptions
) {
    AIProvidersManager.getInstance(app, plugin);
    let isFallbackShown = false;
    const minVersion = options?.minVersion ?? REQUIRED_AI_PROVIDERS_VERSION;

    // If the fallback is disabled, we don't need to wait for AI Providers to be ready
    if (options?.disableFallback) {
        await onDone();
        return;
    }

    const timeout = setTimeout(async () => {
        plugin.addSettingTab(
            new AIProvidersFallbackSettingsTab(app, plugin, {
                reason: 'missing',
            })
        );
        isFallbackShown = true;
    }, FALLBACK_TIMEOUT);

    try {
        const aiProvidersAiResolver = await waitForAIProviders(app, plugin);
        const aiProviders = await aiProvidersAiResolver.promise;
        clearTimeout(timeout);

        try {
            aiProviders.checkCompatibility(minVersion);
        } catch (error) {
            console.error(`AI Providers compatibility check failed: ${error}`);
            const compatibilityError = error as {
                code?: string;
                requiredVersion?: number;
                currentVersion?: number;
            };
            if (compatibilityError.code === 'version_mismatch') {
                const required =
                    compatibilityError.requiredVersion ?? minVersion;
                plugin.addSettingTab(
                    new AIProvidersFallbackSettingsTab(app, plugin, {
                        reason: 'outdated',
                        requiredVersion: required,
                        currentVersion: compatibilityError.currentVersion,
                        recommendedPluginVersion:
                            recommendedPluginVersionForApi(required),
                    })
                );
                throw new Error(`AI Providers version ${required} is required`);
            }
            throw error;
        }

        await onDone();
    } finally {
        clearTimeout(timeout);
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
    private fallback: FallbackOptions;

    constructor(
        app: App,
        plugin: Plugin,
        fallback: FallbackOptions = { reason: 'missing' }
    ) {
        super(app, plugin);
        this.plugin = plugin;
        this.fallback = fallback;
    }

    async display(): Promise<void> {
        const { containerEl } = this;

        containerEl.empty();

        const aiProvidersNotice = containerEl.createEl('div');
        aiProvidersNotice.addClass('ai-providers-notice');

        if (this.fallback.reason === 'outdated') {
            const required =
                this.fallback.requiredVersion ?? REQUIRED_AI_PROVIDERS_VERSION;
            const current =
                this.fallback.currentVersion !== undefined
                    ? String(this.fallback.currentVersion)
                    : 'unknown';
            const pluginVersion =
                this.fallback.recommendedPluginVersion ??
                recommendedPluginVersionForApi(required);
            aiProvidersNotice.appendChild(
                sanitizeHTMLToDom(`
            <p>⚠️ <a href="obsidian://show-plugin?id=ai-providers">AI Providers</a> is outdated.</p>
            <p>This plugin needs <strong>AI Providers ${pluginVersion}</strong> (service API ${required}). Current service API: ${current}.</p>
            <p>Please update AI Providers from Community Plugins, then reload Obsidian.</p>
        `)
            );
            return;
        }

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
    REQUIRED_AI_PROVIDERS_VERSION,
    RECOMMENDED_AI_PROVIDERS_PLUGIN_VERSION,
    AIProvidersFallbackSettingsTab,
};

export type {
    IAIProvider,
    IAIProvidersService,
    IAIProvidersExecuteParams,
    IAIProvidersToolsExecuteParams,
    IAIModelCapabilities,
    IChunkHandler,
    IAIProvidersEmbedParams,
    IAIHandler,
    IAIProvidersPluginSettings,
    AIProviderType,
    IAIDocument,
    IAIProvidersRetrievalParams,
    IAIProvidersRetrievalResult,
    IChatMessage,
    IContentBlock,
    IAIAssistantToolMessage,
    IAIToolCall,
    IAIToolChoice,
    IAIToolDefinition,
    IChatMessageRole,
} from './types';
