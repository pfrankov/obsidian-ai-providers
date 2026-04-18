import {
    App,
    Modal,
    Setting,
    Notice,
    Platform,
    AbstractInputSuggest,
    TextComponent,
    prepareFuzzySearch,
    sanitizeHTMLToDom,
    setIcon,
} from 'obsidian';
import type { SearchMatches } from 'obsidian';
import { I18n } from '../i18n';
import {
    IAIModelCapabilities,
    IAIProvider,
    AIProviderType,
} from '@obsidian-ai-providers/sdk';
import { logger } from '../utils/logger';
import AIProvidersPlugin from '../main';
import { probeModelCapabilities } from '../utils/modelCapabilityChecker';

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
    ai302: {
        url: 'https://api.302.ai/v1',
        name: '302.AI',
        options: { modelsFetching: false },
    },
    anthropic: {
        url: 'https://api.anthropic.com',
        name: 'Anthropic',
    },
    mistral: {
        url: 'https://api.mistral.ai/v1',
        name: 'Mistral AI',
    },
    together: {
        url: 'https://api.together.xyz/v1',
        name: 'Together AI',
    },
    fireworks: {
        url: 'https://api.fireworks.ai/inference/v1',
        name: 'Fireworks AI',
    },
    perplexity: {
        url: 'https://api.perplexity.ai',
        name: 'Perplexity AI',
    },
    deepseek: {
        url: 'https://api.deepseek.com',
        name: 'DeepSeek',
    },
    xai: {
        url: 'https://api.x.ai/v1',
        name: 'xAI (Grok)',
    },
    novita: {
        url: 'https://api.novita.ai/openai/v1',
        name: 'Novita AI',
    },
    deepinfra: {
        url: 'https://api.deepinfra.com/v1/openai',
        name: 'DeepInfra',
    },
    sambanova: {
        url: 'https://api.sambanova.ai/v1',
        name: 'SambaNova',
    },
    cerebras: {
        url: 'https://api.cerebras.ai/v1',
        name: 'Cerebras',
    },
    zai: {
        url: 'https://api.z.ai/api/paas/v4/',
        name: 'Z.AI',
    },
};

// Providers that don't support model fetching are now handled via PROVIDER_CONFIGS options

interface ModelSuggestOptions {
    models: string[];
    onSelect: (value: string) => void;
}

interface ModelControlState {
    models: string[];
    currentModel: string;
    isDisabled: boolean;
    placeholder: string;
}

class ModelSuggest extends AbstractInputSuggest<string> {
    private models: string[];
    private onSelectValue: (value: string) => void;
    private matchCache = new Map<string, SearchMatches>();
    private lastQuery = '';
    private lastMatches: string[] = [];
    private minQueryLength = 2;
    private suppressNextUpdate = false;

    constructor(
        app: App,
        inputEl: HTMLInputElement,
        options: ModelSuggestOptions
    ) {
        super(app, inputEl);
        this.models = options.models;
        this.onSelectValue = options.onSelect;
        this.limit = 50;
        this.onSelect(value => {
            this.onSelectValue(value);
        });
    }

    selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
        this.suppressNextUpdate = true;
        super.selectSuggestion(value, evt);
        this.close();
    }

    getSuggestions(query: string): string[] {
        if (this.suppressNextUpdate) {
            this.suppressNextUpdate = false;
            return [];
        }

        const trimmedQuery = query.trim();
        this.matchCache.clear();

        if (!trimmedQuery) {
            this.lastQuery = '';
            this.lastMatches = this.models;
            return this.models.slice(0, this.limit);
        }

        if (trimmedQuery.length < this.minQueryLength) {
            const lowerQuery = trimmedQuery.toLowerCase();
            const matches = this.models
                .filter(model => model.toLowerCase().includes(lowerQuery))
                .slice(0, this.limit);
            this.lastQuery = trimmedQuery;
            this.lastMatches = matches;
            return matches;
        }

        const reuseCandidates =
            this.lastQuery.length >= this.minQueryLength &&
            trimmedQuery.startsWith(this.lastQuery);
        const candidates = reuseCandidates ? this.lastMatches : this.models;
        const fuzzySearch = prepareFuzzySearch(trimmedQuery);
        const matches = candidates
            .map(model => {
                const match = fuzzySearch(model);
                return match
                    ? {
                          model,
                          matches: match.matches,
                          score: match.score,
                      }
                    : null;
            })
            .filter(
                (
                    item
                ): item is {
                    model: string;
                    matches: SearchMatches;
                    score: number;
                } => Boolean(item)
            )
            .sort((a, b) => b.score - a.score);
        this.lastQuery = trimmedQuery;
        this.lastMatches = matches.map(item => item.model);

        const limited = matches.slice(0, this.limit);
        limited.forEach(item => {
            this.matchCache.set(item.model, item.matches);
        });
        return limited.map(item => item.model);
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.setAttribute('data-testid', 'model-suggestion');
        el.setAttribute('data-value', value);

        const matches = this.matchCache.get(value);
        if (!matches || matches.length === 0) {
            el.textContent = value;
            return;
        }

        const orderedMatches = [...matches].sort(
            ([startA], [startB]) => startA - startB
        );
        let lastIndex = 0;
        orderedMatches.forEach(([start, end]) => {
            if (start > lastIndex) {
                el.appendText(value.slice(lastIndex, start));
            }
            const highlight = el.createSpan('suggestion-highlight');
            highlight.textContent = value.slice(start, end);
            lastIndex = end;
        });

        if (lastIndex < value.length) {
            el.appendText(value.slice(lastIndex));
        }
    }
}

export class ProviderFormModal extends Modal {
    private nameModified = false;
    private urlModified = false;
    private isLoadingModels = false;
    private isCheckingModelCapabilities = false;
    private modelCapabilitiesStatus = '';
    private modelCapabilitiesSetting?: Setting;
    private modelSuggest?: ModelSuggest;

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

    private getModelDescription(forceText: boolean): string {
        if (forceText) {
            return I18n.t('settings.modelTextOnlyDesc');
        }
        return I18n.t('settings.modelDesc');
    }

    private getModelControlState(): ModelControlState {
        const models = this.provider.availableModels || [];
        const hasModels = models.length > 0;
        const isDisabled = this.isLoadingModels || !hasModels;
        const placeholder = this.isLoadingModels
            ? I18n.t('settings.loadingModels')
            : hasModels
              ? I18n.t('settings.modelSearchPlaceholder')
              : I18n.t('settings.noModelsAvailable');
        const currentModel = this.provider.model || '';

        return {
            models,
            currentModel,
            isDisabled,
            placeholder,
        };
    }

    private getDefaultName(type: AIProviderType): string {
        return PROVIDER_CONFIGS[type].name;
    }

    private getSelectedModel(): string {
        return (this.provider.model || '').trim();
    }

    private getDefaultModelCapabilities(): IAIModelCapabilities {
        return {
            embedding: false,
            text: false,
            tools: false,
            vision: false,
        };
    }

    private getSelectedModelCapabilities(): IAIModelCapabilities {
        const selectedModel = this.getSelectedModel();
        if (!selectedModel) {
            return this.getDefaultModelCapabilities();
        }

        return (
            this.provider.modelCapabilities?.[selectedModel] ||
            this.getDefaultModelCapabilities()
        );
    }

    private setSelectedModelCapabilities(capabilities: IAIModelCapabilities) {
        const selectedModel = this.getSelectedModel();
        if (!selectedModel) {
            return;
        }

        if (!this.provider.modelCapabilities) {
            this.provider.modelCapabilities = {};
        }
        this.provider.modelCapabilities[selectedModel] = capabilities;
        this.persistModelCapabilities();
    }

    private persistModelCapabilities() {
        const settingsProvider = this.plugin.settings.providers?.find(
            (p: IAIProvider) => p.id === this.provider.id
        );
        if (settingsProvider) {
            settingsProvider.modelCapabilities = {
                ...this.provider.modelCapabilities,
            };
            this.plugin.saveSettings();
        }
    }

    private setSelectedModelCapability(
        key: keyof IAIModelCapabilities,
        value: boolean
    ) {
        const current = this.getSelectedModelCapabilities();
        this.setSelectedModelCapabilities({
            ...current,
            [key]: value,
        });
    }

    private renderModelCapabilitiesSection() {
        if (!this.modelCapabilitiesSetting) {
            return;
        }

        const setting = this.modelCapabilitiesSetting;
        setting.nameEl.textContent = '';
        setting.descEl.empty();
        setting.controlEl.empty();

        const selectedModel = this.getSelectedModel();
        if (!selectedModel) {
            setting.settingEl.style.display = 'none';
            return;
        }

        setting.settingEl.style.display = '';
        setting
            .setName(I18n.t('settings.modelCapabilities'))
            .setClass('ai-providers-model-capabilities-setting');
        const descriptionEl = setting.descEl;
        const modelEl = descriptionEl.createDiv(
            'ai-providers-model-capabilities-model'
        );
        modelEl.textContent = selectedModel;
        if (this.modelCapabilitiesStatus) {
            const statusEl = descriptionEl.createDiv(
                'ai-providers-model-capabilities-status'
            );
            statusEl.textContent = this.modelCapabilitiesStatus;
        }

        setting.controlEl.addClass('ai-providers-model-capabilities-control');
        const layoutEl = setting.controlEl.createDiv(
            'ai-providers-model-capabilities-layout'
        );

        const checkButton = layoutEl.createEl('button') as HTMLButtonElement;
        checkButton.addClass('ai-providers-model-capabilities-check-btn');
        // Icon alternatives: 'cpu', 'telescope', 'zap', 'sparkles'
        setIcon(checkButton, 'scan');
        const checkTooltip = I18n.t('settings.modelCapabilitiesCheckTooltip');
        checkButton.setAttribute('aria-label', checkTooltip);
        checkButton.createEl('span', {
            text: this.isCheckingModelCapabilities
                ? I18n.t('settings.modelCapabilitiesChecking')
                : I18n.t('settings.modelCapabilitiesCheck'),
        });
        checkButton.disabled = this.isCheckingModelCapabilities;
        checkButton.setAttribute('data-testid', 'check-model-capabilities');
        checkButton.addEventListener('click', async () => {
            await this.checkModelCapabilities();
        });

        const capabilities = this.getSelectedModelCapabilities();
        const capabilityLabels: Array<[keyof IAIModelCapabilities, string]> = [
            ['embedding', I18n.t('settings.modelCapabilityEmbedding')],
            ['text', I18n.t('settings.modelCapabilityText')],
            ['tools', I18n.t('settings.modelCapabilityTools')],
            ['vision', I18n.t('settings.modelCapabilityVision')],
        ];
        const checkboxGrid = layoutEl.createDiv(
            'ai-providers-model-capabilities-grid'
        );

        capabilityLabels.forEach(([key, label]) => {
            const labelEl = checkboxGrid.createEl('label');
            labelEl.addClass('ai-providers-model-capability');
            const checkbox = labelEl.createEl('input') as HTMLInputElement;
            checkbox.type = 'checkbox';
            checkbox.checked = capabilities[key];
            checkbox.setAttribute('data-testid', `model-capability-${key}`);
            checkbox.addEventListener('change', () => {
                this.setSelectedModelCapability(key, checkbox.checked);
            });
            labelEl.createEl('span', { text: label });
        });
    }

    private async checkModelCapabilities() {
        const selectedModel = this.getSelectedModel();
        if (!selectedModel) {
            new Notice(I18n.t('settings.selectModelFirst'));
            return;
        }

        try {
            this.isCheckingModelCapabilities = true;
            this.modelCapabilitiesStatus = I18n.t(
                'settings.modelCapabilitiesChecking'
            );
            this.renderModelCapabilitiesSection();

            const capabilities = await probeModelCapabilities({
                aiProviders: this.plugin.aiProviders,
                provider: this.provider,
            });

            this.setSelectedModelCapabilities(capabilities);
            this.modelCapabilitiesStatus = I18n.t(
                'settings.modelCapabilitiesUpdated'
            );
        } catch (error) {
            logger.error('Failed to probe model capabilities:', error);
            this.modelCapabilitiesStatus = I18n.t(
                'settings.modelCapabilitiesCheckFailed',
                {
                    message: (error as Error).message,
                }
            );
        } finally {
            this.isCheckingModelCapabilities = false;
            this.renderModelCapabilitiesSection();
        }
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

        const modelSetting = new Setting(contentEl)
            .setName(I18n.t('settings.model'))
            .setDesc(this.getModelDescription(forceTextMode));

        this.modelSuggest?.close();
        this.modelSuggest = undefined;

        if (forceTextMode) {
            this.createTextInput(modelSetting);
            this.setupDescription(modelSetting, true);
            return modelSetting;
        }

        const modelState = this.getModelControlState();

        modelSetting.controlEl.addClass('ai-providers-model-control');
        if (Platform.isMobileApp) {
            modelSetting.controlEl.addClass(
                'ai-providers-model-control--mobile'
            );
        }

        if (Platform.isMobileApp) {
            modelSetting.addDropdown(dropdown => {
                dropdown.selectEl.setAttribute('data-testid', 'model-select');
                dropdown.selectEl.addClass('dropdown');
                dropdown.setDisabled(modelState.isDisabled);
                dropdown.addOption('', modelState.placeholder);

                const optionValues = modelState.currentModel
                    ? [modelState.currentModel, ...modelState.models]
                    : modelState.models;
                Array.from(new Set(optionValues)).forEach(model => {
                    dropdown.addOption(model, model);
                });

                dropdown.setValue(modelState.currentModel);
                dropdown.onChange(value => {
                    this.provider.model = value;
                    this.renderModelCapabilitiesSection();
                });
                return dropdown;
            });
        } else {
            this.createComboBox(modelSetting, modelState);
        }

        this.createRefresh(modelSetting);
        this.setupDescription(modelSetting, false);
        return modelSetting;
    }

    private createTextInput(modelSetting: Setting) {
        modelSetting.addText(text => {
            text.setValue(this.provider.model || '').onChange(value => {
                this.provider.model = value;
                this.renderModelCapabilitiesSection();
            });
            text.inputEl.setAttribute('data-testid', 'model-input');
            return text;
        });
    }

    private createComboBox(
        modelSetting: Setting,
        modelState: ModelControlState
    ) {
        const { models, currentModel, isDisabled, placeholder } = modelState;
        const inputWrapper = modelSetting.controlEl.createDiv(
            'ai-providers-model-input'
        );
        const input = new TextComponent(inputWrapper);

        input.setPlaceholder(placeholder);
        input.setValue(currentModel);
        input.setDisabled(isDisabled);
        input.onChange(value => {
            this.provider.model = value;
            input.inputEl.title = value;
            this.renderModelCapabilitiesSection();
        });

        input.inputEl.setAttribute('data-testid', 'model-combobox-input');
        input.inputEl.setAttribute('role', 'combobox');
        input.inputEl.setAttribute('aria-autocomplete', 'list');
        input.inputEl.title = currentModel;

        if (isDisabled) {
            return;
        }

        this.modelSuggest = new ModelSuggest(this.app, input.inputEl, {
            models,
            onSelect: value => {
                this.provider.model = value;
                input.setValue(value);
                input.inputEl.title = value;
                this.renderModelCapabilitiesSection();
            },
        });
    }

    private createRefresh(modelSetting: Setting) {
        modelSetting.addButton(button => {
            button
                .setIcon('refresh-cw')
                .setTooltip(I18n.t('settings.refreshModelsList'));

            button.buttonEl.addClass('ai-providers-model-refresh');
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

    private setupDescription(modelSetting: Setting, forceText: boolean) {
        const descEl = modelSetting.descEl;
        descEl.empty();
        descEl.appendChild(
            sanitizeHTMLToDom(this.getModelDescription(forceText))
        );
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
            .addText(text => {
                text.setPlaceholder(I18n.t('settings.apiKeyPlaceholder'))
                    .setValue(this.provider.apiKey || '')
                    .onChange(value => {
                        this.provider.apiKey = value;
                    });

                text.inputEl.type = 'password';
                text.inputEl.addEventListener('focus', () => {
                    text.inputEl.type = 'text';
                });
                text.inputEl.addEventListener('blur', () => {
                    text.inputEl.type = 'password';
                });

                return text;
            });

        this.createModelSetting(contentEl);
        this.modelCapabilitiesSetting = new Setting(contentEl);
        this.renderModelCapabilitiesSection();

        new Setting(contentEl)
            .addButton(button =>
                button
                    .setButtonText(I18n.t('settings.save'))
                    .setCta()
                    .onClick(async () => {
                        // Trim name to avoid issues with whitespace
                        this.provider.name = this.provider.name.trim();
                        await this.onSave(this.provider);
                        // Note: Modal will be closed by saveProvider if validation passes
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
        this.modelSuggest?.close();
        this.modelSuggest = undefined;
        this.modelCapabilitiesSetting = undefined;
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
        this.provider.modelCapabilities = undefined;

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
            this.renderModelCapabilitiesSection();
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
