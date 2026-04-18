import type { Mock } from 'vitest';
import { App, Platform } from 'obsidian';
import { ProviderFormModal } from './ProviderFormModal';
import AIProvidersPlugin from '../main';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
import { AIProvidersService } from '../AIProvidersService';
import { probeModelCapabilities } from '../utils/modelCapabilityChecker';

vi.mock('../i18n', () => ({
    I18n: {
        t: (key: string) => {
            return key;
        },
    },
}));

vi.mock('../utils/modelCapabilityChecker', () => ({
    probeModelCapabilities: vi.fn(),
}));

const getElement = <T extends HTMLElement>(
    container: HTMLElement,
    selector: string
): T => {
    const element = container.querySelector(selector);
    if (!element) throw new Error(`Element "${selector}" not found`);
    return element as unknown as T;
};

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

describe('ProviderFormModal', () => {
    let app: App;
    let plugin: AIProvidersPlugin;
    let modal: ProviderFormModal;
    let onSaveMock: Mock;
    let provider: IAIProvider;

    beforeEach(() => {
        (Platform as any).isMobileApp = false;
        app = new App();
        plugin = new AIProvidersPlugin(app, {
            id: 'test-plugin',
            name: 'Test Plugin',
            version: '1.0.0',
            minAppVersion: '0.15.0',
            author: 'Test Author',
            description: 'Test Description',
        });
        plugin.settings = {
            providers: [],
            _version: 1,
            debugLogging: false,
            useNativeFetch: false,
        };
        plugin.aiProviders = new AIProvidersService(app, plugin);

        provider = {
            id: 'test-id',
            name: 'Test Provider',
            type: 'openai',
            apiKey: 'test-key',
            url: 'https://test.com',
            model: 'gpt-4',
        };

        onSaveMock = vi.fn();
        modal = new ProviderFormModal(app, plugin, provider, onSaveMock, true);
    });

    afterEach(() => {
        (Platform as any).isMobileApp = false;
    });

    it('should render form elements correctly', () => {
        modal.onOpen();
        expect(
            modal.contentEl.querySelector('[data-testid="provider-form-title"]')
        ).toBeTruthy();
        expect(
            modal.contentEl.querySelector(
                '[data-testid="provider-type-dropdown"]'
            )
        ).toBeTruthy();
        expect(
            modal.contentEl.querySelector(
                '[data-testid="model-combobox-input"]'
            )
        ).toBeTruthy();
        expect(
            modal.contentEl.querySelector(
                '[data-testid="model-capability-text"]'
            )
        ).toBeTruthy();
    });

    it('shows capability placeholder when no model is selected', () => {
        provider.model = '';
        modal.onOpen();

        expect(modal.contentEl.textContent).not.toContain(
            'settings.modelCapabilities'
        );
        expect(
            modal.contentEl.querySelector(
                '[data-testid="check-model-capabilities"]'
            )
        ).toBeFalsy();
    });

    it('shows capabilities section after selecting a model from suggestions', async () => {
        provider.availableModels = ['gpt-4', 'gpt-3.5-turbo'];
        provider.model = 'gpt-4';
        modal.onOpen();

        // Capabilities section is visible for the initial model
        expect(
            modal.contentEl.querySelector(
                '[data-testid="check-model-capabilities"]'
            )
        ).toBeTruthy();

        // Clear the model text — capabilities should hide
        const input = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-combobox-input"]'
        );
        input.value = '';
        input.dispatchEvent(new Event('input'));
        await flushPromises();

        expect(
            modal.contentEl.querySelector(
                '[data-testid="check-model-capabilities"]'
            )
        ).toBeFalsy();

        // Select a model via suggestions (bypasses onChange)
        const suggest = (modal as any).modelSuggest;
        suggest.selectSuggestion('gpt-3.5-turbo', new MouseEvent('click'));
        await flushPromises();

        // Capabilities section should reappear
        expect(provider.model).toBe('gpt-3.5-turbo');
        expect(
            modal.contentEl.querySelector(
                '[data-testid="check-model-capabilities"]'
            )
        ).toBeTruthy();
    });

    it('returns default capabilities when no model is selected', () => {
        provider.model = '';

        expect((modal as any).getSelectedModelCapabilities()).toEqual({
            embedding: false,
            text: false,
            tools: false,
            vision: false,
        });
    });

    it('updates stored model capabilities from checkboxes', () => {
        modal.onOpen();

        const checkbox = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-capability-tools"]'
        );
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        expect(provider.modelCapabilities).toEqual({
            'gpt-4': {
                embedding: false,
                text: false,
                tools: true,
                vision: false,
            },
        });
    });

    it('persists model capabilities to plugin settings on checkbox toggle', async () => {
        plugin.settings.providers = [{ ...provider }];
        const saveSpy = vi
            .spyOn(plugin, 'saveSettings')
            .mockResolvedValue(undefined);

        modal.onOpen();

        const checkbox = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-capability-tools"]'
        );
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        await flushPromises();

        const saved = plugin.settings.providers.find(
            (p: IAIProvider) => p.id === provider.id
        );
        expect(saved?.modelCapabilities?.['gpt-4']).toEqual({
            embedding: false,
            text: false,
            tools: true,
            vision: false,
        });
        expect(saveSpy).toHaveBeenCalled();
    });

    it('persists model capabilities when provider had no modelCapabilities yet', async () => {
        provider.modelCapabilities = undefined;
        plugin.settings.providers = [{ ...provider }];
        const saveSpy = vi
            .spyOn(plugin, 'saveSettings')
            .mockResolvedValue(undefined);

        modal.onOpen();

        const checkbox = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-capability-vision"]'
        );
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        await flushPromises();

        const saved = plugin.settings.providers.find(
            (p: IAIProvider) => p.id === provider.id
        );
        expect(saved?.modelCapabilities?.['gpt-4']).toEqual({
            embedding: false,
            text: false,
            tools: false,
            vision: true,
        });
        expect(saveSpy).toHaveBeenCalled();
    });

    it('persists capabilities from Check button to plugin settings', async () => {
        plugin.settings.providers = [{ ...provider }];
        const saveSpy = vi
            .spyOn(plugin, 'saveSettings')
            .mockResolvedValue(undefined);

        (probeModelCapabilities as Mock).mockResolvedValue({
            embedding: true,
            text: true,
            tools: false,
            vision: true,
        });

        modal.onOpen();

        const button = getElement<HTMLButtonElement>(
            modal.contentEl,
            '[data-testid="check-model-capabilities"]'
        );
        button.click();
        await flushPromises();

        const saved = plugin.settings.providers.find(
            (p: IAIProvider) => p.id === provider.id
        );
        expect(saved?.modelCapabilities?.['gpt-4']).toEqual({
            embedding: true,
            text: true,
            tools: false,
            vision: true,
        });
        expect(saveSpy).toHaveBeenCalled();
    });

    it('adds localized aria-label to Check button without title', () => {
        modal.onOpen();

        const button = getElement<HTMLButtonElement>(
            modal.contentEl,
            '[data-testid="check-model-capabilities"]'
        );

        expect(button.getAttribute('title')).toBeNull();
        expect(button.getAttribute('aria-label')).toBe(
            'settings.modelCapabilitiesCheckTooltip'
        );
    });

    it('restores per-model capabilities when switching between fetched models', () => {
        provider.availableModels = ['gpt-4', 'gpt-4.1'];
        modal.onOpen();

        const toolsCheckbox = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-capability-tools"]'
        );
        toolsCheckbox.checked = true;
        toolsCheckbox.dispatchEvent(new Event('change'));

        const modelInput = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-combobox-input"]'
        );
        modelInput.value = 'gpt-4.1';
        modelInput.dispatchEvent(new Event('input'));

        const visionCheckbox = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-capability-vision"]'
        );
        visionCheckbox.checked = true;
        visionCheckbox.dispatchEvent(new Event('change'));

        modelInput.value = 'gpt-4';
        modelInput.dispatchEvent(new Event('input'));

        expect(
            getElement<HTMLInputElement>(
                modal.contentEl,
                '[data-testid="model-capability-tools"]'
            ).checked
        ).toBe(true);
        expect(
            getElement<HTMLInputElement>(
                modal.contentEl,
                '[data-testid="model-capability-vision"]'
            ).checked
        ).toBe(false);

        modelInput.value = 'gpt-4.1';
        modelInput.dispatchEvent(new Event('input'));

        expect(
            getElement<HTMLInputElement>(
                modal.contentEl,
                '[data-testid="model-capability-tools"]'
            ).checked
        ).toBe(false);
        expect(
            getElement<HTMLInputElement>(
                modal.contentEl,
                '[data-testid="model-capability-vision"]'
            ).checked
        ).toBe(true);
    });

    it('restores per-model capabilities in text-input mode without saving', () => {
        provider.type = 'ai302';
        provider.model = 'model-a';
        modal.onOpen();

        const modelInput = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-input"]'
        );

        const textCheckbox = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-capability-text"]'
        );
        textCheckbox.checked = true;
        textCheckbox.dispatchEvent(new Event('change'));

        modelInput.value = 'model-b';
        modelInput.dispatchEvent(new Event('input'));

        const toolsCheckbox = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-capability-tools"]'
        );
        toolsCheckbox.checked = true;
        toolsCheckbox.dispatchEvent(new Event('change'));

        modelInput.value = 'model-a';
        modelInput.dispatchEvent(new Event('input'));

        expect(
            getElement<HTMLInputElement>(
                modal.contentEl,
                '[data-testid="model-capability-text"]'
            ).checked
        ).toBe(true);
        expect(
            getElement<HTMLInputElement>(
                modal.contentEl,
                '[data-testid="model-capability-tools"]'
            ).checked
        ).toBe(false);

        modelInput.value = 'model-b';
        modelInput.dispatchEvent(new Event('input'));

        expect(
            getElement<HTMLInputElement>(
                modal.contentEl,
                '[data-testid="model-capability-text"]'
            ).checked
        ).toBe(false);
        expect(
            getElement<HTMLInputElement>(
                modal.contentEl,
                '[data-testid="model-capability-tools"]'
            ).checked
        ).toBe(true);
    });

    it('probes model capabilities and updates status', async () => {
        (probeModelCapabilities as Mock).mockResolvedValue({
            embedding: true,
            text: true,
            tools: false,
            vision: true,
        });

        modal.onOpen();

        const button = getElement<HTMLButtonElement>(
            modal.contentEl,
            '[data-testid="check-model-capabilities"]'
        );
        expect(button).toBeTruthy();

        button.click();
        await flushPromises();

        expect(probeModelCapabilities).toHaveBeenCalledWith({
            aiProviders: plugin.aiProviders,
            provider,
        });
        expect(provider.modelCapabilities?.['gpt-4']).toEqual({
            embedding: true,
            text: true,
            tools: false,
            vision: true,
        });
        expect(modal.contentEl.textContent).toContain('gpt-4');
        expect(modal.contentEl.textContent).toContain(
            'settings.modelCapabilitiesUpdated'
        );
    });

    it('ignores capability writes when no model is selected', () => {
        provider.model = '';

        (modal as any).setSelectedModelCapabilities({
            embedding: true,
            text: true,
            tools: true,
            vision: true,
        });

        expect(provider.modelCapabilities).toBeUndefined();
    });

    it('returns early when capability section is not mounted', () => {
        expect(() =>
            (modal as any).renderModelCapabilitiesSection()
        ).not.toThrow();
    });

    it('returns early when probing capabilities without a selected model', async () => {
        provider.model = '';
        (probeModelCapabilities as Mock).mockClear();

        await (modal as any).checkModelCapabilities();

        expect(probeModelCapabilities).not.toHaveBeenCalled();
    });

    it('shows capability probe failures in the modal status', async () => {
        (probeModelCapabilities as Mock).mockRejectedValue(
            new Error('probe failed')
        );

        modal.onOpen();
        await (modal as any).checkModelCapabilities();

        expect(modal.contentEl.textContent).toContain(
            'settings.modelCapabilitiesCheckFailed'
        );
    });

    it('should show correct title for add/edit modes', () => {
        modal.onOpen();
        expect(
            modal.contentEl.querySelector('[data-testid="provider-form-title"]')
                ?.textContent
        ).toBe('settings.addNewProvider');

        const editModal = new ProviderFormModal(
            app,
            plugin,
            provider,
            onSaveMock,
            false
        );
        editModal.onOpen();
        expect(
            editModal.contentEl.querySelector(
                '[data-testid="provider-form-title"]'
            )?.textContent
        ).toBe('settings.editProvider');
    });

    it('should handle model loading', async () => {
        const models = ['gpt-4', 'gpt-3.5-turbo'];
        vi.spyOn(plugin.aiProviders, 'fetchModels').mockResolvedValue(models);

        modal.onOpen();
        const refreshButton = getElement<HTMLButtonElement>(
            modal.contentEl,
            '[data-testid="refresh-models-button"]'
        );
        refreshButton.click();

        const loadingInput = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-combobox-input"]'
        );
        expect(loadingInput.disabled).toBe(true);
        expect(loadingInput.placeholder).toBe('settings.loadingModels');

        await flushPromises();
        const input = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-combobox-input"]'
        );
        expect(input.disabled).toBe(false);
        input.value = '';
        input.dispatchEvent(new Event('input'));
        await flushPromises();

        expect(
            modal.contentEl.querySelectorAll('[data-testid="model-suggestion"]')
        ).toHaveLength(2);
    });

    it('sets first model after refresh when models are returned', async () => {
        const models = ['gpt-4', 'gpt-3.5-turbo'];
        vi.spyOn(plugin.aiProviders, 'fetchModels').mockResolvedValue(models);

        await (modal as any).refreshModels();

        expect(provider.model).toBe('gpt-4');
    });

    it('falls back to empty model when first model is empty', async () => {
        vi.spyOn(plugin.aiProviders, 'fetchModels').mockResolvedValue(['']);

        await (modal as any).refreshModels();

        expect(provider.model).toBe('');
    });

    it('should update provider on type change', () => {
        modal.onOpen();
        const dropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );

        dropdown.value = 'ollama';
        dropdown.dispatchEvent(new Event('change'));

        expect(provider.type).toBe('ollama');
        expect(provider.url).toBe('http://localhost:11434');
    });

    it('should save and cancel correctly', async () => {
        modal.onOpen();

        const saveButton = Array.from(
            modal.contentEl.querySelectorAll('button')
        ).find(button => button.textContent === 'settings.save');
        saveButton?.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(onSaveMock).toHaveBeenCalledWith(provider);

        // Create a new modal instance for cancel test since the previous one was closed
        const cancelModal = new ProviderFormModal(
            app,
            plugin,
            provider,
            onSaveMock,
            true
        );
        cancelModal.onOpen();
        const cancelButton = cancelModal.contentEl.querySelector(
            '[data-testid="cancel-button"]'
        ) as HTMLButtonElement | null;
        expect(cancelButton).toBeTruthy();
        cancelButton?.click();
        expect(cancelModal.contentEl.children.length).toBe(0);
    });

    it('should use text input for ai302 provider', () => {
        provider.type = 'ai302';
        vi.spyOn(modal as any, 'hasModelFetching').mockReturnValue(false);

        modal.onOpen();

        expect(
            modal.contentEl.querySelector('[data-testid="model-input"]')
        ).toBeTruthy();
        expect(
            modal.contentEl.querySelector(
                '[data-testid="model-combobox-input"]'
            )
        ).toBeFalsy();
        expect(
            modal.contentEl.querySelector(
                '[data-testid="refresh-models-button"]'
            )
        ).toBeFalsy();
    });

    it('updates model when using text input mode', () => {
        provider.type = 'ai302';
        vi.spyOn(modal as any, 'hasModelFetching').mockReturnValue(false);
        modal.onOpen();

        const modelInput = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-input"]'
        );
        modelInput.value = 'custom-model';
        modelInput.dispatchEvent(new Event('input'));

        expect(provider.model).toBe('custom-model');
    });

    it('should use combobox for providers with model fetching', () => {
        provider.type = 'openai';
        modal.onOpen();

        expect(
            modal.contentEl.querySelector(
                '[data-testid="model-combobox-input"]'
            )
        ).toBeTruthy();
        expect(
            modal.contentEl.querySelector(
                '[data-testid="refresh-models-button"]'
            )
        ).toBeTruthy();
        expect(
            modal.contentEl.querySelector('[data-testid="model-input"]')
        ).toBeFalsy();
    });

    it('should use select for providers with model fetching on mobile', () => {
        (Platform as any).isMobileApp = true;
        provider.availableModels = ['model-a'];
        provider.model = '';
        modal.onOpen();

        expect(
            modal.contentEl.querySelector('[data-testid="model-select"]')
        ).toBeTruthy();
        expect(
            modal.contentEl.querySelector(
                '[data-testid="model-combobox-input"]'
            )
        ).toBeFalsy();
        expect(
            modal.contentEl.querySelector(
                '[data-testid="refresh-models-button"]'
            )
        ).toBeTruthy();
    });

    it('updates model when using mobile select', () => {
        (Platform as any).isMobileApp = true;
        provider.availableModels = ['model-a', 'model-b'];
        provider.model = '';
        modal.onOpen();

        const select = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="model-select"]'
        );
        select.value = 'model-b';
        select.dispatchEvent(new Event('change'));

        expect(provider.model).toBe('model-b');
    });

    it('includes current model when it is missing from mobile select list', () => {
        (Platform as any).isMobileApp = true;
        provider.availableModels = ['model-a'];
        provider.model = 'custom-model';
        modal.onOpen();

        const select = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="model-select"]'
        );
        const options = Array.from(select.querySelectorAll('option'));

        expect(options.some(option => option.value === 'custom-model')).toBe(
            true
        );
        expect(select.value).toBe('custom-model');
    });

    it('updates model when combobox selection changes', async () => {
        provider.availableModels = ['model-a', 'model-b'];
        provider.model = '';
        modal.onOpen();

        const input = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-combobox-input"]'
        );
        input.value = '';
        input.dispatchEvent(new Event('input'));
        await flushPromises();

        const options = Array.from(
            modal.contentEl.querySelectorAll('[data-testid="model-suggestion"]')
        );
        const target = options.find(
            option => option.getAttribute('data-value') === 'model-b'
        );
        target?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(provider.model).toBe('model-b');
        expect(input.title).toBe('model-b');
    });

    it('closes model suggest when modal closes', () => {
        provider.availableModels = ['model-a'];
        provider.model = '';
        modal.onOpen();

        const suggest = (modal as any).modelSuggest;
        const closeSpy = vi.spyOn(suggest, 'close');
        modal.onClose();

        expect(closeSpy).toHaveBeenCalled();
        expect((modal as any).modelSuggest).toBeUndefined();
    });

    it('recreates model suggest when form rerenders', () => {
        provider.availableModels = ['model-a'];
        provider.model = '';
        modal.onOpen();

        const suggest = (modal as any).modelSuggest;
        const closeSpy = vi.spyOn(suggest, 'close');
        modal.display();

        expect(closeSpy).toHaveBeenCalled();
        expect((modal as any).modelSuggest).not.toBe(suggest);
    });

    it('suppresses suggestion refresh right after selection', async () => {
        provider.availableModels = ['model-a', 'model-b'];
        provider.model = '';
        modal.onOpen();

        const input = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-combobox-input"]'
        );
        input.value = 'mo';
        input.dispatchEvent(new Event('input'));
        await flushPromises();

        const option = getElement<HTMLElement>(
            modal.contentEl,
            '[data-testid="model-suggestion"]'
        );
        option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        const suggest = (modal as any).modelSuggest;
        expect(suggest.getSuggestions('mo')).toHaveLength(0);
        expect(suggest.getSuggestions('mo').length).toBeGreaterThan(0);
    });

    it('filters models with fuzzy search and highlights matches', async () => {
        provider.availableModels = ['gpt-4', 'gpt-3.5-turbo', 'claude-3'];
        provider.model = '';
        modal.onOpen();

        const input = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-combobox-input"]'
        );
        input.value = 'pt';
        input.dispatchEvent(new Event('input'));
        await flushPromises();

        expect(
            modal.contentEl.querySelectorAll('[data-testid="model-suggestion"]')
                .length
        ).toBeGreaterThan(0);
        expect(
            modal.contentEl.querySelector('.suggestion-highlight')
        ).toBeTruthy();
        expect(provider.model).toBe('pt');
    });

    it('uses quick filtering for short queries without highlighting', async () => {
        provider.availableModels = ['alpha', 'beta'];
        provider.model = '';
        modal.onOpen();

        const input = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-combobox-input"]'
        );
        input.value = 'a';
        input.dispatchEvent(new Event('input'));
        await flushPromises();

        expect(
            modal.contentEl.querySelectorAll('[data-testid="model-suggestion"]')
                .length
        ).toBeGreaterThan(0);
        expect(
            modal.contentEl.querySelector('.suggestion-highlight')
        ).toBeFalsy();
    });

    it('limits short query results to the suggestion limit', async () => {
        provider.availableModels = Array.from(
            { length: 60 },
            (_, index) => `alpha-${index}`
        );
        provider.model = '';
        modal.onOpen();

        const input = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-combobox-input"]'
        );
        input.value = 'a';
        input.dispatchEvent(new Event('input'));
        await flushPromises();

        expect(
            modal.contentEl.querySelectorAll('[data-testid="model-suggestion"]')
        ).toHaveLength(50);
    });

    it('reuses matches when the query is extended', async () => {
        provider.availableModels = ['gpt-4', 'gpt-3.5-turbo', 'claude-3'];
        provider.model = '';
        modal.onOpen();

        const input = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-combobox-input"]'
        );
        input.value = 'gp';
        input.dispatchEvent(new Event('input'));
        await flushPromises();
        expect(
            modal.contentEl.querySelectorAll('[data-testid="model-suggestion"]')
                .length
        ).toBeGreaterThan(0);

        input.value = 'gpt';
        input.dispatchEvent(new Event('input'));
        await flushPromises();
        expect(
            modal.contentEl.querySelectorAll('[data-testid="model-suggestion"]')
                .length
        ).toBeGreaterThan(0);
    });

    it('hides suggestions when no model matches query', async () => {
        provider.availableModels = ['model-a'];
        provider.model = '';
        modal.onOpen();

        const input = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-combobox-input"]'
        );
        input.value = 'zzz';
        input.dispatchEvent(new Event('input'));
        await flushPromises();

        expect(
            modal.contentEl.querySelectorAll('[data-testid="model-suggestion"]')
        ).toHaveLength(0);
    });

    it('falls back to empty url when defaults are skipped', () => {
        provider.url = '';
        vi.spyOn(modal as any, 'initDefaults').mockImplementation(() => {});
        modal.onOpen();

        const urlInput = getElement<HTMLInputElement>(
            modal.contentEl,
            'input[data-field="provider-url"]'
        );

        expect(urlInput.value).toBe('');
    });

    it('should handle provider configuration methods correctly', () => {
        const hasModelFetching = (modal as any).hasModelFetching;
        const getDefaultName = (modal as any).getDefaultName;

        // Test that methods work without hardcoding specific providers
        expect(typeof hasModelFetching.call(modal, provider.type)).toBe(
            'boolean'
        );
        expect(typeof getDefaultName.call(modal, provider.type)).toBe('string');

        // Test URL setting through provider type change
        modal.onOpen();
        const dropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );
        const originalUrl = provider.url;

        // Change to different type and back to test URL updating
        dropdown.value = 'ollama';
        dropdown.dispatchEvent(new Event('change'));
        expect(provider.url).not.toBe(originalUrl);

        dropdown.value = 'openai';
        dropdown.dispatchEvent(new Event('change'));
        expect(provider.url).toBe('https://api.openai.com/v1');
    });

    it('should toggle api key input type on focus/blur', () => {
        modal.onOpen();

        const apiKeyInput = getElement<HTMLInputElement>(
            modal.contentEl,
            'input[placeholder="settings.apiKeyPlaceholder"]'
        );

        expect(apiKeyInput.type).toBe('password');

        apiKeyInput.dispatchEvent(new Event('focus'));
        expect(apiKeyInput.type).toBe('text');

        apiKeyInput.dispatchEvent(new Event('blur'));
        expect(apiKeyInput.type).toBe('password');
    });

    it('updates provider apiKey on input', () => {
        modal.onOpen();
        const apiKeyInput = getElement<HTMLInputElement>(
            modal.contentEl,
            'input[placeholder="settings.apiKeyPlaceholder"]'
        );

        apiKeyInput.value = 'new-key';
        apiKeyInput.dispatchEvent(new Event('input'));

        expect(provider.apiKey).toBe('new-key');
    });

    it('should initialize defaults for new providers', () => {
        const testProvider: IAIProvider = {
            id: 'test-id',
            name: '',
            type: 'openai',
            apiKey: '',
            url: '',
            model: '',
        };

        const testModal = new ProviderFormModal(
            app,
            plugin,
            testProvider,
            onSaveMock,
            true
        );
        const initDefaultsSpy = vi.spyOn(testModal as any, 'initDefaults');

        testModal.onOpen();

        expect(initDefaultsSpy).toHaveBeenCalled();
        initDefaultsSpy.mockRestore();
    });

    it('should sync name when provider changes and name is unmodified', () => {
        modal.onOpen();
        (modal as any).nameModified = false;

        const providerDropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );
        providerDropdown.value = 'ollama';
        providerDropdown.dispatchEvent(new Event('change'));

        expect(provider.name).toBe('Ollama');
    });

    it('should not sync name when manually modified', () => {
        modal.onOpen();

        const nameInput = getElement<HTMLInputElement>(
            modal.contentEl,
            'input[data-field="provider-name"]'
        );
        nameInput.value = 'Custom Provider';
        nameInput.dispatchEvent(new Event('input'));

        expect((modal as any).nameModified).toBe(true);

        const providerDropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );
        providerDropdown.value = 'ollama';
        providerDropdown.dispatchEvent(new Event('change'));

        expect(provider.name).toBe('Custom Provider');
    });

    it('should reset name modification tracking on reopen', () => {
        modal.onOpen();

        const nameInput = getElement<HTMLInputElement>(
            modal.contentEl,
            'input[data-field="provider-name"]'
        );
        nameInput.value = 'Modified';
        nameInput.dispatchEvent(new Event('input'));

        expect((modal as any).nameModified).toBe(true);

        modal.onClose();
        modal.onOpen();

        expect((modal as any).nameModified).toBe(false);
    });

    it('should show model description without toggle link', () => {
        provider.availableModels = ['gpt-4'];
        modal.onOpen();

        const modelSettings = Array.from(
            modal.contentEl.querySelectorAll('.setting-item')
        );
        const modelSetting = modelSettings.find(
            setting =>
                setting.querySelector('.setting-item-name')?.textContent ===
                'settings.model'
        );

        expect(modelSetting).toBeTruthy();
        const description = modelSetting?.querySelector(
            '.setting-item-description'
        );
        expect(description?.textContent).toBe('settings.modelDesc');
        expect(description?.querySelector('a')).toBeFalsy();
    });

    it('should handle model loading errors', async () => {
        vi.spyOn(plugin.aiProviders, 'fetchModels').mockRejectedValue(
            new Error('Test error')
        );
        vi.spyOn(console, 'error').mockImplementation(() => {});

        modal.onOpen();
        const refreshButton = getElement<HTMLButtonElement>(
            modal.contentEl,
            '[data-testid="refresh-models-button"]'
        );
        refreshButton.click();

        await new Promise(resolve => setTimeout(resolve, 0));
        const input = getElement<HTMLInputElement>(
            modal.contentEl,
            '[data-testid="model-combobox-input"]'
        );
        expect(input.disabled).toBe(true);
        expect(input.placeholder).toBe('settings.noModelsAvailable');
    });

    it('should populate provider dropdown from configuration', () => {
        modal.onOpen();
        const dropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );
        const options = Array.from(dropdown.querySelectorAll('option'));

        // Test that dropdown has options and they're not empty
        expect(options.length).toBeGreaterThan(0);
        options.forEach(option => {
            expect(option.value).toBeTruthy();
            expect(option.textContent).toBeTruthy();
        });
    });

    it('should update provider URL when type changes for new providers', () => {
        modal.onOpen();
        const dropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );

        const originalUrl = provider.url;

        // Change provider type and verify URL updates for new providers
        dropdown.value = 'ollama';
        dropdown.dispatchEvent(new Event('change'));
        expect(provider.url).not.toBe(originalUrl);
        expect(provider.url).toBeTruthy();

        // Change to another type and verify URL updates again
        const ollamaUrl = provider.url;
        dropdown.value = 'openai';
        dropdown.dispatchEvent(new Event('change'));
        expect(provider.url).not.toBe(ollamaUrl);
        expect(provider.url).toBeTruthy();
    });

    it('should update form fields when values change', () => {
        modal.onOpen();

        const nameInput = getElement<HTMLInputElement>(
            modal.contentEl,
            'input[data-field="provider-name"]'
        );
        nameInput.value = 'New Name';
        nameInput.dispatchEvent(new Event('input'));
        expect(provider.name).toBe('New Name');

        const urlInput = getElement<HTMLInputElement>(
            modal.contentEl,
            'input[data-field="provider-url"]'
        );
        urlInput.value = 'https://new-url.com';
        urlInput.dispatchEvent(new Event('input'));
        expect(provider.url).toBe('https://new-url.com');
        expect((modal as any).urlModified).toBe(true);
    });

    it('should treat name as unmodified if it matches previous provider default', () => {
        modal.onOpen();
        const providerDropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );

        // Change to ollama first
        providerDropdown.value = 'ollama';
        providerDropdown.dispatchEvent(new Event('change'));
        expect(provider.name).toBe('Ollama');

        // Now change to groq - should still update since name matches previous provider default
        providerDropdown.value = 'groq';
        providerDropdown.dispatchEvent(new Event('change'));
        expect(provider.name).toBe('Groq');
    });

    it('should show text-only description for ai302 provider without link', () => {
        provider.type = 'ai302';
        vi.spyOn(modal as any, 'hasModelFetching').mockReturnValue(false);

        modal.onOpen();

        // Find the model setting description
        const modelSettings = Array.from(
            modal.contentEl.querySelectorAll('.setting-item')
        );
        const modelSetting = modelSettings.find(
            setting =>
                setting.querySelector('.setting-item-name')?.textContent ===
                'settings.model'
        );

        expect(modelSetting).toBeTruthy();
        const description = modelSetting?.querySelector(
            '.setting-item-description'
        );
        expect(description?.textContent).toBe('settings.modelTextOnlyDesc');

        // Should not have a link for switching modes
        expect(description?.querySelector('a')).toBeFalsy();
    });

    it('should sync provider name in UI when type changes for new providers', () => {
        // Create modal for adding new provider
        const newProviderModal = new ProviderFormModal(
            app,
            plugin,
            provider,
            onSaveMock,
            true
        );
        newProviderModal.onOpen();

        const nameInput = getElement<HTMLInputElement>(
            newProviderModal.contentEl,
            'input[data-field="provider-name"]'
        );
        const providerDropdown = getElement<HTMLSelectElement>(
            newProviderModal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );

        // Change provider type
        providerDropdown.value = 'ollama';
        providerDropdown.dispatchEvent(new Event('change'));

        // Both model and UI should be updated for new providers
        expect(provider.name).toBe('Ollama');
        expect(nameInput.value).toBe('Ollama');
    });

    it('should NOT sync provider name when editing existing provider', () => {
        // Create modal for editing existing provider (isAddingNew = false)
        const editModal = new ProviderFormModal(
            app,
            plugin,
            provider,
            onSaveMock,
            false
        );
        editModal.onOpen();

        const nameInput = getElement<HTMLInputElement>(
            editModal.contentEl,
            'input[data-field="provider-name"]'
        );
        const providerDropdown = getElement<HTMLSelectElement>(
            editModal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );

        const originalName = provider.name;

        // Change provider type
        providerDropdown.value = 'ollama';
        providerDropdown.dispatchEvent(new Event('change'));

        // Name should NOT change when editing existing provider
        expect(provider.name).toBe(originalName);
        expect(nameInput.value).toBe(originalName);
    });

    it('should NOT sync provider URL when editing existing provider', () => {
        // Create modal for editing existing provider (isAddingNew = false)
        const editModal = new ProviderFormModal(
            app,
            plugin,
            provider,
            onSaveMock,
            false
        );
        editModal.onOpen();

        const urlInput = getElement<HTMLInputElement>(
            editModal.contentEl,
            'input[data-field="provider-url"]'
        );
        const providerDropdown = getElement<HTMLSelectElement>(
            editModal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );

        const originalUrl = provider.url;

        // Change provider type
        providerDropdown.value = 'ollama';
        providerDropdown.dispatchEvent(new Event('change'));

        // URL should NOT change when editing existing provider
        expect(provider.url).toBe(originalUrl);
        expect(urlInput.value).toBe(originalUrl);
    });

    it('should not sync URL when manually modified for new providers', () => {
        modal.onOpen();

        const urlInput = getElement<HTMLInputElement>(
            modal.contentEl,
            'input[data-field="provider-url"]'
        );
        urlInput.value = 'https://custom-url.com';
        urlInput.dispatchEvent(new Event('input'));

        expect((modal as any).urlModified).toBe(true);

        const providerDropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );
        providerDropdown.value = 'ollama';
        providerDropdown.dispatchEvent(new Event('change'));

        expect(provider.url).toBe('https://custom-url.com');
    });

    it('should sync URL when provider changes and URL is unmodified for new providers', () => {
        modal.onOpen();
        (modal as any).urlModified = false;

        const providerDropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );
        providerDropdown.value = 'ollama';
        providerDropdown.dispatchEvent(new Event('change'));

        expect(provider.url).toBe('http://localhost:11434');
    });

    it('should reset URL modification tracking on reopen', () => {
        modal.onOpen();

        const urlInput = getElement<HTMLInputElement>(
            modal.contentEl,
            'input[data-field="provider-url"]'
        );
        urlInput.value = 'https://modified-url.com';
        urlInput.dispatchEvent(new Event('input'));

        expect((modal as any).urlModified).toBe(true);

        modal.onClose();
        modal.onOpen();

        expect((modal as any).urlModified).toBe(false);
    });

    it('recreates form when model fetching capability changes', () => {
        modal.onOpen();
        const displaySpy = vi.spyOn(modal, 'display');
        const updateSpy = vi.spyOn(modal as any, 'updateFields');

        const providerDropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );
        providerDropdown.value = 'ai302';
        providerDropdown.dispatchEvent(new Event('change'));

        expect(displaySpy).toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('updates fields when provider type changes without re-creating form', () => {
        modal.onOpen();
        provider.url = '';

        const updateSpy = vi.spyOn(modal as any, 'updateFields');
        const providerDropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );

        providerDropdown.value = 'openrouter';
        providerDropdown.dispatchEvent(new Event('change'));

        expect(updateSpy).toHaveBeenCalled();
        (modal as any).updateFields();

        const urlInput = getElement<HTMLInputElement>(
            modal.contentEl,
            'input[data-field="provider-url"]'
        );
        expect(urlInput.value).toBe(provider.url || '');
    });

    it('falls back to empty url when updating fields', () => {
        modal.onOpen();
        provider.url = '';

        (modal as any).updateFields();

        const urlInput = getElement<HTMLInputElement>(
            modal.contentEl,
            'input[data-field="provider-url"]'
        );
        expect(urlInput.value).toBe('');
    });
});
