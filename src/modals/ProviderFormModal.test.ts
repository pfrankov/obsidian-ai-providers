import { App } from 'obsidian';
import { ProviderFormModal } from './ProviderFormModal';
import AIProvidersPlugin from '../main';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
import { AIProvidersService } from '../AIProvidersService';

jest.mock('../i18n', () => ({
    I18n: {
        t: (key: string) => key,
    },
}));

const getElement = <T extends HTMLElement>(
    container: HTMLElement,
    selector: string
): T => {
    const element = container.querySelector(selector);
    if (!element) throw new Error(`Element "${selector}" not found`);
    return element as unknown as T;
};

describe('ProviderFormModal', () => {
    let app: App;
    let plugin: AIProvidersPlugin;
    let modal: ProviderFormModal;
    let onSaveMock: jest.Mock;
    let provider: IAIProvider;

    beforeEach(() => {
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

        onSaveMock = jest.fn();
        modal = new ProviderFormModal(app, plugin, provider, onSaveMock, true);
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
            modal.contentEl.querySelector('[data-testid="model-dropdown"]')
        ).toBeTruthy();
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
        jest.spyOn(plugin.aiProviders, 'fetchModels').mockResolvedValue(models);

        modal.onOpen();
        const refreshButton = getElement<HTMLButtonElement>(
            modal.contentEl,
            '[data-testid="refresh-models-button"]'
        );
        refreshButton.click();

        await new Promise(resolve => setTimeout(resolve, 0));
        const dropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="model-dropdown"]'
        );
        expect(dropdown.disabled).toBe(false);
        expect(dropdown.querySelectorAll('option')).toHaveLength(2);
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

    it('should use text input for ai320 provider', () => {
        provider.type = 'ai320';
        jest.spyOn(modal as any, 'hasModelFetching').mockReturnValue(false);

        modal.onOpen();

        expect(
            modal.contentEl.querySelector('[data-testid="model-input"]')
        ).toBeTruthy();
        expect(
            modal.contentEl.querySelector('[data-testid="model-dropdown"]')
        ).toBeFalsy();
        expect(
            modal.contentEl.querySelector(
                '[data-testid="refresh-models-button"]'
            )
        ).toBeFalsy();
    });

    it('should use dropdown for providers with model fetching', () => {
        provider.type = 'openai';
        modal.onOpen();

        expect(
            modal.contentEl.querySelector('[data-testid="model-dropdown"]')
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
        const initDefaultsSpy = jest.spyOn(testModal as any, 'initDefaults');

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

    it('should switch between text and dropdown modes', () => {
        provider.availableModels = ['gpt-4', 'gpt-3.5-turbo'];
        modal.onOpen();

        expect(
            modal.contentEl.querySelector('[data-testid="model-dropdown"]')
        ).toBeTruthy();

        (modal as any).isTextMode = true;
        modal.display();
        expect(
            modal.contentEl.querySelector('[data-testid="model-input"]')
        ).toBeTruthy();
    });

    it('should handle model loading errors', async () => {
        jest.spyOn(plugin.aiProviders, 'fetchModels').mockRejectedValue(
            new Error('Test error')
        );
        jest.spyOn(console, 'error').mockImplementation(() => {});

        modal.onOpen();
        const refreshButton = getElement<HTMLButtonElement>(
            modal.contentEl,
            '[data-testid="refresh-models-button"]'
        );
        refreshButton.click();

        await new Promise(resolve => setTimeout(resolve, 0));
        const dropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="model-dropdown"]'
        );
        expect(dropdown.disabled).toBe(true);
        expect(dropdown.querySelector('option')?.value).toBe('none');
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

    it('should show text-only description for ai320 provider without link', () => {
        provider.type = 'ai320';
        jest.spyOn(modal as any, 'hasModelFetching').mockReturnValue(false);

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
});
