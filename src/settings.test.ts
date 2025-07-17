import { App } from 'obsidian';
import { AIProvidersSettingTab, DEFAULT_SETTINGS } from './settings';
import AIProvidersPlugin from './main';
import { ConfirmationModal } from './modals/ConfirmationModal';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
import { OpenAIHandler } from './handlers/OpenAIHandler';
import { OllamaHandler } from './handlers/OllamaHandler';
import { AIProvidersService } from './AIProvidersService';
import { ProviderFormModal } from './modals/ProviderFormModal';

// Mock translations
jest.mock('./i18n', () => ({
    I18n: {
        t: (key: string, params?: any) => {
            if (key === 'settings.notice') {
                return "This plugin is a configuration hub for AI providers. It doesn't do anything on its own, but other plugins can use it to avoid configuring AI settings repeatedly.";
            }
            if (key === 'settings.duplicate') {
                return 'Duplicate';
            }
            if (key === 'settings.deleteConfirmation') {
                return `Are you sure you want to delete ${params?.name}?`;
            }
            return key;
        },
    },
}));

// Mock the modal window
jest.mock('./modals/ConfirmationModal', () => {
    return {
        ConfirmationModal: jest
            .fn()
            .mockImplementation((app, message, onConfirm) => {
                return {
                    app,
                    message,
                    onConfirm,
                    contentEl: document.createElement('div'),
                    open: jest.fn(),
                    close: jest.fn(),
                };
            }),
    };
});

jest.mock('./modals/ProviderFormModal', () => ({
    ProviderFormModal: jest.fn().mockImplementation(() => ({
        open: jest.fn(),
    })),
}));

// Mock handlers with common implementation
const mockHandlerImplementation = {
    fetchModels: jest.fn().mockResolvedValue(['model-1', 'model-2']),
    execute: jest.fn().mockResolvedValue({
        onData: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        abort: jest.fn(),
    }),
};

jest.mock('./handlers/OpenAIHandler', () => ({
    OpenAIHandler: jest
        .fn()
        .mockImplementation(() => mockHandlerImplementation),
}));

jest.mock('./handlers/OllamaHandler', () => ({
    OllamaHandler: jest
        .fn()
        .mockImplementation(() => mockHandlerImplementation),
}));

// Mock AIProvidersService
jest.mock('./AIProvidersService', () => {
    return {
        AIProvidersService: jest.fn().mockImplementation((_app, settings) => ({
            providers: settings?.providers || [],
            version: 1,
            handlers: {
                openai: new OpenAIHandler(settings),
                ollama: new OllamaHandler(settings),
                gemini: new OpenAIHandler(settings),
            },
            embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
            fetchModels: jest
                .fn()
                .mockResolvedValue(['gpt-4', 'gpt-3.5-turbo']),
            execute: jest.fn().mockResolvedValue({
                onData: jest.fn(),
                onEnd: jest.fn(),
                onError: jest.fn(),
                abort: jest.fn(),
            }),
            checkCompatibility: jest.fn(),
        })),
    };
});

// Test helpers
const createTestProvider = (
    overrides: Partial<IAIProvider> = {}
): IAIProvider => ({
    id: 'test-id-1',
    name: 'Test Provider',
    apiKey: 'test-key',
    url: 'https://test.com',
    type: 'openai',
    model: 'gpt-4',
    ...overrides,
});

const createTestSetup = () => {
    const app = new App();
    const plugin = new AIProvidersPlugin(app, {
        id: 'test-plugin',
        name: 'Test Plugin',
        author: 'Test Author',
        version: '1.0.0',
        minAppVersion: '0.0.1',
        description: 'Test Description',
    });
    plugin.settings = {
        ...DEFAULT_SETTINGS,
        providers: [],
    };
    plugin.saveSettings = jest.fn().mockResolvedValue(undefined);
    plugin.aiProviders = new AIProvidersService(app, plugin);

    const settingTab = new AIProvidersSettingTab(app, plugin);
    const containerEl = document.createElement('div');

    // Mock HTMLElement methods
    containerEl.createDiv = function (className?: string): HTMLElement {
        const div = document.createElement('div');
        if (className) {
            div.className = className;
        }
        this.appendChild(div as unknown as Node);
        return div;
    };
    containerEl.empty = function (): void {
        while (this.firstChild) {
            this.removeChild(this.firstChild);
        }
    };
    containerEl.createEl = function (
        tag: string,
        attrs?: { text?: string }
    ): HTMLElement {
        const el = document.createElement(tag);
        if (attrs?.text) {
            el.textContent = attrs.text;
        }
        this.appendChild(el as unknown as Node);
        return el;
    };

    // @ts-ignore
    settingTab.containerEl = containerEl;

    return { app, plugin, settingTab, containerEl };
};

describe('AIProvidersSettingTab', () => {
    let plugin: AIProvidersPlugin;
    let settingTab: AIProvidersSettingTab;
    let containerEl: HTMLElement;

    beforeEach(() => {
        const setup = createTestSetup();
        plugin = setup.plugin;
        settingTab = setup.settingTab;
        containerEl = setup.containerEl;
    });

    it('should render main interface', () => {
        settingTab.display();

        const mainInterface = containerEl.querySelector(
            '[data-testid="main-interface"]'
        );
        expect(mainInterface).toBeTruthy();
        expect(
            mainInterface?.querySelector('[data-testid="add-provider-button"]')
        ).toBeTruthy();
    });

    it('should display notice section', () => {
        settingTab.display();

        const notice = containerEl.querySelector(
            '.ai-providers-notice-content'
        );
        expect(notice).toBeTruthy();
        expect(notice?.textContent).toBe(
            "This plugin is a configuration hub for AI providers. It doesn't do anything on its own, but other plugins can use it to avoid configuring AI settings repeatedly."
        );
    });

    it('should display configured providers section', () => {
        const testProvider = createTestProvider();
        plugin.settings.providers = [testProvider];
        settingTab.display();

        const providers = containerEl.querySelectorAll('.setting-item');
        expect(providers.length).toBeGreaterThan(1); // Including header
        expect(
            Array.from(providers).some(p =>
                p.textContent?.includes(testProvider.name)
            )
        ).toBe(true);
    });

    it('should open provider form when add button is clicked', () => {
        settingTab.display();
        const addButton = containerEl.querySelector(
            '[data-testid="add-provider-button"]'
        );
        addButton?.dispatchEvent(new MouseEvent('click'));

        expect(ProviderFormModal).toHaveBeenCalled();
        expect(ProviderFormModal).toHaveBeenCalledWith(
            expect.any(App),
            plugin,
            expect.objectContaining({ type: 'openai' }),
            expect.any(Function),
            true
        );
    });

    it('should open edit form when edit button is clicked', () => {
        const testProvider = createTestProvider();
        plugin.settings.providers = [testProvider];
        settingTab.display();

        const editButton = containerEl.querySelector(
            '[data-testid="edit-provider"]'
        );
        editButton?.dispatchEvent(new MouseEvent('click'));

        expect(ProviderFormModal).toHaveBeenCalled();
        expect(ProviderFormModal).toHaveBeenCalledWith(
            expect.any(App),
            plugin,
            testProvider,
            expect.any(Function),
            false
        );
    });

    it('should show confirmation modal when deleting provider', () => {
        plugin.settings.providers = [createTestProvider()];
        settingTab.display();

        const deleteButton = containerEl.querySelector(
            '[data-testid="delete-provider"]'
        );
        deleteButton?.dispatchEvent(new MouseEvent('click'));

        expect(ConfirmationModal).toHaveBeenCalled();
    });

    it('should duplicate provider', async () => {
        plugin.settings.providers = [createTestProvider()];
        settingTab.display();

        const duplicateButton = containerEl.querySelector(
            '[data-testid="duplicate-provider"]'
        );
        duplicateButton?.dispatchEvent(new MouseEvent('click'));

        expect(plugin.settings.providers.length).toBe(2);
        expect(plugin.settings.providers[1].name).toContain('Duplicate');
        expect(plugin.saveSettings).toHaveBeenCalled();
    });
});
