import { App } from 'obsidian';
import type { Mock } from 'vitest';
import { AIProvidersSettingTab, DEFAULT_SETTINGS } from './settings';
import AIProvidersPlugin from './main';
import { ConfirmationModal } from './modals/ConfirmationModal';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
import { OpenAIHandler } from './handlers/OpenAIHandler';
import { OllamaHandler } from './handlers/OllamaHandler';
import { AIProvidersService } from './AIProvidersService';
import { ProviderFormModal } from './modals/ProviderFormModal';

// Mock translations
vi.mock('./i18n', () => ({
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
vi.mock('./modals/ConfirmationModal', () => {
    return {
        ConfirmationModal: vi
            .fn()
            .mockImplementation((app, message, onConfirm) => {
                return {
                    app,
                    message,
                    onConfirm,
                    contentEl: document.createElement('div'),
                    open: vi.fn(),
                    close: vi.fn(),
                };
            }),
    };
});

vi.mock('./modals/ProviderFormModal', () => ({
    ProviderFormModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        close: vi.fn(),
    })),
}));

// Mock handlers with common implementation
const mockHandlerImplementation = {
    fetchModels: vi.fn().mockResolvedValue(['model-1', 'model-2']),
    execute: vi.fn().mockResolvedValue('result'),
};

vi.mock('./handlers/OpenAIHandler', () => ({
    OpenAIHandler: vi.fn().mockImplementation(() => mockHandlerImplementation),
}));

vi.mock('./handlers/OllamaHandler', () => ({
    OllamaHandler: vi.fn().mockImplementation(() => mockHandlerImplementation),
}));

// Mock AIProvidersService
vi.mock('./AIProvidersService', () => {
    return {
        AIProvidersService: vi.fn().mockImplementation((_app, settings) => ({
            providers: settings?.providers || [],
            version: 1,
            handlers: {
                openai: new OpenAIHandler(settings),
                ollama: new OllamaHandler(settings),
                gemini: new OpenAIHandler(settings),
            },
            embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
            fetchModels: vi.fn().mockResolvedValue(['gpt-4', 'gpt-3.5-turbo']),
            execute: vi.fn().mockResolvedValue('result'),
            checkCompatibility: vi.fn(),
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
    plugin.saveSettings = vi.fn().mockResolvedValue(undefined);
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
        vi.clearAllMocks();
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

    it('should validate provider and show error for missing name', async () => {
        const invalidProvider = createTestProvider({ name: '' });
        const result = (settingTab as any).validateProvider(invalidProvider);

        expect(result.isValid).toBe(false);
        expect(result.error).toBe('errors.providerNameRequired');
    });

    it('should validate provider and show error for duplicate name', async () => {
        const existingProvider = createTestProvider({
            name: 'Existing Provider',
        });
        plugin.settings.providers = [existingProvider];

        const duplicateProvider = createTestProvider({
            id: 'different-id',
            name: 'Existing Provider',
        });
        const result = (settingTab as any).validateProvider(duplicateProvider);

        expect(result.isValid).toBe(false);
        expect(result.error).toBe('errors.providerNameExists');
    });

    it('should validate provider successfully for valid provider', async () => {
        const validProvider = createTestProvider();
        const result = (settingTab as any).validateProvider(validProvider);

        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
    });

    it('saveProvider updates existing providers and closes modal', async () => {
        const existingProvider = createTestProvider();
        plugin.settings.providers = [existingProvider];
        const closeSpy = vi.fn();
        (settingTab as any).currentModal = { close: closeSpy };
        const displaySpy = vi.spyOn(settingTab, 'display');

        await (settingTab as any).saveProvider({
            ...existingProvider,
            name: 'Updated Provider',
        });

        expect(plugin.settings.providers[0].name).toBe('Updated Provider');
        expect(plugin.saveSettings).toHaveBeenCalled();
        expect(closeSpy).toHaveBeenCalled();
        expect(displaySpy).toHaveBeenCalled();
    });

    it('saveProvider initializes providers list when missing', async () => {
        plugin.settings.providers = undefined as any;

        await (settingTab as any).saveProvider(createTestProvider());

        expect(plugin.settings.providers?.length).toBe(1);
    });

    it('calls saveProvider from modal onSave and adds new provider', async () => {
        settingTab.display();

        const addButton = containerEl.querySelector(
            '[data-testid="add-provider-button"]'
        );
        addButton?.dispatchEvent(new MouseEvent('click'));

        const onSave = (ProviderFormModal as unknown as Mock).mock.calls[0][3];

        await onSave(createTestProvider());

        expect(plugin.settings.providers?.length).toBe(1);
        expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it('saveProvider shows notice when validation fails', async () => {
        const invalidProvider = createTestProvider({ name: '' });

        await (settingTab as any).saveProvider(invalidProvider);

        expect(plugin.settings.providers).toEqual([]);
        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('deleteProvider removes providers and refreshes display', async () => {
        const provider = createTestProvider();
        plugin.settings.providers = [provider];
        const displaySpy = vi.spyOn(settingTab, 'display');

        await (settingTab as any).deleteProvider(provider);

        expect(plugin.settings.providers).toEqual([]);
        expect(plugin.saveSettings).toHaveBeenCalled();
        expect(displaySpy).toHaveBeenCalled();
    });

    it('deleteProvider does nothing when providers are missing', async () => {
        plugin.settings.providers = undefined as any;
        await (settingTab as any).deleteProvider(createTestProvider());

        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('delete button confirmation triggers removal', async () => {
        const provider = createTestProvider();
        plugin.settings.providers = [provider];
        settingTab.display();

        const deleteButton = containerEl.querySelector(
            '[data-testid="delete-provider"]'
        );
        deleteButton?.dispatchEvent(new MouseEvent('click'));

        const modalInstance = (ConfirmationModal as unknown as Mock).mock
            .results[0].value;
        await modalInstance.onConfirm();

        expect(plugin.settings.providers).toEqual([]);
    });

    it('respects isFormOpen when adding providers', () => {
        (settingTab as any).isFormOpen = true;
        settingTab.display();

        const addButton = containerEl.querySelector(
            '[data-testid="add-provider-button"]'
        );
        addButton?.dispatchEvent(new MouseEvent('click'));

        expect(ProviderFormModal).not.toHaveBeenCalled();
    });

    it('prevents edit when form is already open', () => {
        (settingTab as any).isFormOpen = true;
        plugin.settings.providers = [createTestProvider()];
        settingTab.display();

        const editButton = containerEl.querySelector(
            '[data-testid="edit-provider"]'
        );
        editButton?.dispatchEvent(new MouseEvent('click'));

        expect(ProviderFormModal).not.toHaveBeenCalled();
    });

    it('toggles developer mode and renders developer settings', () => {
        settingTab.display();

        const toggle = containerEl.querySelector(
            'input[type="checkbox"]'
        ) as HTMLInputElement | null;
        expect(toggle).toBeTruthy();

        toggle!.checked = true;
        toggle!.dispatchEvent(new Event('change'));

        expect((settingTab as any).isDeveloperMode).toBe(true);
        expect(containerEl.textContent?.includes('settings.debugLogging')).toBe(
            true
        );
    });

    it('duplicateProvider initializes providers list when missing', async () => {
        plugin.settings.providers = undefined as any;
        await (settingTab as any).duplicateProvider(createTestProvider());

        expect(plugin.settings.providers?.length).toBe(1);
    });

    it('updates developer settings toggles', async () => {
        (settingTab as any).isDeveloperMode = true;
        settingTab.display();

        const toggles = Array.from(
            containerEl.querySelectorAll('input[type="checkbox"]'),
            el => el as unknown as HTMLInputElement
        );
        const debugToggle = toggles[1];
        const nativeFetchToggle = toggles[2];

        debugToggle.checked = true;
        debugToggle.dispatchEvent(new Event('change'));

        nativeFetchToggle.checked = true;
        nativeFetchToggle.dispatchEvent(new Event('change'));

        expect(plugin.settings.debugLogging).toBe(true);
        expect(plugin.settings.useNativeFetch).toBe(true);
        expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it('defaults developer toggles when settings are undefined', () => {
        plugin.settings.debugLogging = undefined;
        plugin.settings.useNativeFetch = undefined;
        (settingTab as any).isDeveloperMode = true;
        settingTab.display();

        const toggles = Array.from(
            containerEl.querySelectorAll('input[type="checkbox"]'),
            el => el as unknown as HTMLInputElement
        );

        expect(toggles[1].checked).toBe(false);
        expect(toggles[2].checked).toBe(false);
    });

    it('uses empty description when provider url is missing', () => {
        const provider = createTestProvider({ url: '' });
        plugin.settings.providers = [provider];
        settingTab.display();

        const descriptions = Array.from(
            containerEl.querySelectorAll('.setting-item-description')
        ).map(el => el.textContent);

        expect(descriptions).toContain('');
    });

    it('renders when providers list is undefined', () => {
        plugin.settings.providers = undefined as any;
        settingTab.display();

        const mainInterface = containerEl.querySelector(
            '[data-testid="main-interface"]'
        );
        expect(mainInterface).toBeTruthy();
    });
});
