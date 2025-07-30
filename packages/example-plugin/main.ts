import { App, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { initAI, waitForAI } from '@obsidian-ai-providers/sdk';
import { RAGSearchComponent } from './RAGSearchComponent';

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
    selectedFile: string;
    private ragSearchComponent: RAGSearchComponent;

    constructor(app: App, plugin: AIProvidersExamplePlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.ragSearchComponent = new RAGSearchComponent(app);
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

        // Provider selection
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

            // Text generation section
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

            // Embeddings section
            containerEl.createEl('h3', { text: 'Embeddings' });

            // Get all markdown files from the vault
            const files = this.app.vault.getMarkdownFiles();
            const fileOptions = files.reduce(
                (acc: Record<string, string>, file: TFile) => ({
                    ...acc,
                    [file.path]: file.name,
                }),
                {
                    '': 'Select a file...',
                }
            );

            // File selection dropdown
            new Setting(containerEl)
                .setName('Select file to embed')
                .addDropdown(dropdown =>
                    dropdown
                        .addOptions(fileOptions)
                        .setValue(this.selectedFile)
                        .onChange(async value => {
                            this.selectedFile = value;
                            await this.display();
                        })
                );

            if (this.selectedFile) {
                // Embed file button
                new Setting(containerEl)
                    .setName('Embed selected file')
                    .addButton(button =>
                        button
                            .setButtonText('Generate Embeddings')
                            .onClick(async () => {
                                button.setDisabled(true);
                                const resultEl = containerEl.createEl('div');

                                try {
                                    // Get file content
                                    const file =
                                        this.app.vault.getAbstractFileByPath(
                                            this.selectedFile
                                        );
                                    if (!(file instanceof TFile)) {
                                        throw new Error('File not found');
                                    }

                                    const content =
                                        await this.app.vault.read(file);

                                    // Show file info
                                    resultEl.createEl('p', {
                                        text: `File: ${file.name} (${content.length} characters)`,
                                    });

                                    // Generate embeddings
                                    const embeddings = await aiProviders.embed({
                                        provider,
                                        input: content,
                                    });

                                    // Show embedding result
                                    const embeddingInfo =
                                        containerEl.createEl('div');
                                    embeddingInfo.createEl('p', {
                                        text: `Generated ${embeddings.length} embedding vector(s)`,
                                    });
                                    embeddingInfo.createEl('p', {
                                        text: `Vector dimension: ${embeddings[0]?.length || 0}`,
                                    });
                                    embeddingInfo.createEl('p', {
                                        text: `First 5 values: [${embeddings[0]
                                            ?.slice(0, 5)
                                            .map(v => v.toFixed(4))
                                            .join(', ')}...]`,
                                    });

                                    console.log(
                                        'Generated embeddings:',
                                        embeddings
                                    );
                                } catch (error) {
                                    const errorEl = resultEl.createEl('p', {
                                        text: `Error: ${error.message}`,
                                    });
                                    errorEl.addClass('mod-warning');
                                } finally {
                                    button.setDisabled(false);
                                }
                            })
                    );
            }

            // RAG Retrieval section - using component
            this.ragSearchComponent.render(containerEl, aiProviders, provider);
        }
    }
}
