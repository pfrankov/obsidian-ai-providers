import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import AIProvidersPlugin from './main';
import { I18n } from './i18n';
import { ConfirmationModal } from './modals/ConfirmationModal';
import { IAIProvider } from './types';
import { openAIIcon, ollamaIcon } from './utils/icons';

export interface IAIProvidersPluginSettings {
    providers?: IAIProvider[];
    _version: number;
}

export const DEFAULT_SETTINGS: IAIProvidersPluginSettings = {
    _version: 1
}

export class AIProvidersSettingTab extends PluginSettingTab {
    private isFormOpen = false;
    private editingProvider: IAIProvider | null = null;
    private isLoadingModels = false;
    private isAddingNewProvider = false;
    private readonly defaultProvidersUrls = {
        openai: "https://api.openai.com/v1",
        ollama: "http://localhost:11434"
    };

    plugin: AIProvidersPlugin;

    constructor(app: App, plugin: AIProvidersPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private openForm(isAdding: boolean, provider?: IAIProvider) {
        this.isFormOpen = true;
        this.isAddingNewProvider = isAdding;
        this.editingProvider = provider || {
            id: Date.now().toString(),
            name: "",
            apiKey: "",
            url: "",
            type: "openai"
        };
        this.display();
    }

    private closeForm() {
        this.isFormOpen = false;
        this.isAddingNewProvider = false;
        this.editingProvider = null;
        this.display();
    }

    private validateProvider(provider: IAIProvider): boolean {
        // Validate required fields
        if (!provider.name || !provider.url) return false;

        // Validate URL format
        try {
            new URL(provider.url);
        } catch {
            return false;
        }

        // Validate provider type
        if (!['openai', 'ollama'].includes(provider.type)) {
            return false;
        }

        // Check for duplicate names
        const providers = this.plugin.settings.providers || [];
        const existingProvider = providers.find(p => p.name === provider.name && p.id !== provider.id);
        if (existingProvider) {
            return false;
        }

        return true;
    }

    async saveProvider(provider: IAIProvider) {
        if (!this.validateProvider(provider)) return;

        const providers = this.plugin.settings.providers || [];
        const existingIndex = providers.findIndex(p => p.id === provider.id);
        
        if (existingIndex !== -1) {
            providers[existingIndex] = provider;
        } else {
            providers.push(provider);
        }
        
        this.plugin.settings.providers = providers;
        await this.plugin.saveSettings();
        this.display();
    }

    async deleteProvider(provider: IAIProvider) {
        const providers = this.plugin.settings.providers || [];
        const index = providers.findIndex(p => p.id === provider.id);
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
            id: Date.now().toString(),
            name: `${provider.name} (${I18n.t('settings.duplicate')})`
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

        // Если форма открыта, показываем только её
        if (this.isFormOpen && this.editingProvider) {
            const formEl = containerEl.createDiv('ai-providers-form');
            formEl.setAttribute('data-testid', 'provider-form');
            const provider = this.editingProvider;
            
            // Добавляем заголовок формы
            const titleEl = formEl.createEl('h2', { 
                text: this.isAddingNewProvider 
                    ? I18n.t('settings.addNewProvider')
                    : I18n.t('settings.editProvider') 
            });
            titleEl.setAttribute('data-testid', 'provider-form-title');

            new Setting(formEl)
                .setName(I18n.t('settings.providerType'))
                .setDesc(I18n.t('settings.providerTypeDesc'))
                .addDropdown(dropdown => {
                    dropdown
                        .addOptions({
                            "openai": "OpenAI",
                            "ollama": "Ollama"
                        })
                        .setValue(provider.type)
                        .onChange(value => {
                            provider.type = value as 'openai' | 'ollama';
                            provider.url = this.defaultProvidersUrls[value as 'openai' | 'ollama'];
                            provider.availableModels = undefined;
                            provider.model = undefined;
                            this.display();
                        });
                    
                    dropdown.selectEl.setAttribute('data-testid', 'provider-type-dropdown');
                    return dropdown;
                });

            new Setting(formEl)
                .setName(I18n.t('settings.providerName'))
                .setDesc(I18n.t('settings.providerNameDesc'))
                .addText(text => text
                    .setPlaceholder(I18n.t('settings.providerNamePlaceholder'))
                    .setValue(provider.name)
                    .onChange(value => provider.name = value));

            new Setting(formEl)
                .setName(I18n.t('settings.providerUrl'))
                .setDesc(I18n.t('settings.providerUrlDesc'))
                .addText(text => text
                    .setPlaceholder(I18n.t('settings.providerUrlPlaceholder'))
                    .setValue(provider.url)
                    .onChange(value => provider.url = value));

            new Setting(formEl)
                .setName(I18n.t('settings.apiKey'))
                .setDesc(I18n.t('settings.apiKeyDesc'))
                .addText(text => text
                    .setPlaceholder(I18n.t('settings.apiKeyPlaceholder'))
                    .setValue(provider.apiKey)
                    .onChange(value => provider.apiKey = value));

            new Setting(formEl)
                .setName(I18n.t('settings.model'))
                .setDesc(I18n.t('settings.modelDesc'))
                .addDropdown(dropdown => {
                    if (this.isLoadingModels) {
                        dropdown.addOption('loading', I18n.t('settings.loadingModels'));
                        dropdown.setDisabled(true);
                    } else {
                        const models = provider.availableModels;
                        if (!models || models.length === 0) {
                            dropdown.addOption('none', I18n.t('settings.noModelsAvailable'));
                            dropdown.setDisabled(true);
                        } else {
                            models.forEach(model => dropdown.addOption(model, model));
                            dropdown.setDisabled(false);
                        }
                    }

                    dropdown
                        .setValue(provider.model?.id || "")
                        .onChange(value => {
                            provider.model = {
                                id: value
                            };
                        });
                    
                    dropdown.selectEl.setAttribute('data-testid', 'model-dropdown');
                    return dropdown;
                })
                .addButton(button => {
                    button
                        .setIcon("refresh-cw")
                        .setTooltip(I18n.t('settings.refreshModelsList'));
                    
                    button.buttonEl.setAttribute('data-testid', 'refresh-models-button');
                    
                    if (this.isLoadingModels) {
                        button.setDisabled(true);
                        button.buttonEl.addClass('loading');
                    }
                    
                    button.onClick(async () => {
                        try {
                            this.isLoadingModels = true;
                            this.display();
                            
                            const models = await this.plugin.aiProviders.fetchModels(provider);
                            provider.availableModels = models;
                            if (models.length > 0) {
                                provider.model = {
                                    id: models[0] || ""
                                };
                            }
                            
                            new Notice(I18n.t('settings.modelsUpdated'));
                        } catch (error) {
                            console.error(error);
                            new Notice(I18n.t('errors.failedToFetchModels'));
                        } finally {
                            this.isLoadingModels = false;
                            this.display();
                        }
                    });
                });

            new Setting(formEl)
                .addButton(button => button
                    .setButtonText(I18n.t('settings.save'))
                    .setCta()
                    .onClick(async () => {
                        await this.saveProvider(provider);
                        this.closeForm();
                    }))
                .addButton(button => {
                    button
                        .setButtonText(I18n.t('settings.cancel'))
                        .onClick(() => {
                            this.closeForm();
                        });
                    button.buttonEl.setAttribute('data-testid', 'cancel-button');
                    return button;
                });

            return;
        }

        // Показываем основной интерфейс только если форма закрыта
        const mainInterface = containerEl.createDiv('ai-providers-main-interface');
        mainInterface.setAttribute('data-testid', 'main-interface');

        const addProviderSetting = new Setting(mainInterface)
            .setName(I18n.t('settings.addNewProvider'))
            .addButton(button => button
                .setButtonText(I18n.t('settings.addProvider'))
                .onClick(() => {
                    if (this.isFormOpen) return;
                    this.openForm(true);
                }));
        
        addProviderSetting.settingEl.setAttribute('data-testid', 'add-provider-button');

        const providers = this.plugin.settings.providers || [];
        if (providers.length > 0) {
            const listEl = mainInterface.createEl('h2', { text: I18n.t('settings.configuredProviders') });
            listEl.setAttribute('data-testid', 'provider-list');
            
            providers.forEach(provider => {
                const setting = new Setting(mainInterface)
                    .setName(provider.name)
                    .setDesc(provider.url);

                // Добавляем иконку провайдера перед названием
                const nameEl = setting.nameEl;
                const iconEl = createSpan({ cls: 'provider-icon' });
                iconEl.innerHTML = provider.type === 'openai' ? openAIIcon : ollamaIcon;

                // Перемещаем иконку �� начало названия
                nameEl.prepend(iconEl as any);

                // Add model pill if model is selected
                if (provider.model?.id) {
                    const modelPill = setting.settingEl.createDiv('model-pill');
                    modelPill.textContent = provider.model.id;
                    modelPill.setAttribute('data-testid', 'model-pill');
                    nameEl.after(modelPill as any);
                }

                setting
                    .addExtraButton(button => {
                        button
                            .setIcon("gear")
                            .setTooltip(I18n.t('settings.options'))
                            .onClick(() => {
                                if (this.isFormOpen) return;
                                this.openForm(false, { ...provider });
                            });
                        
                        button.extraSettingsEl.setAttribute('data-testid', 'edit-provider');
                    })
                    .addExtraButton(button => {
                        button
                            .setIcon("copy")
                            .setTooltip(I18n.t('settings.duplicate'))
                            .onClick(async () => {
                                await this.duplicateProvider(provider);
                            });
                        
                        button.extraSettingsEl.setAttribute('data-testid', 'duplicate-provider');
                    })
                    .addExtraButton(button => {
                        button
                            .setIcon("lucide-trash-2")
                            .setTooltip(I18n.t('settings.delete'))
                            .onClick(() => {
                                new ConfirmationModal(
                                    this.app,
                                    I18n.t('settings.deleteConfirmation', { name: provider.name }),
                                    async () => {
                                        await this.deleteProvider(provider);
                                    }
                                ).open();
                            });

                        button.extraSettingsEl.setAttribute('data-testid', 'delete-provider');
                    });
            });
        }
    }
}