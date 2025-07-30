import {
    App,
    PluginSettingTab,
    sanitizeHTMLToDom,
    Setting,
    setIcon,
} from 'obsidian';
import AIProvidersPlugin from './main';
import { I18n } from './i18n';
import { ConfirmationModal } from './modals/ConfirmationModal';
import {
    IAIProvider,
    IAIProvidersPluginSettings,
} from '@obsidian-ai-providers/sdk';
import { logger } from './utils/logger';
import { ProviderFormModal } from './modals/ProviderFormModal';

export const DEFAULT_SETTINGS: IAIProvidersPluginSettings = {
    _version: 1,
    debugLogging: false,
    useNativeFetch: false,
};

export class AIProvidersSettingTab extends PluginSettingTab {
    private isFormOpen = false;
    private isDeveloperMode = false;

    plugin: AIProvidersPlugin;

    constructor(app: App, plugin: AIProvidersPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private openForm(isAdding: boolean, provider?: IAIProvider) {
        const editingProvider = provider || {
            id: `id-${Date.now().toString()}`,
            name: '',
            apiKey: '',
            url: '',
            type: 'openai',
            model: '',
        };

        new ProviderFormModal(
            this.app,
            this.plugin,
            editingProvider,
            async updatedProvider => {
                await this.saveProvider(updatedProvider);
            },
            isAdding
        ).open();
    }

    private closeForm() {
        this.isFormOpen = false;
        this.display();
    }

    private validateProvider(provider: IAIProvider): boolean {
        // Validate required fields
        if (!provider.id || !provider.name || !provider.type) return false;

        // Check for duplicate names
        const providers = this.plugin.settings.providers || [];
        const existingProvider = providers.find(
            (p: IAIProvider) => p.name === provider.name && p.id !== provider.id
        );
        if (existingProvider) {
            return false;
        }

        return true;
    }

    async saveProvider(provider: IAIProvider) {
        if (!this.validateProvider(provider)) return;

        const providers = this.plugin.settings.providers || [];
        const existingIndex = providers.findIndex(
            (p: IAIProvider) => p.id === provider.id
        );

        if (existingIndex !== -1) {
            providers[existingIndex] = provider;
        } else {
            providers.push(provider);
        }

        this.plugin.settings.providers = providers;
        await this.plugin.saveSettings();
        this.closeForm();
    }

    async deleteProvider(provider: IAIProvider) {
        const providers = this.plugin.settings.providers || [];
        const index = providers.findIndex(
            (p: IAIProvider) => p.id === provider.id
        );
        if (index !== -1) {
            providers.splice(index, 1);
            this.plugin.settings.providers = providers;
            await this.plugin.saveSettings();
            this.display();
        }
    }

    async duplicateProvider(provider: IAIProvider) {
        const newProvider = {
            ...provider,
            id: `id-${Date.now().toString()}`,
            name: `${provider.name} (${I18n.t('settings.duplicate')})`,
        };

        const providers = this.plugin.settings.providers || [];
        providers.push(newProvider);

        this.plugin.settings.providers = providers;
        await this.plugin.saveSettings();
        this.display();
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // Show main interface
        const mainInterface = containerEl.createDiv(
            'ai-providers-main-interface'
        );
        mainInterface.setAttribute('data-testid', 'main-interface');

        // Add notice at the top
        const noticeEl = mainInterface.createDiv('ai-providers-notice');
        const noticeContent = noticeEl.createDiv('ai-providers-notice-content');
        noticeContent.appendChild(
            sanitizeHTMLToDom(`${I18n.t('settings.notice')}`)
        );

        // Create providers section with header and add button
        new Setting(mainInterface)
            .setHeading()
            .setName(I18n.t('settings.configuredProviders'))
            .addButton(button => {
                const addButton = button
                    .setIcon('plus') // Changed to plus-circle which is a bolder plus icon
                    .setTooltip(I18n.t('settings.addProvider'))
                    .onClick(() => {
                        if (this.isFormOpen) return;
                        this.openForm(true);
                    });

                addButton.buttonEl.setAttribute(
                    'aria-label',
                    I18n.t('settings.addProvider')
                );
                addButton.buttonEl.setAttribute(
                    'data-testid',
                    'add-provider-button'
                );
                return addButton;
            });

        const providers = this.plugin.settings.providers || [];
        if (providers.length > 0) {
            providers.forEach((provider: IAIProvider) => {
                const setting = new Setting(mainInterface)
                    .setName(provider.name)
                    .setDesc(provider.url || '');

                // Add provider icon before the name
                const iconEl = setting.nameEl.createSpan(
                    'ai-providers-provider-icon'
                );
                setIcon(iconEl, `ai-providers-${provider.type}`);
                setting.nameEl.prepend(iconEl as any);

                // Add model pill if model is selected
                if (provider.model) {
                    const modelPill = setting.settingEl.createDiv(
                        'ai-providers-model-pill'
                    );
                    modelPill.textContent = provider.model;
                    modelPill.setAttribute('data-testid', 'model-pill');
                    setting.nameEl.after(modelPill as any);
                }

                setting
                    .addExtraButton(button => {
                        button
                            .setIcon('gear')
                            .setTooltip(I18n.t('settings.options'))
                            .onClick(() => {
                                if (this.isFormOpen) return;
                                this.openForm(false, { ...provider });
                            });

                        button.extraSettingsEl.setAttribute(
                            'data-testid',
                            'edit-provider'
                        );
                    })
                    .addExtraButton(button => {
                        button
                            .setIcon('copy')
                            .setTooltip(I18n.t('settings.duplicate'))
                            .onClick(async () => {
                                await this.duplicateProvider(provider);
                            });

                        button.extraSettingsEl.setAttribute(
                            'data-testid',
                            'duplicate-provider'
                        );
                    })
                    .addExtraButton(button => {
                        button
                            .setIcon('lucide-trash-2')
                            .setTooltip(I18n.t('settings.delete'))
                            .onClick(async () => {
                                new ConfirmationModal(
                                    this.app,
                                    I18n.t('settings.deleteConfirmation', {
                                        name: provider.name,
                                    }),
                                    async () => {
                                        await this.deleteProvider(provider);
                                    }
                                ).open();
                            });

                        button.extraSettingsEl.setAttribute(
                            'data-testid',
                            'delete-provider'
                        );
                    });
            });
        }

        // Add developer settings toggle at the top
        new Setting(mainInterface)
            .setHeading()
            .setName(I18n.t('settings.developerSettings'))
            .setDesc(I18n.t('settings.developerSettingsDesc'))
            .setClass('ai-providers-developer-settings-toggle')
            .addToggle(toggle =>
                toggle.setValue(this.isDeveloperMode).onChange(value => {
                    this.isDeveloperMode = value;
                    this.display();
                })
            );

        // Developer settings section
        if (this.isDeveloperMode) {
            const developerSection = mainInterface.createDiv(
                'ai-providers-developer-settings'
            );

            new Setting(developerSection)
                .setName(I18n.t('settings.debugLogging'))
                .setDesc(I18n.t('settings.debugLoggingDesc'))
                .addToggle(toggle =>
                    toggle
                        .setValue(this.plugin.settings.debugLogging ?? false)
                        .onChange(async value => {
                            this.plugin.settings.debugLogging = value;
                            logger.setEnabled(value);
                            await this.plugin.saveSettings();
                        })
                );

            new Setting(developerSection)
                .setName(I18n.t('settings.useNativeFetch'))
                .setDesc(I18n.t('settings.useNativeFetchDesc'))
                .addToggle(toggle =>
                    toggle
                        .setValue(this.plugin.settings.useNativeFetch ?? false)
                        .onChange(async value => {
                            this.plugin.settings.useNativeFetch = value;
                            await this.plugin.saveSettings();
                        })
                );
        }
    }
}
