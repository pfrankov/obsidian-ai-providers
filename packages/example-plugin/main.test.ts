import { App, Plugin, PluginSettingTab } from 'obsidian';
import AIProvidersExamplePlugin from './main';
import { initAI, waitForAI } from '@obsidian-ai-providers/sdk';
import manifest from './manifest.json';

// Mock AI integration
jest.mock('@obsidian-ai-providers/sdk', () => ({
    initAI: jest.fn((app, plugin, callback) => callback()),
    waitForAI: jest.fn(),
}));

// Mock Obsidian components that aren't available in test environment
jest.mock('obsidian', () => {
    const originalModule = jest.requireActual('obsidian');
    return {
        ...originalModule,
        Modal: class MockModal {
            constructor() {}
            open() {}
            close() {}
        },
    };
});

jest.mock('./RAGSearchComponent', () => ({
    RAGSearchComponent: class {
        render(containerEl: any) {
            containerEl.createEl('h3', { text: '🔍 RAG Search Demo' });
        }
        getState() {
            return { selectedFiles: new Set(), searchQuery: '' };
        }
        setState() {}
    },
}));

// Mock utilities
const createMockProvider = (id: string, name: string, model?: string) => ({
    id,
    name,
    ...(model ? { model } : {}),
});

const createMockAIResolver = (
    providers: any[] = [],
    execute = jest.fn(),
    embed = jest.fn(),
    retrieve = jest.fn()
) => ({
    promise: Promise.resolve({
        providers,
        execute,
        embed,
        retrieve,
    }),
});

describe('AIProvidersExamplePlugin', () => {
    let app: App;
    let plugin: AIProvidersExamplePlugin;
    let settingsTab: PluginSettingTab;

    beforeEach(() => {
        app = new App();
        plugin = new AIProvidersExamplePlugin(app, manifest);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should initialize plugin correctly', () => {
        expect(plugin).toBeInstanceOf(Plugin);
        expect(plugin.app).toBe(app);
    });

    it('should load plugin and initialize AI', async () => {
        await plugin.onload();
        expect(initAI).toHaveBeenCalledWith(app, plugin, expect.any(Function));
        expect((plugin as any).settingTabs.length).toBe(1);
    });

    describe('initAI functionality', () => {
        it('should call initAI with callback function', async () => {
            const mockCallback = jest.fn();
            await initAI(app, plugin, mockCallback);

            expect(initAI).toHaveBeenCalledWith(app, plugin, mockCallback);
            expect(mockCallback).toHaveBeenCalled();
        });

        it('should support options parameter', async () => {
            const mockCallback = jest.fn();
            const options = { disableFallback: true };

            await initAI(app, plugin, mockCallback, options);

            expect(initAI).toHaveBeenCalledWith(
                app,
                plugin,
                mockCallback,
                options
            );
            expect(mockCallback).toHaveBeenCalled();
        });
    });

    describe('SampleSettingTab', () => {
        beforeEach(async () => {
            await plugin.onload();
            settingsTab = (plugin as any).settingTabs[0];
        });

        it('should display settings with no providers', async () => {
            (waitForAI as jest.Mock).mockResolvedValueOnce(
                createMockAIResolver([])
            );

            await settingsTab.display();

            const setting =
                settingsTab.containerEl.querySelector('.setting-item');
            expect(setting).toBeTruthy();

            const settingName = setting?.querySelector('.setting-item-name');
            const settingDesc = setting?.querySelector(
                '.setting-item-description'
            );

            expect(settingName?.textContent).toBe('AI Providers');
            expect(settingDesc?.textContent).toBe(
                'No AI providers found. Please install an AI provider.'
            );
        });

        it('should display provider selection dropdown when providers exist', async () => {
            const mockProviders = [
                createMockProvider('provider1', 'Provider 1'),
                createMockProvider('provider2', 'Provider 2', 'Model X'),
            ];

            (waitForAI as jest.Mock).mockResolvedValueOnce(
                createMockAIResolver(mockProviders)
            );

            await settingsTab.display();

            const setting =
                settingsTab.containerEl.querySelector('.setting-item');
            expect(setting).toBeTruthy();

            const settingName = setting?.querySelector('.setting-item-name');
            expect(settingName?.textContent).toBe('Select AI Provider');

            const dropdown = setting?.querySelector('select');
            expect(dropdown).toBeTruthy();

            // Check dropdown options
            const options = dropdown?.querySelectorAll('option');
            expect(options?.length).toBe(3); // Empty option + 2 providers
            expect(options?.[1].value).toBe('provider1');
            expect(options?.[1].text).toBe('Provider 1');
            expect(options?.[2].value).toBe('provider2');
            expect(options?.[2].text).toBe('Provider 2 ~ Model X');
        });

        it('should show execute button when provider is selected', async () => {
            const mockProvider = createMockProvider('provider1', 'Provider 1');
            const mockExecute = jest.fn().mockResolvedValue('London');

            (waitForAI as jest.Mock).mockResolvedValueOnce(
                createMockAIResolver([mockProvider], mockExecute)
            );

            // Set selected provider
            (settingsTab as any).selectedProvider = 'provider1';

            await settingsTab.display();

            const executeButton =
                settingsTab.containerEl.querySelector('button');
            expect(executeButton).toBeTruthy();
            expect(executeButton?.textContent).toBe('Execute');
        });

        it('should handle AI execution correctly (stream API)', async () => {
            const mockProvider = createMockProvider('provider1', 'Provider 1');
            const mockExecute = jest.fn().mockResolvedValue('London');

            (waitForAI as jest.Mock).mockResolvedValueOnce(
                createMockAIResolver([mockProvider], mockExecute)
            );

            (settingsTab as any).selectedProvider = 'provider1';

            await settingsTab.display();

            const executeButton =
                settingsTab.containerEl.querySelector('button');
            expect(executeButton).toBeTruthy();

            // Click execute button
            executeButton?.click();

            expect(mockExecute).toHaveBeenCalledTimes(1);
            const callArg = mockExecute.mock.calls[0][0];
            expect(callArg.provider).toBe(mockProvider);
            expect(callArg.prompt).toBe(
                'What is the capital of Great Britain?'
            );
            expect(typeof callArg.onProgress).toBe('function');
            expect(callArg.onEnd).toBeUndefined();
            expect(callArg.onError).toBeUndefined();
            // abortController is optional but we demonstrate passing it
            expect(callArg.abortController).toBeInstanceOf(AbortController);
        });

        it('should clear container before displaying settings', async () => {
            (waitForAI as jest.Mock).mockResolvedValueOnce(
                createMockAIResolver([])
            );

            // Add some content to container
            settingsTab.containerEl.createEl('div', { text: 'Test content' });

            await settingsTab.display();

            // Check if old content was removed
            expect(settingsTab.containerEl.childNodes.length).toBe(1);
        });

        it('should display embeddings section when provider is selected', async () => {
            const mockProvider = createMockProvider('provider1', 'Provider 1');

            (waitForAI as jest.Mock).mockResolvedValueOnce(
                createMockAIResolver([mockProvider])
            );

            (settingsTab as any).selectedProvider = 'provider1';

            await settingsTab.display();

            // Check for embeddings heading
            const embeddingsHeading =
                settingsTab.containerEl.querySelector('h3');
            expect(embeddingsHeading).toBeTruthy();
            expect(embeddingsHeading?.textContent).toBe('Embeddings');

            // Check for file selection dropdown
            const fileDropdown =
                settingsTab.containerEl.querySelectorAll('select')[1]; // Second dropdown
            expect(fileDropdown).toBeTruthy();

            // Check dropdown options (should have empty option + 3 mock files)
            const options = fileDropdown?.querySelectorAll('option');
            expect(options?.length).toBe(4); // Empty option + 3 files
            expect(options?.[0].text).toBe('Select a file...');
            expect(options?.[1].text).toBe('Note 1');
            expect(options?.[2].text).toBe('Note 2');
            expect(options?.[3].text).toBe('Note 3');
        });

        it('should show generate embeddings button when file is selected', async () => {
            const mockProvider = createMockProvider('provider1', 'Provider 1');

            (waitForAI as jest.Mock).mockResolvedValueOnce(
                createMockAIResolver([mockProvider])
            );

            (settingsTab as any).selectedProvider = 'provider1';
            (settingsTab as any).selectedFile = 'note1.md';

            await settingsTab.display();

            // Check for generate embeddings button
            const buttons = settingsTab.containerEl.querySelectorAll('button');
            const generateButton = Array.from(buttons).find(
                btn => btn.textContent === 'Generate Embeddings'
            );
            expect(generateButton).toBeTruthy();
        });

        it('should handle embeddings generation correctly', async () => {
            const mockProvider = createMockProvider('provider1', 'Provider 1');
            const mockEmbed = jest
                .fn()
                .mockResolvedValue([[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]]);

            (waitForAI as jest.Mock).mockResolvedValueOnce(
                createMockAIResolver([mockProvider], jest.fn(), mockEmbed)
            );

            (settingsTab as any).selectedProvider = 'provider1';
            (settingsTab as any).selectedFile = 'note1.md';

            await settingsTab.display();

            // Click generate embeddings button
            const buttons = settingsTab.containerEl.querySelectorAll('button');
            const generateButton = Array.from(buttons).find(
                btn => btn.textContent === 'Generate Embeddings'
            ) as HTMLButtonElement;

            expect(generateButton).toBeTruthy();
            generateButton?.click();

            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(mockEmbed).toHaveBeenCalledWith({
                provider: mockProvider,
                input: 'Mock content for Note 1',
            });
        });

        it('should display embedding results correctly', async () => {
            const mockProvider = createMockProvider('provider1', 'Provider 1');
            const mockEmbeddings = [[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]];
            const mockEmbed = jest.fn().mockResolvedValue(mockEmbeddings);

            (waitForAI as jest.Mock).mockResolvedValueOnce(
                createMockAIResolver([mockProvider], jest.fn(), mockEmbed)
            );

            (settingsTab as any).selectedProvider = 'provider1';
            (settingsTab as any).selectedFile = 'note1.md';

            await settingsTab.display();

            // Click generate embeddings button
            const buttons = settingsTab.containerEl.querySelectorAll('button');
            const generateButton = Array.from(buttons).find(
                btn => btn.textContent === 'Generate Embeddings'
            ) as HTMLButtonElement;

            generateButton?.click();

            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 0));

            // Check for file info
            const paragraphs = settingsTab.containerEl.querySelectorAll('p');
            const fileInfoP = Array.from(paragraphs).find(p =>
                p.textContent?.includes('File: Note 1')
            );
            expect(fileInfoP).toBeTruthy();
            expect(fileInfoP?.textContent).toContain('(23 characters)');

            // Check for embedding info
            const vectorsP = Array.from(paragraphs).find(p =>
                p.textContent?.includes('Generated 1 embedding vector(s)')
            );
            expect(vectorsP).toBeTruthy();

            const dimensionP = Array.from(paragraphs).find(p =>
                p.textContent?.includes('Vector dimension: 8')
            );
            expect(dimensionP).toBeTruthy();

            const valuesP = Array.from(paragraphs).find(p =>
                p.textContent?.includes('First 5 values:')
            );
            expect(valuesP).toBeTruthy();
            expect(valuesP?.textContent).toContain(
                '[0.1000, 0.2000, 0.3000, 0.4000, 0.5000...]'
            );
        });

        it('should handle embedding errors correctly', async () => {
            const mockProvider = createMockProvider('provider1', 'Provider 1');
            const mockEmbed = jest
                .fn()
                .mockRejectedValue(new Error('Embedding failed'));

            (waitForAI as jest.Mock).mockResolvedValueOnce(
                createMockAIResolver([mockProvider], jest.fn(), mockEmbed)
            );

            (settingsTab as any).selectedProvider = 'provider1';
            (settingsTab as any).selectedFile = 'note1.md';

            await settingsTab.display();

            // Click generate embeddings button
            const buttons = settingsTab.containerEl.querySelectorAll('button');
            const generateButton = Array.from(buttons).find(
                btn => btn.textContent === 'Generate Embeddings'
            ) as HTMLButtonElement;

            generateButton?.click();

            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 0));

            // Check for error message
            const paragraphs = settingsTab.containerEl.querySelectorAll('p');
            const errorP = Array.from(paragraphs).find(p =>
                p.textContent?.includes('Error: Embedding failed')
            );
            expect(errorP).toBeTruthy();
            expect(errorP?.classList.contains('mod-warning')).toBe(true);
        });

        it('should handle file not found error', async () => {
            const mockProvider = createMockProvider('provider1', 'Provider 1');

            (waitForAI as jest.Mock).mockResolvedValueOnce(
                createMockAIResolver([mockProvider])
            );

            (settingsTab as any).selectedProvider = 'provider1';
            (settingsTab as any).selectedFile = 'nonexistent.md';

            await settingsTab.display();

            // Click generate embeddings button
            const buttons = settingsTab.containerEl.querySelectorAll('button');
            const generateButton = Array.from(buttons).find(
                btn => btn.textContent === 'Generate Embeddings'
            ) as HTMLButtonElement;

            generateButton?.click();

            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 0));

            // Check for error message
            const paragraphs = settingsTab.containerEl.querySelectorAll('p');
            const errorP = Array.from(paragraphs).find(p =>
                p.textContent?.includes('Error: File not found')
            );
            expect(errorP).toBeTruthy();
            expect(errorP?.classList.contains('mod-warning')).toBe(true);
        });

        it('should display RAG search demo section when provider is selected', async () => {
            const mockProvider = createMockProvider('provider1', 'Provider 1');

            (waitForAI as jest.Mock).mockResolvedValueOnce(
                createMockAIResolver([mockProvider])
            );

            (settingsTab as any).selectedProvider = 'provider1';

            await settingsTab.display();

            // Check for RAG demo heading
            const ragHeading = Array.from(
                settingsTab.containerEl.querySelectorAll('h3')
            ).find(h3 => h3.textContent === '🔍 RAG Search Demo');
            expect(ragHeading).toBeTruthy();

            // Check that RAG component is rendered
            const ragComponent = (settingsTab as any).ragSearchComponent;
            expect(ragComponent).toBeTruthy();
        });
    });
});
