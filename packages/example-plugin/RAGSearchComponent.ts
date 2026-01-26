import { App, Setting, TFile, Notice } from 'obsidian';
import {
    IAIProvidersService,
    IAIProvider,
    IAIProvidersRetrievalResult,
} from '@obsidian-ai-providers/sdk';

export class RAGSearchComponent {
    private selectedFiles = new Set<string>();
    private searchQuery = '';

    constructor(private app: App) {}

    render(
        containerEl: HTMLElement,
        aiProviders: IAIProvidersService,
        provider: IAIProvider
    ): void {
        containerEl.createEl('h3', { text: '🔍 RAG Search Demo' });
        containerEl
            .createEl('p', {
                text: 'Search through your vault files using AI embeddings.',
            })
            .addClass('mod-muted');

        this.renderFileSelection(containerEl);
        this.renderSearchInput(containerEl);
        this.renderSearchButton(containerEl, aiProviders, provider);
    }

    private renderFileSelection(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('📁 Select files')
            .setDesc('Choose files to search');

        const container = containerEl.createEl('div');
        container.addClass('rag-file-selection');
        const files = this.app.vault.getMarkdownFiles();

        if (!files.length) {
            const noFiles = container.createEl('p', {
                text: 'No markdown files found.',
            });
            noFiles.addClass('mod-muted');
            return;
        }

        const controls = container.createEl('div');
        controls.addClass('rag-file-controls');
        const selectAll = controls.createEl('button', { text: 'Select All' });
        selectAll.addClass('mod-cta');
        const clearAll = controls.createEl('button', { text: 'Clear All' });

        selectAll.onclick = () => this.toggleAllFiles(files, true, container);
        clearAll.onclick = () => this.toggleAllFiles(files, false, container);

        const filesList = container.createEl('div');
        filesList.addClass('rag-files-list');
        files.forEach(file => this.createFileCheckbox(filesList, file));
        const containerWithList = container as HTMLElement & {
            _filesList?: HTMLElement;
        };
        containerWithList._filesList = filesList;
    }

    private createFileCheckbox(parent: HTMLElement, file: TFile): void {
        const label = parent.createEl('label');
        label.addClass('rag-file-item');
        const checkbox = label.createEl('input') as HTMLInputElement;
        checkbox.type = 'checkbox';
        checkbox.checked = this.selectedFiles.has(file.path);
        checkbox.onchange = () => this.toggleFile(file.path, checkbox.checked);

        label.createEl('span', { text: file.path });
    }

    private toggleFile(path: string, selected: boolean): void {
        selected
            ? this.selectedFiles.add(path)
            : this.selectedFiles.delete(path);
    }

    private toggleAllFiles(
        files: TFile[],
        selectAll: boolean,
        container: HTMLElement
    ): void {
        files.forEach(file => this.toggleFile(file.path, selectAll));
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(
            cb => ((cb as unknown as HTMLInputElement).checked = selectAll)
        );
    }

    private renderSearchInput(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('🔎 Search query').addText(text => {
            text.setPlaceholder('e.g., "machine learning concepts"');
            text.setValue(this.searchQuery);
            text.onChange(value => (this.searchQuery = value));
            text.inputEl.style.width = '100%';
        });
    }

    private renderSearchButton(
        containerEl: HTMLElement,
        aiProviders: IAIProvidersService,
        provider: IAIProvider
    ): void {
        new Setting(containerEl).setName('🚀 Search').addButton(button => {
            button.setButtonText('Search Documents').setCta();
            button.onClick(() =>
                this.performSearch(
                    containerEl,
                    aiProviders,
                    provider,
                    button.buttonEl
                )
            );
        });

        const resultsDiv = containerEl.createEl('div');
        resultsDiv.addClass('rag-results-container');
    }

    private async performSearch(
        containerEl: HTMLElement,
        aiProviders: IAIProvidersService,
        provider: IAIProvider,
        buttonEl: HTMLButtonElement
    ): Promise<void> {
        if (!this.selectedFiles.size) {
            new Notice('Select at least one file');
            return;
        }
        if (!this.searchQuery.trim()) {
            new Notice('Enter a search query');
            return;
        }

        const originalText = buttonEl.textContent;
        buttonEl.textContent = 'Searching...';
        buttonEl.disabled = true;

        const resultsContainer = containerEl.querySelector(
            '.rag-results-container'
        );
        if (!(resultsContainer instanceof HTMLElement)) {
            throw new Error('Results container not found');
        }
        resultsContainer.empty();

        // Create progress display element
        const progressEl = resultsContainer.createEl('div');
        progressEl.addClass('rag-progress');
        progressEl.createEl('h4', { text: '📊 Processing Progress' });
        const progressText = progressEl.createEl('p', {
            text: 'Initializing...',
        });
        progressText.addClass('mod-muted');

        try {
            const documents = await Promise.all(
                Array.from(this.selectedFiles).map(async path => {
                    const file = this.app.vault.getAbstractFileByPath(
                        path
                    ) as TFile;
                    const content = await this.app.vault.read(file);
                    return {
                        content,
                        meta: { fileName: file.name, filePath: file.path },
                    };
                })
            );

            // 🎯 Retrieve with progress tracking!
            const results = await aiProviders.retrieve({
                query: this.searchQuery,
                documents,
                embeddingProvider: provider,
                onProgress: ({
                    processedChunks,
                    processedDocuments,
                    totalDocuments,
                    totalChunks,
                    processingType,
                }) => {
                    const docsProgress = `${processedDocuments.length}/${totalDocuments}`;
                    const chunksProgress = `${processedChunks.length}/${totalChunks}`;
                    progressText.setText(
                        `${processingType}: Documents ${docsProgress} • Chunks ${chunksProgress}`
                    );
                },
            });

            // Remove progress display when done
            progressEl.remove();

            this.displayResults(resultsContainer, results);
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            const errorDiv = resultsContainer.createEl('div');
            errorDiv.addClass('callout');
            errorDiv.addClass('callout-error');
            errorDiv.createEl('p', {
                text: `Search failed: ${errorMessage}`,
            });
        } finally {
            buttonEl.textContent = originalText;
            buttonEl.disabled = false;
        }
    }

    private displayResults(
        container: HTMLElement,
        results: IAIProvidersRetrievalResult[]
    ): void {
        if (!results.length) {
            const noResults = container.createEl('div');
            noResults.addClass('callout');
            noResults.addClass('callout-info');
            noResults.createEl('div', { text: '💡' });
            noResults.createEl('p', {
                text: 'No relevant content found. Try different keywords.',
            });
            return;
        }

        const summary = container.createEl('div');
        summary.addClass('rag-results-summary');
        const uniqueFiles = new Set(
            results.map(result => result.document.meta?.fileName)
        ).size;
        const avgScore =
            results.reduce((sum, result) => sum + result.score, 0) /
            results.length;

        summary.createEl('h4', { text: `🎯 Found ${results.length} chunks` });
        const summaryP = summary.createEl('p', {
            text: `From ${uniqueFiles} files • ${(avgScore * 100).toFixed(1)}% avg`,
        });
        summaryP.addClass('mod-muted');

        this.groupByFile(results).forEach(([fileName, chunks]) =>
            this.renderFileCard(container, fileName, chunks)
        );
    }

    private groupByFile(
        results: IAIProvidersRetrievalResult[]
    ): [string, IAIProvidersRetrievalResult[]][] {
        const grouped = new Map<string, IAIProvidersRetrievalResult[]>();
        results.forEach(result => {
            const fileName = result.document.meta?.fileName || 'Unknown';
            const existing = grouped.get(fileName);
            if (existing) {
                existing.push(result);
                return;
            }
            grouped.set(fileName, [result]);
        });
        return Array.from(grouped.entries()).sort(
            ([, a], [, b]) =>
                Math.max(...b.map(c => c.score)) -
                Math.max(...a.map(c => c.score))
        );
    }

    private renderFileCard(
        container: HTMLElement,
        fileName: string,
        chunks: IAIProvidersRetrievalResult[]
    ): void {
        const card = container.createEl('div');
        card.addClass('rag-file-card');
        const header = card.createEl('div');
        header.addClass('rag-file-header');

        const title = header.createEl('div');
        title.addClass('rag-file-title');
        title.createEl('span', { text: '📄' });
        title.createEl('strong', { text: fileName });

        const bestScore = Math.max(...chunks.map(c => c.score));
        const metaEl = header.createEl('div', {
            text: `${chunks.length} chunks • ${(bestScore * 100).toFixed(1)}%`,
        });
        metaEl.addClass('rag-file-meta');

        chunks
            .sort((a, b) => b.score - a.score)
            .forEach(chunk => {
                const chunkEl = card.createEl('div');
                chunkEl.addClass('rag-chunk');

                const scoreEl = chunkEl.createEl('div');
                scoreEl.addClass('rag-score-badge');
                const score = chunk.score;
                const [cls, emoji] =
                    score >= 0.8
                        ? ['high', '🟢']
                        : score >= 0.6
                          ? ['medium', '🟡']
                          : ['low', '🔴'];
                scoreEl.className += ` score-${cls}`;
                scoreEl.innerHTML = `${emoji} ${(score * 100).toFixed(1)}%`;

                const contentEl = chunkEl.createEl('div');
                contentEl.addClass('rag-chunk-content');
                contentEl.createEl('p', { text: chunk.content });
            });
    }

    getState() {
        return {
            selectedFiles: new Set(this.selectedFiles),
            searchQuery: this.searchQuery,
        };
    }
    setState(selectedFiles: Set<string>, searchQuery: string) {
        this.selectedFiles = new Set(selectedFiles);
        this.searchQuery = searchQuery;
    }
}
