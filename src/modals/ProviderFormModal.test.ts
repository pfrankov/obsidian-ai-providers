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

function getElement<T extends HTMLElement>(
    container: HTMLElement,
    selector: string
): T {
    const element = container.querySelector(selector);
    if (!element) throw new Error(`Element "${selector}" not found`);
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

    it('should render basic form elements', () => {
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
        // Add mode
        modal.onOpen();
        let title = modal.contentEl.querySelector(
            '[data-testid="provider-form-title"]'
        );
        expect(title?.textContent).toBe('settings.addNewProvider');

        // Edit mode
        modal = new ProviderFormModal(app, plugin, provider, onSaveMock, false);
        modal.onOpen();
        title = modal.contentEl.querySelector(
            '[data-testid="provider-form-title"]'
        );
        expect(title?.textContent).toBe('settings.editProvider');
    });

    it('should include all provider types', () => {
        modal.onOpen();
        const dropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );
        const options = Array.from(dropdown.querySelectorAll('option')).map(
            o => o.value
        );
        const expectedTypes = [
            'openai',
            'ollama',
            'ollama-openwebui',
            'openrouter',
            'gemini',
            'lmstudio',
            'groq',
        ];
        expectedTypes.forEach(type => expect(options).toContain(type));
    });

    it('should handle model loading and selection', async () => {
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
        expect(Array.from(dropdown.querySelectorAll('option')).length).toBe(2);
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

    it('should update provider type and URL', () => {
        modal.onOpen();
        const dropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );

        dropdown.value = 'ollama';
        dropdown.dispatchEvent(new Event('change'));

        expect(provider.type).toBe('ollama');
        expect(provider.url).toBe('http://localhost:11434');
        expect(provider.model).toBeUndefined();
    });

    it('should set correct default URLs for provider types', () => {
        modal.onOpen();
        const dropdown = getElement<HTMLSelectElement>(
            modal.contentEl,
            '[data-testid="provider-type-dropdown"]'
        );

        const testCases = [
            { type: 'openai', url: 'https://api.openai.com/v1' },
            { type: 'ollama', url: 'http://localhost:11434' },
            { type: 'groq', url: 'https://api.groq.com/openai/v1' },
        ];

        testCases.forEach(({ type, url }) => {
            dropdown.value = type;
            dropdown.dispatchEvent(new Event('change'));
            expect(provider.url).toBe(url);
        });
    });

    it('should save provider when save button clicked', async () => {
        modal.onOpen();
        const saveButton = Array.from(
            modal.contentEl.querySelectorAll('button')
        ).find(button => button.textContent === 'settings.save');
        saveButton?.click();

        await new Promise(resolve => setTimeout(resolve, 0));
        expect(onSaveMock).toHaveBeenCalledWith(provider);
    });

    it('should close modal without saving when cancel clicked', () => {
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

        const nameInput = getElement<HTMLInputElement>(
            modal.contentEl,
            'input[placeholder="settings.providerNamePlaceholder"]'
        );
        nameInput.value = 'New Name';
        nameInput.dispatchEvent(new Event('input'));
        expect(provider.name).toBe('New Name');

        const urlInput = getElement<HTMLInputElement>(
            modal.contentEl,
            'input[placeholder="settings.providerUrlPlaceholder"]'
        );
        urlInput.value = 'https://new-url.com';
        urlInput.dispatchEvent(new Event('input'));
        expect(provider.url).toBe('https://new-url.com');
    });

    it('should switch between model input modes', () => {
        provider.availableModels = ['gpt-4', 'gpt-3.5-turbo'];
        provider.model = 'gpt-4';
        modal.onOpen();

        // Initial dropdown mode
        expect(
            modal.contentEl.querySelector('[data-testid="model-dropdown"]')
        ).toBeTruthy();

        // Switch to text mode
        (modal as any).isTextMode = true;
        modal.display();
        expect(
            modal.contentEl.querySelector('[data-testid="model-input"]')
        ).toBeTruthy();

        // Switch back to dropdown
        (modal as any).isTextMode = false;
        modal.display();
        expect(
            modal.contentEl.querySelector('[data-testid="model-dropdown"]')
        ).toBeTruthy();
    });
});
