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

// Helper function to safely get typed element
function getElement<T extends HTMLElement>(
    container: HTMLElement,
    selector: string
): T {
    const element = container.querySelector(selector);
    if (!element) {
        throw new Error(`Element with selector "${selector}" not found`);
    }
    return element as unknown as T;
}

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

    describe('Form Display', () => {
        it('should render form fields', () => {
            modal.onOpen();

            expect(
                modal.contentEl.querySelector(
                    '[data-testid="provider-form-title"]'
                )
            ).toBeTruthy();
            expect(
                modal.contentEl.querySelector(
                    '[data-testid="provider-type-dropdown"]'
                )
            ).toBeTruthy();
            expect(
                modal.contentEl.querySelector('[data-testid="model-dropdown"]')
            ).toBeTruthy();
            expect(
                modal.contentEl.querySelector(
                    '[data-testid="refresh-models-button"]'
                )
            ).toBeTruthy();
            expect(
                modal.contentEl.querySelector('[data-testid="cancel-button"]')
            ).toBeTruthy();
        });

        it('should show correct title when adding new provider', () => {
            modal = new ProviderFormModal(
                app,
                plugin,
                provider,
                onSaveMock,
                true
            );
            modal.onOpen();

            const title = modal.contentEl.querySelector(
                '[data-testid="provider-form-title"]'
            );
            expect(title?.textContent).toBe('settings.addNewProvider');
        });

        it('should show correct title when editing provider', () => {
            modal = new ProviderFormModal(
                app,
                plugin,
                provider,
                onSaveMock,
                false
            );
            modal.onOpen();

            const title = modal.contentEl.querySelector(
                '[data-testid="provider-form-title"]'
            );
            expect(title?.textContent).toBe('settings.editProvider');
        });
    });

    describe('Models List Management', () => {
        it('should show loading state when fetching models', () => {
            modal.onOpen();
            (modal as any).isLoadingModels = true;
            (modal as any).display();

            const dropdown = getElement<HTMLSelectElement>(
                modal.contentEl,
                '[data-testid="model-dropdown"]'
            );
            const refreshButton = getElement<HTMLButtonElement>(
                modal.contentEl,
                '[data-testid="refresh-models-button"]'
            );

            expect(dropdown.disabled).toBe(true);
            expect(dropdown.querySelector('option')?.value).toBe('loading');
            expect(refreshButton.disabled).toBe(true);
            expect(refreshButton.classList.contains('loading')).toBe(true);
        });

        it('should update title when model changes', () => {
            provider.availableModels = ['gpt-4', 'gpt-3.5-turbo'];
            modal.onOpen();

            const dropdown = getElement<HTMLSelectElement>(
                modal.contentEl,
                '[data-testid="model-dropdown"]'
            );

            // Check initial title
            expect(dropdown.title).toBe('gpt-4');

            // Change model and check title update
            dropdown.value = 'gpt-3.5-turbo';
            dropdown.dispatchEvent(new Event('change'));

            expect(dropdown.title).toBe('gpt-3.5-turbo');
            expect(provider.model).toBe('gpt-3.5-turbo');
        });

        it('should successfully load and display models', async () => {
            const models = ['gpt-4', 'gpt-3.5-turbo'];
            jest.spyOn(plugin.aiProviders, 'fetchModels').mockResolvedValue(
                models
            );

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
            const options = Array.from(dropdown.querySelectorAll('option'));

            expect(dropdown.disabled).toBe(false);
            expect(options.length).toBe(2);
            expect(options[0].value).toBe('gpt-4');
            expect(options[1].value).toBe('gpt-3.5-turbo');
            expect(provider.model).toBe('gpt-4');
        });

        it('should handle empty models list', async () => {
            jest.spyOn(plugin.aiProviders, 'fetchModels').mockResolvedValue([]);

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
            expect(refreshButton.disabled).toBe(false);
            expect(refreshButton.classList.contains('loading')).toBe(false);
        });

        it('should handle error when loading models', async () => {
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
            expect(refreshButton.disabled).toBe(false);
            expect(refreshButton.classList.contains('loading')).toBe(false);
        });
    });

    describe('Provider Type Management', () => {
        it('should update provider type and URL when type changes', () => {
            modal.onOpen();

            const dropdown = getElement<HTMLSelectElement>(
                modal.contentEl,
                '[data-testid="provider-type-dropdown"]'
            );

            // Simulate type change to Ollama
            dropdown.value = 'ollama';
            dropdown.dispatchEvent(new Event('change'));

            expect(provider.type).toBe('ollama');
            expect(provider.url).toBe('http://localhost:11434');
            expect(provider.model).toBeUndefined();
            expect(provider.availableModels).toBeUndefined();
        });

        it('should set default URL based on provider type', () => {
            modal.onOpen();

            const dropdown = getElement<HTMLSelectElement>(
                modal.contentEl,
                '[data-testid="provider-type-dropdown"]'
            );

            // Test OpenAI
            dropdown.value = 'openai';
            dropdown.dispatchEvent(new Event('change'));
            expect(provider.url).toBe('https://api.openai.com/v1');

            // Test Ollama
            dropdown.value = 'ollama';
            dropdown.dispatchEvent(new Event('change'));
            expect(provider.url).toBe('http://localhost:11434');

            // Test Gemini
            dropdown.value = 'gemini';
            dropdown.dispatchEvent(new Event('change'));
            expect(provider.url).toBe(
                'https://generativelanguage.googleapis.com/v1beta/openai'
            );

            // Test OpenRouter
            dropdown.value = 'openrouter';
            dropdown.dispatchEvent(new Event('change'));
            expect(provider.url).toBe('https://openrouter.ai/api/v1');

            // Test LM Studio
            dropdown.value = 'lmstudio';
            dropdown.dispatchEvent(new Event('change'));
            expect(provider.url).toBe('http://localhost:1234/v1');
        });

        it('should reset model and availableModels when changing provider type', () => {
            modal.onOpen();

            // Set initial values
            provider.model = 'test-model';
            provider.availableModels = ['model1', 'model2'];

            const dropdown = getElement<HTMLSelectElement>(
                modal.contentEl,
                '[data-testid="provider-type-dropdown"]'
            );

            // Test with Gemini
            dropdown.value = 'gemini';
            dropdown.dispatchEvent(new Event('change'));
            expect(provider.model).toBeUndefined();
            expect(provider.availableModels).toBeUndefined();

            // Test with OpenRouter
            dropdown.value = 'openrouter';
            dropdown.dispatchEvent(new Event('change'));
            expect(provider.model).toBeUndefined();
            expect(provider.availableModels).toBeUndefined();

            // Test with LM Studio
            dropdown.value = 'lmstudio';
            dropdown.dispatchEvent(new Event('change'));
            expect(provider.model).toBeUndefined();
            expect(provider.availableModels).toBeUndefined();
        });
    });

    describe('Form Actions', () => {
        it('should save provider and close modal', async () => {
            modal.onOpen();

            const saveButton = Array.from(
                modal.contentEl.querySelectorAll('button')
            ).find(button => button.textContent === 'settings.save');
            saveButton?.click();

            await new Promise(resolve => setTimeout(resolve, 0));

            expect(onSaveMock).toHaveBeenCalledWith(provider);
            expect(modal.contentEl.children.length).toBe(0);
        });

        it('should close modal without saving when cancel is clicked', () => {
            modal.onOpen();

            const cancelButton = getElement<HTMLButtonElement>(
                modal.contentEl,
                '[data-testid="cancel-button"]'
            );
            cancelButton.click();

            expect(onSaveMock).not.toHaveBeenCalled();
            expect(modal.contentEl.children.length).toBe(0);
        });

        it('should update form fields when values change', () => {
            modal.onOpen();

            // Test name field
            const nameInput = getElement<HTMLInputElement>(
                modal.contentEl,
                'input[placeholder="settings.providerNamePlaceholder"]'
            );
            nameInput.value = 'New Name';
            nameInput.dispatchEvent(new Event('input'));
            expect(provider.name).toBe('New Name');

            // Test URL field
            const urlInput = getElement<HTMLInputElement>(
                modal.contentEl,
                'input[placeholder="settings.providerUrlPlaceholder"]'
            );
            urlInput.value = 'https://new-url.com';
            urlInput.dispatchEvent(new Event('input'));
            expect(provider.url).toBe('https://new-url.com');

            // Test API key field
            const apiKeyInput = getElement<HTMLInputElement>(
                modal.contentEl,
                'input[placeholder="settings.apiKeyPlaceholder"]'
            );
            apiKeyInput.value = 'new-api-key';
            apiKeyInput.dispatchEvent(new Event('input'));
            expect(provider.apiKey).toBe('new-api-key');
        });
    });

    describe('Model Input Mode Switching', () => {
        beforeEach(() => {
            provider.availableModels = ['gpt-4', 'gpt-3.5-turbo'];
            provider.model = 'gpt-4';
            modal.onOpen();
        });

        const triggerModeSwitch = () => {
            // Force isTextMode change since we can't rely on link click in tests
            (modal as any).isTextMode = !(modal as any).isTextMode;
            modal.display();
        };

        it('should switch from dropdown to text mode', () => {
            // Initial state check
            expect(() =>
                getElement(modal.contentEl, '[data-testid="model-dropdown"]')
            ).not.toThrow();
            expect(() =>
                getElement(modal.contentEl, '[data-testid="model-input"]')
            ).toThrow();

            // Switch mode
            triggerModeSwitch();

            // Check if switched to text mode
            expect(() =>
                getElement(modal.contentEl, '[data-testid="model-input"]')
            ).not.toThrow();
            expect(() =>
                getElement(modal.contentEl, '[data-testid="model-dropdown"]')
            ).toThrow();
        });

        it('should switch from text mode to dropdown mode', () => {
            // Switch to text mode first
            triggerModeSwitch();

            // Verify text mode
            expect(() =>
                getElement(modal.contentEl, '[data-testid="model-input"]')
            ).not.toThrow();

            // Switch back to dropdown mode
            triggerModeSwitch();

            // Check if switched back to dropdown mode
            expect(() =>
                getElement(modal.contentEl, '[data-testid="model-dropdown"]')
            ).not.toThrow();
            expect(() =>
                getElement(modal.contentEl, '[data-testid="model-input"]')
            ).toThrow();
        });

        it('should preserve model value when switching modes', () => {
            const testModel = 'gpt-4';
            provider.model = testModel;

            // Switch to text mode
            triggerModeSwitch();

            // Check if value preserved in text mode
            const textInput = getElement<HTMLInputElement>(
                modal.contentEl,
                '[data-testid="model-input"]'
            );
            expect(textInput.value).toBe(testModel);

            // Switch back to dropdown
            triggerModeSwitch();

            // Check if value preserved in dropdown
            const dropdown = getElement<HTMLSelectElement>(
                modal.contentEl,
                '[data-testid="model-dropdown"]'
            );
            expect(dropdown.value).toBe(testModel);
        });
    });
});
