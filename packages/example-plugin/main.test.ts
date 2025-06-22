import { App, Plugin, PluginSettingTab } from 'obsidian';
import AIProvidersExamplePlugin from './main';
import { initAI, waitForAI } from '@obsidian-ai-providers/sdk';
import manifest from './manifest.json';

// Mock AI integration
jest.mock('@obsidian-ai-providers/sdk', () => ({
    initAI: jest.fn((app, plugin, callback) => callback()),
    waitForAI: jest.fn(),
}));

// Mock utilities
const createMockProvider = (id: string, name: string, model?: string) => ({
    id,
    name,
    ...(model ? { model } : {}),
});

const createMockChunkHandler = () => ({
    onData: jest.fn(),
    onEnd: jest.fn(),
    onError: jest.fn(),
});

const createMockAIResolver = (providers: any[] = [], execute = jest.fn()) => ({
    promise: Promise.resolve({
        providers,
        execute,
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
            const mockExecute = jest
                .fn()
                .mockResolvedValue(createMockChunkHandler());

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

        it('should handle AI execution correctly', async () => {
            const mockProvider = createMockProvider('provider1', 'Provider 1');
            const mockExecute = jest
                .fn()
                .mockResolvedValue(createMockChunkHandler());

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

            expect(mockExecute).toHaveBeenCalledWith({
                provider: mockProvider,
                prompt: 'What is the capital of Great Britain?',
            });
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
    });
});
