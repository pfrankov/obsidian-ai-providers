import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { initAI, waitForAI } from '@obsidian-ai-providers/sdk';

interface AIProvidersExampleSettings {
    mySetting: string;
}

export default class AIProvidersExamplePlugin extends Plugin {
    settings: AIProvidersExampleSettings;

    async onload() {
        initAI(this.app, this, async () => {
            this.addSettingTab(new SampleSettingTab(this.app, this));
        });
    }
}

class SampleSettingTab extends PluginSettingTab {
    plugin: AIProvidersExamplePlugin;
    selectedProvider: string;

    constructor(app: App, plugin: AIProvidersExamplePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async display(): Promise<void> {
        const { containerEl } = this;

        containerEl.empty();

        const aiResolver = await waitForAI();
        const aiProviders = await aiResolver.promise;

        const providers = aiProviders.providers.reduce(
            (
                acc: Record<string, string>,
                provider: { id: string; name: string; model?: string }
            ) => ({
                ...acc,
                [provider.id]: provider.model
                    ? [provider.name, provider.model].join(' ~ ')
                    : provider.name,
            }),
            {
                '': '',
            }
        );

        if (Object.keys(providers).length === 1) {
            new Setting(containerEl)
                .setName('AI Providers')
                .setDesc(
                    'No AI providers found. Please install an AI provider.'
                );

            return;
        }
        new Setting(containerEl)
            .setName('Select AI Provider')
            .setClass('ai-providers-select')
            .addDropdown(dropdown =>
                dropdown
                    .addOptions(providers)
                    .setValue(this.selectedProvider)
                    .onChange(async value => {
                        this.selectedProvider = value;
                        await this.display();
                    })
            );

        if (this.selectedProvider) {
            const provider = aiProviders.providers.find(
                provider => provider.id === this.selectedProvider
            );
            if (!provider) {
                return;
            }

            new Setting(containerEl)
                .setName('Execute test prompt')
                .addButton(button =>
                    button.setButtonText('Execute').onClick(async () => {
                        button.setDisabled(true);
                        const paragraph = containerEl.createEl('p');

                        const chunkHandler = await aiProviders.execute({
                            provider,
                            prompt: 'What is the capital of Great Britain?',
                        });
                        chunkHandler.onData((chunk, accumulatedText) => {
                            paragraph.setText(accumulatedText);
                        });
                        chunkHandler.onEnd(fullText => {
                            console.log(fullText);
                        });
                        chunkHandler.onError(error => {
                            paragraph.setText(error.message);
                        });
                        button.setDisabled(false);
                    })
                );
        }
    }
}
