import { App } from 'obsidian';
import { AIProvidersSettingTab, DEFAULT_SETTINGS } from './settings';
import AIProvidersPlugin from './main';
import { ConfirmationModal } from './modals/ConfirmationModal';
import { IAIProvider, IChunkHandler } from './types';
import { OpenAIHandler } from './handlers/OpenAIHandler';
import { OllamaHandler } from './handlers/OllamaHandler';
import { AIProvidersService } from './AIProvidersService';
import { I18n } from './i18n';

// Мокаем модальное окно
jest.mock('./modals/ConfirmationModal', () => {
    return {
        ConfirmationModal: jest.fn().mockImplementation((app, message, onConfirm) => {
            return {
                app,
                message,
                onConfirm,
                contentEl: document.createElement('div'),
                open: jest.fn(),
                close: jest.fn()
            };
        })
    };
});

// Мокаем хендлеры с общей реализацией
const mockHandlerImplementation = {
    fetchModels: jest.fn().mockResolvedValue(['model-1', 'model-2']),
    execute: jest.fn().mockResolvedValue({
        onData: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        abort: jest.fn()
    } as IChunkHandler)
};

jest.mock('./handlers/OpenAIHandler', () => ({
    OpenAIHandler: jest.fn().mockImplementation(() => mockHandlerImplementation)
}));

jest.mock('./handlers/OllamaHandler', () => ({
    OllamaHandler: jest.fn().mockImplementation(() => mockHandlerImplementation)
}));

// Мокаем AIProvidersService
jest.mock('./AIProvidersService', () => {
    return {
        AIProvidersService: jest.fn().mockImplementation((app, settings) => ({
            providers: settings?.providers || [],
            version: 1,
            handlers: {
                openai: new OpenAIHandler(settings),
                ollama: new OllamaHandler(settings)
            },
            embed: jest.fn().mockImplementation(async (params) => {
                if (params.provider.apiKey === 'error') {
                    throw new Error('Failed to embed');
                }
                return [0.1, 0.2, 0.3];
            }),
            fetchModels: jest.fn().mockImplementation(async (provider) => {
                if (provider.apiKey === 'error') {
                    throw new Error('Failed to fetch');
                }
                return ['gpt-4', 'gpt-3.5-turbo'];
            }),
            execute: jest.fn().mockImplementation(async () => ({
                onData: jest.fn(),
                onEnd: jest.fn(),
                onError: jest.fn(),
                abort: jest.fn()
            })),
            checkCompatibility: jest.fn().mockImplementation((requiredVersion) => {
                if (requiredVersion > 1) {
                    throw new Error('Plugin must be updated');
                }
            })
        }))
    };
});

// Test helpers
const createTestProvider = (overrides: Partial<IAIProvider> = {}): IAIProvider => ({
    id: "test-id-1",
    name: "Test Provider",
    apiKey: "test-key",
    url: "https://test.com",
    type: "openai",
    model: "gpt-4",
    ...overrides
});

const createTestSetup = () => {
    const app = new App();
    const plugin = new AIProvidersPlugin(app, {
        id: 'test-plugin',
        name: 'Test Plugin',
        author: 'Test Author',
        version: '1.0.0',
        minAppVersion: '0.0.1',
        description: 'Test Description'
    });
    plugin.settings = { 
        ...DEFAULT_SETTINGS,
        providers: [] 
    };
    plugin.saveSettings = jest.fn().mockResolvedValue(undefined);
    plugin.aiProviders = new AIProvidersService(app, plugin.settings);

    const settingTab = new AIProvidersSettingTab(app, plugin);
    const containerEl = document.createElement('div');
    
    // Mock HTMLElement methods
    containerEl.createDiv = function(className?: string): HTMLElement {
        const div = document.createElement('div');
        if (className) {
            div.className = className;
        }
        this.appendChild(div);
        return div;
    };
    containerEl.empty = function(): void {
        while (this.firstChild) {
            this.removeChild(this.firstChild);
        }
    };
    containerEl.createEl = function(tag: string, attrs?: { text?: string }): HTMLElement {
        const el = document.createElement(tag);
        if (attrs?.text) {
            el.textContent = attrs.text;
        }
        this.appendChild(el);
        return el;
    };

    // @ts-ignore
    settingTab.containerEl = containerEl;

    return { app, plugin, settingTab, containerEl };
};

describe('AIProvidersSettingTab', () => {
    let app: App;
    let plugin: AIProvidersPlugin;
    let settingTab: AIProvidersSettingTab;
    let containerEl: HTMLElement;

    beforeEach(() => {
        const setup = createTestSetup();
        app = setup.app;
        plugin = setup.plugin;
        settingTab = setup.settingTab;
        containerEl = setup.containerEl;
    });

    describe('Provider Management', () => {
        it('should add a new provider', async () => {
            settingTab.display();
            (settingTab as any).isFormOpen = true;
            
            const provider = createTestProvider({ id: "test-id-2", name: "New Provider", apiKey: "" });
            await settingTab.saveProvider(provider);

            expect(plugin.settings.providers?.length).toBe(1);
            expect(plugin.settings.providers?.[0]).toEqual(provider);
            expect(plugin.saveSettings).toHaveBeenCalled();
        });

        it('should edit existing provider', async () => {
            const testProvider = createTestProvider();
            plugin.settings.providers = [testProvider];
            
            settingTab.display();
            (settingTab as any).isFormOpen = true;
            (settingTab as any).editingProvider = testProvider;

            const updatedProvider = createTestProvider({ name: 'Updated Provider' });
            await settingTab.saveProvider(updatedProvider);

            expect(plugin.settings.providers?.[0].name).toBe('Updated Provider');
            expect(plugin.saveSettings).toHaveBeenCalled();
        });

        it('should delete a provider', async () => {
            plugin.settings.providers = [createTestProvider()];
            
            // Вызываем удаление провайдера
            await settingTab.deleteProvider(createTestProvider());

            expect(plugin.settings.providers?.length).toBe(0);
            expect(plugin.saveSettings).toHaveBeenCalled();
        });

        it('should not save provider without required fields', async () => {
            const invalidProvider: IAIProvider = createTestProvider({ name: '' });

            await settingTab.saveProvider(invalidProvider);

            expect(plugin.settings.providers?.length).toBe(0);
            expect(plugin.saveSettings).not.toHaveBeenCalled();
        });

        it('should show confirmation modal before deleting provider', async () => {
            plugin.settings.providers = [createTestProvider()];
            
            settingTab.display();
            
            // Находим кнопку удаления по data-testid
            const deleteButton = containerEl.querySelector('[data-testid="delete-provider"]');
            expect(deleteButton).not.toBeNull();
            
            // Симуируем клик
            deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            // Проверяем, что модальное окно было создано
            expect(ConfirmationModal).toHaveBeenCalled();
            
            // Получаем инстанс и параметры модального окна
            const [appParam, messageParam, onConfirmParam] = (ConfirmationModal as jest.Mock).mock.calls[0];
            
            expect(appParam).toBe(app);
            expect(typeof messageParam).toBe('string');
            expect(typeof onConfirmParam).toBe('function');
        });

        it('should duplicate a provider', async () => {
            // Добавляем исходный провайдер
            plugin.settings.providers = [createTestProvider()];
            
            // Дублируем провайдер
            await settingTab.duplicateProvider(createTestProvider());

            // Провряем, чо провайдер был продублирован
            expect(plugin.settings.providers?.length).toBe(2);
            
            const duplicatedProvider = plugin.settings.providers?.[1];
            expect(duplicatedProvider).toBeTruthy();
            expect(duplicatedProvider?.name).toContain(createTestProvider().name);
            expect(duplicatedProvider?.name).toContain('Duplicate');
            expect(duplicatedProvider?.apiKey).toBe(createTestProvider().apiKey);
            expect(duplicatedProvider?.url).toBe(createTestProvider().url);
            expect(duplicatedProvider?.type).toBe(createTestProvider().type);
            expect(duplicatedProvider?.id).not.toBe(createTestProvider().id);
            
            expect(plugin.saveSettings).toHaveBeenCalled();
        });

        it('should render duplicate button for each provider', () => {
            plugin.settings.providers = [createTestProvider()];
            settingTab.display();
            
            // Находим кнопку дублирования по data-testid
            const duplicateButton = containerEl.querySelector('[data-testid="duplicate-provider"]');
            
            expect(duplicateButton).toBeTruthy();
        });

        it('should duplicate provider when clicking duplicate button', async () => {
            plugin.settings.providers = [createTestProvider()];
            
            // Создаем шпиона для метода duplicateProvider
            const duplicateSpy = jest.spyOn(settingTab, 'duplicateProvider');
            
            settingTab.display();
            
            // Находим кнопку дублирования по data-testid
            const duplicateButton = containerEl.querySelector('[data-testid="duplicate-provider"]');
            expect(duplicateButton).toBeTruthy();
            
            // Симулируем клик
            duplicateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            
            // Проверяем, что метод был вызван с правильным провайдером
            expect(duplicateSpy).toHaveBeenCalledWith(createTestProvider());
            
            // Очищаем шпиона
            duplicateSpy.mockRestore();
        });

        it('should validate provider URL', async () => {
            const invalidProvider: IAIProvider = createTestProvider({ url: 'invalid-url' });

            await settingTab.saveProvider(invalidProvider);

            expect(plugin.settings.providers?.length).toBe(0);
            expect(plugin.saveSettings).not.toHaveBeenCalled();
        });

        it('should validate provider type', async () => {
            const invalidProvider = {
                ...createTestProvider(),
                type: 'invalid-type' as 'openai' | 'ollama'
            };

            await settingTab.saveProvider(invalidProvider);

            expect(plugin.settings.providers?.length).toBe(0);
            expect(plugin.saveSettings).not.toHaveBeenCalled();
        });

        it('should handle duplicate provider names', async () => {
            // Add first provider
            await settingTab.saveProvider(createTestProvider());

            // Try to add another provider with the same name
            const duplicateProvider: IAIProvider = createTestProvider({ id: 'different-id' });

            await settingTab.saveProvider(duplicateProvider);

            expect(plugin.settings.providers?.length).toBe(1);
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        });

        it('should display model pill when provider has a model', () => {
            const providerWithModel = createTestProvider({
                model: 'gpt-4'
            });
            plugin.settings.providers = [providerWithModel];
            settingTab.display();

            const modelPill = containerEl.querySelector('[data-testid="model-pill"]');
            expect(modelPill).toBeTruthy();
            expect(modelPill?.textContent).toBe('gpt-4');
        });

        it('should not display model pill when provider has no model', () => {
            const providerWithoutModel = createTestProvider({
                model: undefined
            });
            plugin.settings.providers = [providerWithoutModel];
            settingTab.display();

            const modelPill = containerEl.querySelector('[data-testid="model-pill"]');
            expect(modelPill).toBeFalsy();
        });
    });

    describe('Models List Management', () => {
        let editingProvider: IAIProvider;

        beforeEach(() => {
            plugin.settings.providers = [createTestProvider()];
            settingTab.display();
            
            // Open form and set provider
            const addButton = containerEl.querySelector('[data-testid="add-provider-button"]');
            addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            
            editingProvider = createTestProvider({ availableModels: [] });
            (settingTab as any).editingProvider = editingProvider;
            (settingTab as any).isFormOpen = true;
            settingTab.display();
        });

        it('should show loading state when fetching models', async () => {
            // Start loading
            (settingTab as any).isLoadingModels = true;
            settingTab.display();

            // Find the models dropdown
            const dropdown = containerEl.querySelector('[data-testid="model-dropdown"]');
            const refreshButton = containerEl.querySelector('[data-testid="refresh-models-button"]');
            expect(dropdown).toBeTruthy();
            expect(refreshButton).toBeTruthy();
            expect(dropdown instanceof HTMLSelectElement).toBe(true);
            expect(refreshButton instanceof HTMLButtonElement).toBe(true);

            const select = dropdown as unknown as HTMLSelectElement;
            const button = refreshButton as unknown as HTMLButtonElement;

            // Check loading state
            expect(select.disabled).toBe(true);
            expect(select.querySelector('option')?.value).toBe('loading');

            // Check refresh button is disabled
            expect(button.disabled).toBe(true);
            expect(button.classList.contains('loading')).toBe(true);
        });

        it('should successfully load and display models', async () => {
            // Find the models dropdown and refresh button
            const dropdown = containerEl.querySelector('[data-testid="model-dropdown"]');
            const refreshButton = containerEl.querySelector('[data-testid="refresh-models-button"]');
            expect(dropdown).toBeTruthy();
            expect(refreshButton).toBeTruthy();
            expect(dropdown instanceof HTMLSelectElement).toBe(true);
            expect(refreshButton instanceof HTMLButtonElement).toBe(true);

            const button = refreshButton as unknown as HTMLButtonElement;

            // Mock the fetchModels function to resolve immediately
            const models = ['gpt-4', 'gpt-3.5-turbo'];
            (plugin.aiProviders.fetchModels as jest.Mock).mockImplementationOnce(async () => {
                return models;
            });

            // Simulate click event
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            // Wait for models to load
            await new Promise(resolve => setTimeout(resolve, 0));

            // Update editingProvider with models
            editingProvider.availableModels = models;
            editingProvider.model = models[0];
            (settingTab as any).isLoadingModels = false;

            // Re-render the component
            settingTab.display();

            // Wait for DOM updates
            await new Promise(resolve => setTimeout(resolve, 0));

            // Re-query the elements after re-render
            const updatedDropdown = containerEl.querySelector('[data-testid="model-dropdown"]');
            expect(updatedDropdown).toBeTruthy();
            expect(updatedDropdown instanceof HTMLSelectElement).toBe(true);

            const updatedSelect = updatedDropdown as unknown as HTMLSelectElement;

            // Check models are displayed
            expect(updatedSelect.disabled).toBe(false);
            
            // Verify options
            const options = Array.from(updatedSelect.querySelectorAll('option'));
            expect(options.length).toBe(2);
            expect(options[0].value).toBe('gpt-4');
            expect(options[1].value).toBe('gpt-3.5-turbo');
        });

        it('should handle error when loading models', async () => {
            // Set up provider with error trigger
            editingProvider = createTestProvider({ apiKey: 'error' });
            (settingTab as any).editingProvider = editingProvider;
            (settingTab as any).isFormOpen = true;
            settingTab.display();

            // Find the refresh button
            const refreshButton = containerEl.querySelector('[data-testid="refresh-models-button"]');
            expect(refreshButton).toBeTruthy();
            expect(refreshButton instanceof HTMLButtonElement).toBe(true);

            const button = refreshButton as unknown as HTMLButtonElement;

            // Click refresh button
            button.click();

            // Wait for error to be handled
            await new Promise(resolve => setTimeout(resolve, 0));

            // Re-render after error
            settingTab.display();

            // Find the models dropdown after re-render
            const dropdown = containerEl.querySelector('[data-testid="model-dropdown"]');
            expect(dropdown).toBeTruthy();
            expect(dropdown instanceof HTMLSelectElement).toBe(true);

            const select = dropdown as unknown as HTMLSelectElement;

            // Verify error handling
            expect(select.disabled).toBe(true);
            expect(select.querySelector('option')?.value).toBe('none');

            // Verify refresh button is enabled again
            expect(button.disabled).toBe(false);
            expect(button.classList.contains('loading')).toBe(false);
        });

        it('should handle empty models list', async () => {
            // Mock empty models list
            (plugin.aiProviders.fetchModels as jest.Mock).mockResolvedValueOnce([]);

            // Find the models dropdown and refresh button
            const dropdown = containerEl.querySelector('[data-testid="model-dropdown"]');
            const refreshButton = containerEl.querySelector('[data-testid="refresh-models-button"]');
            expect(dropdown).toBeTruthy();
            expect(refreshButton).toBeTruthy();
            expect(dropdown instanceof HTMLSelectElement).toBe(true);
            expect(refreshButton instanceof HTMLButtonElement).toBe(true);

            const select = dropdown as unknown as HTMLSelectElement;
            const button = refreshButton as unknown as HTMLButtonElement;

            // Click refresh button
            button.click();

            // Wait for models to load
            await new Promise(resolve => setTimeout(resolve, 0));

            // Verify empty state handling
            expect(select.disabled).toBe(true);
            expect(select.querySelector('option')?.value).toBe('none');

            // Verify refresh button is enabled
            expect(button.disabled).toBe(false);
            expect(button.classList.contains('loading')).toBe(false);
        });

        it('should save selected model', async () => {
            // Find the models dropdown
            const dropdown = containerEl.querySelector('[data-testid="model-dropdown"]');
            const refreshButton = containerEl.querySelector('[data-testid="refresh-models-button"]');
            expect(dropdown).toBeTruthy();
            expect(refreshButton).toBeTruthy();
            expect(dropdown instanceof HTMLSelectElement).toBe(true);
            expect(refreshButton instanceof HTMLButtonElement).toBe(true);

            const button = refreshButton as unknown as HTMLButtonElement;

            // Mock the fetchModels function to resolve immediately
            const models = ['gpt-4', 'gpt-3.5-turbo'];
            (plugin.aiProviders.fetchModels as jest.Mock).mockImplementationOnce(async () => {
                return models;
            });

            // Simulate click event
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            // Wait for models to load
            await new Promise(resolve => setTimeout(resolve, 0));

            // Update editingProvider with models
            editingProvider.availableModels = models;
            editingProvider.model = models[0];
            (settingTab as any).isLoadingModels = false;

            // Re-render the component
            settingTab.display();

            // Wait for DOM updates
            await new Promise(resolve => setTimeout(resolve, 0));

            // Re-query the elements after re-render
            const updatedDropdown = containerEl.querySelector('[data-testid="model-dropdown"]');
            expect(updatedDropdown).toBeTruthy();
            expect(updatedDropdown instanceof HTMLSelectElement).toBe(true);

            const updatedSelect = updatedDropdown as unknown as HTMLSelectElement;

            // Select a different model
            const event = new Event('change');
            updatedSelect.value = models[1];
            updatedSelect.dispatchEvent(event);

            // Verify model was updated
            expect(editingProvider.model).toBe(models[1]);
        });

        it('should handle provider type change', async () => {
            // Find the provider type dropdown
            const typeDropdown = containerEl.querySelector('[data-testid="provider-type-dropdown"]');
            expect(typeDropdown).toBeTruthy();
            expect(typeDropdown instanceof HTMLSelectElement).toBe(true);

            const typeSelect = typeDropdown as unknown as HTMLSelectElement;

            // Change provider type
            const event = new Event('change');
            typeSelect.value = 'ollama';
            typeSelect.dispatchEvent(event);

            // Verify URL was updated
            expect(editingProvider.url).toBe('http://localhost:11434');

            // Verify models were cleared
            expect(editingProvider.availableModels).toBeUndefined();
            expect(editingProvider.model).toBeUndefined();
        });
    });

    describe('Form Display Management', () => {
        it('should show main interface when form is closed', async () => {
            plugin.settings.providers = [createTestProvider()];
            settingTab.display();

            const mainInterface = containerEl.querySelector('[data-testid="main-interface"]');
            expect(mainInterface).toBeTruthy();
            expect(mainInterface?.querySelector('[data-testid="add-provider-button"]')).toBeTruthy();
            expect(mainInterface?.textContent).toContain(createTestProvider().name);
        });

        it('should hide main interface when form is open', async () => {
            plugin.settings.providers = [createTestProvider()];
            settingTab.display();

            const mainInterface = containerEl.querySelector('[data-testid="main-interface"]');
            expect(mainInterface).toBeTruthy();

            // Open form
            (settingTab as any).openForm(true);

            // Verify main interface is removed
            expect(containerEl.querySelector('[data-testid="main-interface"]')).toBeFalsy();

            // Verify form is shown
            expect(containerEl.querySelector('[data-testid="provider-form"]')).toBeTruthy();
            expect(containerEl.querySelector('[data-testid="provider-form-title"]')?.textContent)
                .toBe(I18n.t('settings.addNewProvider'));
        });

        it('should restore main interface when form is closed', async () => {
            plugin.settings.providers = [createTestProvider()];
            settingTab.display();

            // Open form
            const addButton = containerEl.querySelector('[data-testid="add-provider-button"]');
            addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            // Close form
            const cancelButton = containerEl.querySelector('[data-testid="cancel-button"]');
            cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            // Verify main interface is restored
            const mainInterface = containerEl.querySelector('[data-testid="main-interface"]');
            expect(mainInterface).toBeTruthy();
            expect(mainInterface?.querySelector('[data-testid="add-provider-button"]')).toBeTruthy();
            expect(mainInterface?.textContent).toContain(createTestProvider().name);
        });

        it('should show correct header when adding new provider', async () => {
            settingTab.display();
            
            // Open form for new provider
            (settingTab as any).openForm(true);
            
            // Verify form header
            expect(containerEl.querySelector('h2')?.textContent).toBe(I18n.t('settings.addNewProvider'));
        });

        it('should show correct header when editing provider', async () => {
            // Add a provider to edit
            plugin.settings.providers = [createTestProvider()];
            settingTab.display();
            
            // Open form for editing
            (settingTab as any).openForm(false, createTestProvider());
            
            // Verify form header
            expect(containerEl.querySelector('h2')?.textContent).toBe(I18n.t('settings.editProvider'));
        });
    });
}); 