import type { Mock, MockInstance } from 'vitest';
import { App } from 'obsidian';
import type { IAIProvider } from '@obsidian-ai-providers/sdk';
import { AIProvidersService } from './AIProvidersService';
import type AIProvidersPlugin from './main';
import { ConfirmationModal } from './modals/ConfirmationModal';

vi.mock('./handlers/OpenAIHandler');
vi.mock('./handlers/OllamaHandler');
vi.mock('./handlers/AnthropicHandler');

describe('migrateProvider with the real ConfirmationModal', () => {
    let service: AIProvidersService;
    let plugin: {
        settings: { providers: IAIProvider[]; _version: number };
        saveSettings: Mock<() => Promise<void>>;
    };
    let provider: IAIProvider;
    let existingProvider: IAIProvider;
    let openModal: MockInstance<() => void>;

    beforeEach(() => {
        provider = {
            id: 'new-provider',
            name: 'New Provider',
            type: 'openai',
            model: 'new-model',
        };
        existingProvider = {
            id: 'existing-provider',
            name: 'Existing Provider',
            type: 'openai',
            model: 'existing-model',
        };
        plugin = {
            settings: { providers: [existingProvider], _version: 1 },
            saveSettings: vi.fn().mockResolvedValue(undefined),
        };
        service = new AIProvidersService(
            new App(),
            plugin as unknown as AIProvidersPlugin
        );
        openModal = vi.spyOn(ConfirmationModal.prototype, 'open');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each(['external close', 'cancel button'])(
        'resolves false without changing or saving providers on %s',
        async dismissal => {
            const providers = plugin.settings.providers;
            const result = service.migrateProvider(provider);
            const onSettled = vi.fn();
            void result.then(onSettled);
            const modal = openModal.mock.contexts[0] as ConfirmationModal;
            expect(modal).toBeInstanceOf(ConfirmationModal);
            const [confirmButton, cancelButton] =
                modal.contentEl.querySelectorAll('button');

            if (dismissal === 'cancel button') {
                cancelButton.click();
            } else {
                modal.close();
            }
            modal.close();
            expect(plugin.saveSettings).not.toHaveBeenCalled();
            expect(providers).toEqual([existingProvider]);

            await vi.waitFor(() =>
                expect(onSettled).toHaveBeenCalledExactlyOnceWith(false)
            );
            await expect(result).resolves.toBe(false);
            confirmButton.click();
            expect(plugin.settings.providers).toBe(providers);
            expect(providers).toEqual([existingProvider]);
            expect(service.providers).toBe(providers);
            expect(plugin.saveSettings).not.toHaveBeenCalled();
            expect(modal.contentEl.childNodes.length).toBe(0);
        }
    );

    it('confirms once and resolves with the provider only after saving finishes', async () => {
        let finishSave!: () => void;
        plugin.saveSettings.mockReturnValue(
            new Promise<void>(resolve => {
                finishSave = resolve;
            })
        );
        const result = service.migrateProvider(provider);
        const onSettled = vi.fn();
        void result.then(onSettled);
        const modal = openModal.mock.contexts[0] as ConfirmationModal;
        const [confirmButton, cancelButton] =
            modal.contentEl.querySelectorAll('button');

        confirmButton.click();
        confirmButton.click();
        cancelButton.click();
        modal.close();

        // Drain promise callbacks while saveSettings is still pending.
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(onSettled).not.toHaveBeenCalled();
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(plugin.settings.providers).toEqual([existingProvider, provider]);
        expect(modal.contentEl.childNodes.length).toBe(0);

        finishSave();
        await expect(result).resolves.toBe(provider);
        expect(onSettled).toHaveBeenCalledExactlyOnceWith(provider);
    });
});
