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
} from 'obsidian';
import type { SearchMatches } from 'obsidian';
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

        const modelSetting = new Setting(contentEl)
            .setName(I18n.t('settings.model'))
            .setDesc(this.getModelDescription(forceTextMode));

        if (forceTextMode) {
            this.createTextInput(modelSetting);
        } else {
            this.createComboBox(modelSetting);
            this.createRefresh(modelSetting);
        }

        this.setupDescription(modelSetting, forceTextMode);
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

    private createComboBox(modelSetting: Setting) {
        const models = this.provider.availableModels || [];
        const hasModels = models.length > 0;
        const isDisabled = this.isLoadingModels || !hasModels;
        const placeholder = this.isLoadingModels
            ? I18n.t('settings.loadingModels')
            : hasModels
              ? I18n.t('settings.modelSearchPlaceholder')
              : I18n.t('settings.noModelsAvailable');

        this.modelSuggest?.close();
        this.modelSuggest = undefined;

        modelSetting.controlEl.addClass('ai-providers-model-control');
        const inputWrapper = modelSetting.controlEl.createDiv(
            'ai-providers-model-input'
        );

        if (Platform.isMobileApp) {
            const selectEl = inputWrapper.createEl(
                'select'
            ) as HTMLSelectElement;
            selectEl.setAttribute('data-testid', 'model-select');
            selectEl.disabled = isDisabled;

            const placeholderOption = selectEl.createEl('option', {
                text: placeholder,
            }) as HTMLOptionElement;
            placeholderOption.value = '';
            const currentModel = this.provider.model || '';
            const optionValues = currentModel
                ? [currentModel, ...models]
                : models;
            Array.from(new Set(optionValues)).forEach(model => {
                const option = selectEl.createEl('option', {
                    text: model,
                }) as HTMLOptionElement;
                option.value = model;
            });

            selectEl.value = currentModel;
            selectEl.addEventListener('change', event => {
                this.provider.model = (event.target as HTMLSelectElement).value;
            });
            return;
        }

        const input = new TextComponent(inputWrapper);

        input.setPlaceholder(placeholder);
        input.setValue(this.provider.model || '');
        input.setDisabled(isDisabled);
        input.onChange(value => {
            this.provider.model = value;
            input.inputEl.title = value;
        });

        input.inputEl.setAttribute('data-testid', 'model-combobox-input');
        input.inputEl.setAttribute('role', 'combobox');
        input.inputEl.setAttribute('aria-autocomplete', 'list');
        input.inputEl.title = this.provider.model || '';

        if (isDisabled) {
            return;
        }

        this.modelSuggest = new ModelSuggest(this.app, input.inputEl, {
            models,
            onSelect: value => {
                this.provider.model = value;
                input.setValue(value);
                input.inputEl.title = value;
            },
        });
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
