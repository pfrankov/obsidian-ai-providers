import { App, Modal, Setting, Notice, sanitizeHTMLToDom } from 'obsidian';
import { I18n } from '../i18n';
import { IAIProvider, AIProviderType } from '@obsidian-ai-providers/sdk';
import { logger } from '../utils/logger';
import AIProvidersPlugin from '../main';

interface ProviderConfig {
    url: string;
    name: string;
    options?: {
        modelsFetching?: boolean;
    };
}

const PROVIDER_CONFIGS: Record<AIProviderType, ProviderConfig> = {
    openai: {
        url: 'https://api.openai.com/v1',
        name: 'OpenAI',
    },
    ollama: {
        url: 'http://localhost:11434',
        name: 'Ollama',
    },
    'ollama-openwebui': {
        url: 'http://localhost:3000/ollama',
        name: 'Ollama (Open WebUI)',
    },
    gemini: {
        url: 'https://generativelanguage.googleapis.com/v1beta/openai',
        name: 'Google Gemini',
    },
    openrouter: {
        url: 'https://openrouter.ai/api/v1',
        name: 'OpenRouter',
    },
    lmstudio: {
        url: 'http://localhost:1234/v1',
        name: 'LM Studio',
    },
    groq: {
        url: 'https://api.groq.com/openai/v1',
        name: 'Groq',
    },
    ai320: {
        url: 'https://api.302.ai',
        name: '320.AI',
        options: { modelsFetching: false },
    },
};

// Providers that don't support model fetching are now handled via PROVIDER_CONFIGS options

export class ProviderFormModal extends Modal {
    private nameModified = false;
    private urlModified = false;
    private isTextMode = false;
    private isLoadingModels = false;

    constructor(
        app: App,
        private plugin: AIProvidersPlugin,
        private provider: IAIProvider,
        private onSave: (provider: IAIProvider) => Promise<void>,
        private isAddingNew = false
    ) {
        super(app);
    }

    private hasModelFetching(type: AIProviderType): boolean {
        const config = PROVIDER_CONFIGS[type];
        return config.options?.modelsFetching !== false;
    }

    private getModelDescription(useText: boolean, forceText: boolean): string {
        if (forceText) {
            return I18n.t('settings.modelTextOnlyDesc');
        }
        return useText
            ? I18n.t('settings.modelTextDesc')
            : I18n.t('settings.modelDesc');
    }

    private getDefaultName(type: AIProviderType): string {
        return PROVIDER_CONFIGS[type].name;
    }

    private initDefaults() {
        // Reset modification tracking when modal reopens
        this.nameModified = false;
        this.urlModified = false;

        // Set default URL if not already set
        if (!this.provider.url) {
            this.provider.url = PROVIDER_CONFIGS[this.provider.type].url;
        }

        // Set default name for new providers
        if (this.isAddingNew && !this.provider.name) {
            this.provider.name = this.getDefaultName(this.provider.type);
        }
    }

    private createModelSetting(contentEl: HTMLElement) {
        const forceTextMode = !this.hasModelFetching(this.provider.type);
        const useTextMode = this.isTextMode || forceTextMode;

        const modelSetting = new Setting(contentEl)
            .setName(I18n.t('settings.model'))
            .setDesc(this.getModelDescription(useTextMode, forceTextMode));

        if (useTextMode) {
            this.createTextInput(modelSetting);
        } else {
            this.createDropdown(modelSetting);
            this.createRefresh(modelSetting);
        }

        this.setupDescription(modelSetting, useTextMode, forceTextMode);
        return modelSetting;
    }

    private createTextInput(modelSetting: Setting) {
        modelSetting.addText(text => {
            text.setValue(this.provider.model || '').onChange(value => {
                this.provider.model = value;
            });
            text.inputEl.setAttribute('data-testid', 'model-input');
            return text;
        });
    }

    private createDropdown(modelSetting: Setting) {
        modelSetting.addDropdown(dropdown => {
            this.populateDropdown(dropdown);
            this.setupDropdown(dropdown);
            return dropdown;
        });
    }

    private populateDropdown(dropdown: any) {
        if (this.isLoadingModels) {
            dropdown.addOption('loading', I18n.t('settings.loadingModels'));
            dropdown.setDisabled(true);
            return;
        }

        const models = this.provider.availableModels;
        if (!models || models.length === 0) {
            dropdown.addOption('none', I18n.t('settings.noModelsAvailable'));
            dropdown.setDisabled(true);
            return;
        }

        models.forEach(model => {
            dropdown.addOption(model, model);
            const options = dropdown.selectEl.options;
            const lastOption = options[options.length - 1];
            lastOption.title = model;
        });
        dropdown.setDisabled(false);
    }

    private setupDropdown(dropdown: any) {
        dropdown
            .setValue(this.provider.model || '')
            .onChange((value: string) => {
                this.provider.model = value;
                dropdown.selectEl.title = value;
            });

        dropdown.selectEl.setAttribute('data-testid', 'model-dropdown');
        dropdown.selectEl.title = this.provider.model || '';
        dropdown.selectEl.parentElement?.addClass(
            'ai-providers-model-dropdown'
        );
    }

    private createRefresh(modelSetting: Setting) {
        modelSetting.addButton(button => {
            button
                .setIcon('refresh-cw')
                .setTooltip(I18n.t('settings.refreshModelsList'));

            button.buttonEl.setAttribute(
                'data-testid',
                'refresh-models-button'
            );

            if (this.isLoadingModels) {
                button.setDisabled(true);
                button.buttonEl.addClass('loading');
            }

            button.onClick(async () => {
                await this.refreshModels();
            });
        });
    }

    private async refreshModels() {
        try {
            this.isLoadingModels = true;
            this.display();

            const models = await this.plugin.aiProviders.fetchModels(
                this.provider
            );
            this.provider.availableModels = models;

            if (models.length > 0) {
                this.provider.model = models[0] || '';
            }

            new Notice(I18n.t('settings.modelsUpdated'));
        } catch (error) {
            logger.error('Failed to fetch models:', error);
            new Notice(I18n.t('errors.failedToFetchModels'));
        } finally {
            this.isLoadingModels = false;
            this.display();
        }
    }

    private setupDescription(
        modelSetting: Setting,
        useText: boolean,
        forceText: boolean
    ) {
        const descEl = modelSetting.descEl;
        descEl.empty();
        descEl.appendChild(
            sanitizeHTMLToDom(this.getModelDescription(useText, forceText))
        );

        // Add click handler for the link (only if not forced to text mode)
        if (!forceText) {
            const link = descEl.querySelector('a');
            if (link) {
                link.addEventListener('click', e => {
                    e.preventDefault();
                    this.isTextMode = !this.isTextMode;
                    this.display();
                });
            }
        }
    }

    onOpen() {
        const { contentEl } = this;
        this.initDefaults();

        // Add form title
        contentEl
            .createEl('h2', {
                text: this.isAddingNew
                    ? I18n.t('settings.addNewProvider')
                    : I18n.t('settings.editProvider'),
            })
            .setAttribute('data-testid', 'provider-form-title');

        new Setting(contentEl)
            .setName(I18n.t('settings.providerType'))
            .setDesc(I18n.t('settings.providerTypeDesc'))
            .addDropdown(dropdown => {
                const options = Object.entries(PROVIDER_CONFIGS).reduce(
                    (acc, [type, config]) => {
                        acc[type] = config.name;
                        return acc;
                    },
                    {} as Record<string, string>
                );

                dropdown
                    .addOptions(options)
                    .setValue(this.provider.type)
                    .onChange(value => {
                        this.changeProviderType(value as AIProviderType);
                    });

                dropdown.selectEl.setAttribute(
                    'data-testid',
                    'provider-type-dropdown'
                );
                return dropdown;
            });

        new Setting(contentEl)
            .setName(I18n.t('settings.providerName'))
            .setDesc(I18n.t('settings.providerNameDesc'))
            .addText(text => {
                text.setPlaceholder(I18n.t('settings.providerNamePlaceholder'))
                    .setValue(this.provider.name)
                    .onChange(value => {
                        this.provider.name = value;
                        // Track that the name has been manually modified
                        this.nameModified = true;
                    });
                text.inputEl.setAttribute('data-field', 'provider-name');
                return text;
            });

        new Setting(contentEl)
            .setName(I18n.t('settings.providerUrl'))
            .setDesc(I18n.t('settings.providerUrlDesc'))
            .addText(text => {
                text.setPlaceholder(I18n.t('settings.providerUrlPlaceholder'))
                    .setValue(this.provider.url || '')
                    .onChange(value => {
                        this.provider.url = value;
                        // Track that the URL has been manually modified
                        this.urlModified = true;
                    });
                text.inputEl.setAttribute('data-field', 'provider-url');
                return text;
            });

        new Setting(contentEl)
            .setName(I18n.t('settings.apiKey'))
            .setDesc(I18n.t('settings.apiKeyDesc'))
            .addText(text =>
                text
                    .setPlaceholder(I18n.t('settings.apiKeyPlaceholder'))
                    .setValue(this.provider.apiKey || '')
                    .onChange(value => {
                        this.provider.apiKey = value;
                    })
            );

        this.createModelSetting(contentEl);

        new Setting(contentEl)
            .addButton(button =>
                button
                    .setButtonText(I18n.t('settings.save'))
                    .setCta()
                    .onClick(async () => {
                        await this.onSave(this.provider);
                        this.close();
                    })
            )
            .addButton(button => {
                button.setButtonText(I18n.t('settings.cancel')).onClick(() => {
                    this.close();
                });
                button.buttonEl.setAttribute('data-testid', 'cancel-button');
                return button;
            });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    private changeProviderType(newType: AIProviderType) {
        const currentDefaultName = this.getDefaultName(this.provider.type);
        const currentDefaultUrl = PROVIDER_CONFIGS[this.provider.type].url;
        const currentHasFetching = this.hasModelFetching(this.provider.type);
        const newHasFetching = this.hasModelFetching(newType);

        // Update provider properties
        this.provider.type = newType;
        this.provider.availableModels = undefined;
        this.provider.model = undefined;

        // Update URL only for new providers or if URL hasn't been manually modified
        if (
            this.isAddingNew &&
            (!this.urlModified || this.provider.url === currentDefaultUrl)
        ) {
            this.provider.url = PROVIDER_CONFIGS[newType].url;
            this.urlModified = false;
        }

        // Update name only for new providers or if name hasn't been manually modified
        if (
            this.isAddingNew &&
            (!this.nameModified || this.provider.name === currentDefaultName)
        ) {
            this.provider.name = this.getDefaultName(newType);
            this.nameModified = false;
        }

        // Check if form needs recreation for different model input modes
        const needsRecreation = currentHasFetching !== newHasFetching;
        if (needsRecreation) {
            this.display();
        } else {
            this.updateFields();
        }
    }

    private updateFields() {
        const urlInput = this.contentEl.querySelector(
            'input[data-field="provider-url"]'
        ) as HTMLInputElement | null;
        const nameInput = this.contentEl.querySelector(
            'input[data-field="provider-name"]'
        ) as HTMLInputElement | null;

        if (urlInput) {
            urlInput.value = this.provider.url || '';
        }
        if (nameInput) {
            nameInput.value = this.provider.name;
        }
    }

    display() {
        const { contentEl } = this;
        contentEl.empty();
        this.onOpen();
    }
}
