import { App, Notice, Platform } from 'obsidian';
import { IAIModelCapabilities, IAIProvider } from '@obsidian-ai-providers/sdk';
import AIProvidersPlugin from '../main';
import { AIProvidersService } from '../AIProvidersService';
import { AIProvidersSettingTab } from '../settings';
import { probeModelCapabilities } from '../utils/modelCapabilityChecker';
import { ProviderFormModal } from './ProviderFormModal';

vi.mock('../i18n', () => ({ I18n: { t: (key: string) => key } }));
vi.mock('../utils/modelCapabilityChecker', () => ({
    probeModelCapabilities: vi.fn(),
}));
vi.mock('obsidian', async importOriginal => ({
    ...(await importOriginal<typeof import('obsidian')>()),
    Notice: vi.fn(),
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

const capabilities: IAIModelCapabilities = {
    text: true,
    tools: true,
    vision: true,
    embedding: true,
};
const unchecked: IAIModelCapabilities = {
    text: false,
    tools: false,
    vision: false,
    embedding: false,
};
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('ProviderFormModal request and control isolation', () => {
    let app: App;
    let plugin: AIProvidersPlugin;
    let provider: IAIProvider;
    let modal: ProviderFormModal;

    function element<T extends HTMLElement>(selector: string): T {
        const found = modal.contentEl.querySelector(selector);
        if (!found) throw new Error(`Missing control: ${selector}`);
        return found as unknown as T;
    }

    function edit(selector: string, value: string) {
        const control = element<HTMLInputElement | HTMLSelectElement>(selector);
        control.value = value;
        control.dispatchEvent(
            new Event(control.tagName === 'SELECT' ? 'change' : 'input')
        );
    }

    function click(testId: string) {
        element<HTMLButtonElement>(`[data-testid="${testId}"]`).click();
    }

    function changeType(value: string) {
        edit('[data-testid="provider-type-dropdown"]', value);
    }

    function toggleTools(value: boolean) {
        const control = element<HTMLInputElement>(
            '[data-testid="model-capability-tools"]'
        );
        control.checked = value;
        control.dispatchEvent(new Event('change'));
    }

    function expectProbeIdle() {
        expect(
            element<HTMLButtonElement>(
                '[data-testid="check-model-capabilities"]'
            ).disabled
        ).toBe(false);
        expect(modal.contentEl.textContent).not.toContain(
            'settings.modelCapabilitiesChecking'
        );
    }

    beforeEach(() => {
        vi.clearAllMocks();
        (Platform as any).isMobileApp = false;
        app = new App();
        plugin = new AIProvidersPlugin(app, {
            id: 'fixture',
            name: 'Fixture',
            version: '1',
            minAppVersion: '1',
            author: 'Fixture',
            description: 'Synthetic provider tests',
        });
        provider = {
            id: 'fixture-provider',
            name: 'OpenAI',
            type: 'openai',
            url: 'https://provider.invalid/v1',
            apiKey: 'synthetic-key',
            model: 'model-a',
            availableModels: ['model-a', 'model-b'],
        };
        plugin.settings = {
            providers: [{ ...provider }],
            _version: 1,
            debugLogging: false,
            useNativeFetch: false,
        };
        plugin.aiProviders = new AIProvidersService(app, plugin);
        vi.spyOn(plugin.aiProviders, 'fetchModels').mockResolvedValue([]);
        vi.spyOn(plugin, 'saveSettings').mockResolvedValue(undefined);
        modal = new ProviderFormModal(app, plugin, provider, vi.fn(), true);
    });

    afterEach(() => {
        modal.onClose();
        modal.contentEl.remove();
        (Platform as any).isMobileApp = false;
        vi.restoreAllMocks();
    });

    it.each(['typing', 'suggestion', 'mobile', 'text-only'])(
        'discards a probe after a model change through %s',
        async mode => {
            const request = deferred<IAIModelCapabilities>();
            vi.mocked(probeModelCapabilities).mockReturnValueOnce(
                request.promise
            );
            (Platform as any).isMobileApp = mode === 'mobile';
            if (mode === 'text-only') provider.type = 'ai302';
            modal.onOpen();
            if (mode === 'suggestion') {
                edit('[data-testid="model-combobox-input"]', 'model');
                await flush();
            }
            click('check-model-capabilities');
            if (mode === 'suggestion') {
                element<HTMLElement>('[data-value="model-b"]').dispatchEvent(
                    new MouseEvent('mousedown')
                );
            } else {
                edit(
                    mode === 'mobile'
                        ? '[data-testid="model-select"]'
                        : mode === 'text-only'
                          ? '[data-testid="model-input"]'
                          : '[data-testid="model-combobox-input"]',
                    'model-b'
                );
            }
            expect(provider.model).toBe('model-b');
            expectProbeIdle();
            request.resolve(capabilities);
            await flush();
            expect(provider.modelCapabilities).toBeUndefined();
            expect(
                plugin.settings.providers?.[0].modelCapabilities
            ).toBeUndefined();
            expect(plugin.saveSettings).not.toHaveBeenCalled();
            expect(modal.contentEl.textContent).not.toContain(
                'settings.modelCapabilitiesUpdated'
            );
        }
    );

    it.each(['type', 'url', 'key'])(
        'invalidates both requests after %s changes and captures stable inputs',
        async field => {
            const probe = deferred<IAIModelCapabilities>();
            const refresh = deferred<string[]>();
            vi.mocked(probeModelCapabilities).mockReturnValueOnce(
                probe.promise
            );
            vi.mocked(plugin.aiProviders.fetchModels).mockReturnValueOnce(
                refresh.promise
            );
            modal.onOpen();
            click('check-model-capabilities');
            click('refresh-models-button');
            const probeInput = vi.mocked(probeModelCapabilities).mock
                .calls[0][0].provider;
            const refreshInput = vi.mocked(plugin.aiProviders.fetchModels).mock
                .calls[0][0];
            const before = { ...provider };
            if (field === 'type') changeType('ollama');
            if (field === 'url')
                edit(
                    '[data-field="provider-url"]',
                    'https://changed.invalid/v1'
                );
            if (field === 'key')
                edit(
                    '[placeholder="settings.apiKeyPlaceholder"]',
                    'synthetic-replacement'
                );
            expect(probeInput).not.toBe(provider);
            expect(refreshInput).not.toBe(provider);
            expect(probeInput).toEqual(before);
            expect(refreshInput).toEqual(before);
            expect(
                element<HTMLButtonElement>(
                    '[data-testid="refresh-models-button"]'
                ).disabled
            ).toBe(false);
            probe.resolve(capabilities);
            refresh.resolve(['stale-model']);
            await flush();
            expect(provider.modelCapabilities).toBeUndefined();
            expect(provider.availableModels).toEqual(
                field === 'type' ? undefined : before.availableModels
            );
            expect(provider.model).toBe(
                field === 'type' ? undefined : before.model
            );
            expect(plugin.saveSettings).not.toHaveBeenCalled();
            expect(Notice).not.toHaveBeenCalled();
        }
    );

    it('keeps manual capability edits when an earlier probe finishes', async () => {
        const probe = deferred<IAIModelCapabilities>();
        vi.mocked(probeModelCapabilities).mockReturnValueOnce(probe.promise);
        modal.onOpen();
        click('check-model-capabilities');
        toggleTools(true);
        expectProbeIdle();
        probe.resolve(unchecked);
        await flush();
        expect(provider.modelCapabilities?.['model-a']).toEqual({
            ...unchecked,
            tools: true,
        });
        expect(
            plugin.settings.providers?.[0].modelCapabilities?.['model-a']
        ).toEqual({ ...unchecked, tools: true });
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    });

    it.each([
        { focused: true, pending: false },
        { focused: false, pending: false },
        { focused: true, pending: true },
        { focused: false, pending: true },
    ])(
        'preserves focus on manual capability edit with focused=$focused, pending=$pending',
        async ({ focused, pending }) => {
            const probe = deferred<IAIModelCapabilities>();
            vi.mocked(probeModelCapabilities).mockReturnValueOnce(
                probe.promise
            );
            document.body.appendChild(modal.contentEl as unknown as Node);
            modal.onOpen();
            if (pending) click('check-model-capabilities');
            const checkbox = element<HTMLInputElement>(
                '[data-testid="model-capability-tools"]'
            );
            const focusTarget = focused
                ? checkbox
                : element<HTMLInputElement>('[data-field="provider-name"]');
            focusTarget.focus();
            expect(document.activeElement).toBe(focusTarget);
            toggleTools(true);
            const currentCheckbox = element<HTMLInputElement>(
                '[data-testid="model-capability-tools"]'
            );
            expect(document.activeElement).toBe(
                focused ? currentCheckbox : focusTarget
            );
            expect(currentCheckbox.checked).toBe(true);
            expectProbeIdle();
            probe.resolve(unchecked);
            await flush();
            expect(document.activeElement).toBe(
                focused ? currentCheckbox : focusTarget
            );
            expect(provider.modelCapabilities?.['model-a'].tools).toBe(true);
            expect(
                plugin.settings.providers?.[0].modelCapabilities?.['model-a']
                    .tools
            ).toBe(true);
        }
    );

    it('does not restore checkbox focus when immediate persistence closes the modal', () => {
        document.body.appendChild(modal.contentEl as unknown as Node);
        modal.onOpen();
        element<HTMLInputElement>(
            '[data-testid="model-capability-tools"]'
        ).focus();
        vi.mocked(plugin.saveSettings).mockImplementationOnce(async () =>
            modal.close()
        );
        toggleTools(true);
        expect(modal.contentEl.children).toHaveLength(0);
        expect(document.activeElement).toBe(document.body);
    });

    it.each(['success', 'failure'])(
        'does not let replaced probe %s clear a newer check',
        async outcome => {
            const old = deferred<IAIModelCapabilities>();
            const current = deferred<IAIModelCapabilities>();
            vi.mocked(probeModelCapabilities)
                .mockReturnValueOnce(old.promise)
                .mockReturnValueOnce(current.promise);
            modal.onOpen();
            click('check-model-capabilities');
            edit('[data-testid="model-combobox-input"]', 'model-b');
            edit('[data-testid="model-combobox-input"]', 'model-a');
            click('check-model-capabilities');
            expect(probeModelCapabilities).toHaveBeenCalledTimes(2);
            if (outcome === 'success') old.resolve(unchecked);
            else old.reject(new Error('obsolete probe'));
            await flush();
            expect(
                element<HTMLButtonElement>(
                    '[data-testid="check-model-capabilities"]'
                ).disabled
            ).toBe(true);
            expect(modal.contentEl.textContent).toContain(
                'settings.modelCapabilitiesChecking'
            );
            expect(modal.contentEl.textContent).not.toContain(
                'settings.modelCapabilitiesCheckFailed'
            );
            expect(plugin.saveSettings).not.toHaveBeenCalled();
            current.resolve(capabilities);
            await flush();
            expectProbeIdle();
            expect(provider.modelCapabilities?.['model-a']).toEqual(
                capabilities
            );
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        }
    );

    it.each(['success', 'failure'])(
        'does not let an A→B→A refresh %s replace current controls or loading state',
        async outcome => {
            const old = deferred<string[]>();
            const current = deferred<string[]>();
            vi.mocked(plugin.aiProviders.fetchModels)
                .mockReturnValueOnce(old.promise)
                .mockReturnValueOnce(current.promise);
            modal.onOpen();
            click('refresh-models-button');
            edit('[data-field="provider-url"]', 'https://changed.invalid/v1');
            edit('[data-field="provider-url"]', 'https://provider.invalid/v1');
            click('refresh-models-button');
            expect(plugin.aiProviders.fetchModels).toHaveBeenCalledTimes(2);
            if (outcome === 'success') old.resolve(['obsolete']);
            else old.reject(new Error('obsolete refresh'));
            await flush();
            expect(
                element<HTMLButtonElement>(
                    '[data-testid="refresh-models-button"]'
                ).disabled
            ).toBe(true);
            expect(
                element<HTMLInputElement>(
                    '[data-testid="model-combobox-input"]'
                ).placeholder
            ).toBe('settings.loadingModels');
            expect(provider.availableModels).toEqual(['model-a', 'model-b']);
            expect(Notice).not.toHaveBeenCalled();
            current.resolve(['current', 'model-a']);
            await flush();
            expect(provider.availableModels).toEqual(['current', 'model-a']);
            expect(provider.model).toBe('current');
            expect(
                element<HTMLInputElement>(
                    '[data-testid="model-combobox-input"]'
                ).title
            ).toBe('current');
            expect(Notice).toHaveBeenCalledExactlyOnceWith(
                'settings.modelsUpdated'
            );
        }
    );

    it.each(['success', 'failure'])(
        'preserves newer results when replaced requests settle last with %s',
        async outcome => {
            const oldProbe = deferred<IAIModelCapabilities>();
            const oldRefresh = deferred<string[]>();
            vi.mocked(probeModelCapabilities)
                .mockReturnValueOnce(oldProbe.promise)
                .mockResolvedValueOnce(capabilities);
            vi.mocked(plugin.aiProviders.fetchModels)
                .mockReturnValueOnce(oldRefresh.promise)
                .mockResolvedValueOnce(['model-a', 'current']);
            modal.onOpen();
            click('check-model-capabilities');
            click('refresh-models-button');
            edit(
                '[placeholder="settings.apiKeyPlaceholder"]',
                'synthetic-replacement'
            );
            edit('[placeholder="settings.apiKeyPlaceholder"]', 'synthetic-key');
            click('check-model-capabilities');
            click('refresh-models-button');
            await flush();
            expect(provider.modelCapabilities?.['model-a']).toEqual(
                capabilities
            );
            expect(provider.availableModels).toEqual(['model-a', 'current']);
            if (outcome === 'success') {
                oldProbe.resolve(unchecked);
                oldRefresh.resolve(['obsolete']);
            } else {
                oldProbe.reject(new Error('obsolete probe'));
                oldRefresh.reject(new Error('obsolete refresh'));
            }
            await flush();
            expect(provider.modelCapabilities?.['model-a']).toEqual(
                capabilities
            );
            expect(provider.availableModels).toEqual(['model-a', 'current']);
            expect(modal.contentEl.textContent).toContain(
                'settings.modelCapabilitiesUpdated'
            );
            expect(modal.contentEl.textContent).not.toContain(
                'settings.modelCapabilitiesCheckFailed'
            );
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
            expect(Notice).toHaveBeenCalledExactlyOnceWith(
                'settings.modelsUpdated'
            );
        }
    );

    it.each(['success', 'failure'])(
        'keeps new requests loading after identical-config reopen and old %s',
        async outcome => {
            const oldProbe = deferred<IAIModelCapabilities>();
            const oldRefresh = deferred<string[]>();
            const newProbe = deferred<IAIModelCapabilities>();
            const newRefresh = deferred<string[]>();
            vi.mocked(probeModelCapabilities)
                .mockReturnValueOnce(oldProbe.promise)
                .mockReturnValueOnce(newProbe.promise);
            vi.mocked(plugin.aiProviders.fetchModels)
                .mockReturnValueOnce(oldRefresh.promise)
                .mockReturnValueOnce(newRefresh.promise);
            modal.onOpen();
            click('check-model-capabilities');
            click('refresh-models-button');
            modal.onClose();
            modal.onOpen();
            click('check-model-capabilities');
            click('refresh-models-button');
            if (outcome === 'success') {
                oldProbe.resolve(unchecked);
                oldRefresh.resolve(['obsolete']);
            } else {
                oldProbe.reject(new Error('closed probe'));
                oldRefresh.reject(new Error('closed refresh'));
            }
            await flush();
            expect(
                element<HTMLButtonElement>(
                    '[data-testid="check-model-capabilities"]'
                ).disabled
            ).toBe(true);
            expect(
                element<HTMLButtonElement>(
                    '[data-testid="refresh-models-button"]'
                ).disabled
            ).toBe(true);
            expect(plugin.saveSettings).not.toHaveBeenCalled();
            expect(Notice).not.toHaveBeenCalled();
            newProbe.resolve(capabilities);
            newRefresh.resolve(['model-a', 'current']);
            await flush();
            expectProbeIdle();
            expect(provider.modelCapabilities?.['model-a']).toEqual(
                capabilities
            );
            expect(provider.availableModels).toEqual(['model-a', 'current']);
        }
    );

    it.each([false, true])(
        'discards both requests on close, including identical-config reopen=%s',
        async reopen => {
            const probe = deferred<IAIModelCapabilities>();
            const refresh = deferred<string[]>();
            vi.mocked(probeModelCapabilities).mockReturnValueOnce(
                probe.promise
            );
            vi.mocked(plugin.aiProviders.fetchModels).mockReturnValueOnce(
                refresh.promise
            );
            modal.onOpen();
            click('check-model-capabilities');
            click('refresh-models-button');
            modal.onClose();
            if (reopen) modal.onOpen();
            probe.resolve(capabilities);
            refresh.resolve(['obsolete']);
            await flush();
            expect(provider.model).toBe('model-a');
            expect(provider.availableModels).toEqual(['model-a', 'model-b']);
            expect(provider.modelCapabilities).toBeUndefined();
            expect(plugin.saveSettings).not.toHaveBeenCalled();
            expect(Notice).not.toHaveBeenCalled();
            if (reopen) {
                expectProbeIdle();
                expect(
                    element<HTMLInputElement>(
                        '[data-testid="model-combobox-input"]'
                    ).disabled
                ).toBe(false);
            } else expect(modal.contentEl.children).toHaveLength(0);
        }
    );

    it.each([false, true])(
        'rebuilds provider-specific controls and removes old suggestions on mobile=%s',
        async mobile => {
            (Platform as any).isMobileApp = mobile;
            modal.onOpen();
            if (!mobile) {
                edit('[data-testid="model-combobox-input"]', 'model');
                await flush();
                expect(
                    modal.contentEl.querySelector('[data-value="model-a"]')
                ).not.toBeNull();
            }
            changeType('ollama');
            const selector = mobile
                ? '[data-testid="model-select"]'
                : '[data-testid="model-combobox-input"]';
            const control = element<HTMLInputElement | HTMLSelectElement>(
                selector
            );
            expect(control.value).toBe('');
            expect(control.disabled).toBe(true);
            expect(
                modal.contentEl.querySelector('[data-value="model-a"]')
            ).toBeNull();
            if (mobile)
                expect(
                    Array.from((control as HTMLSelectElement).options).map(
                        option => option.value
                    )
                ).toEqual(['']);
            else {
                expect(control.title).toBe('');
                expect((control as HTMLInputElement).placeholder).toBe(
                    'settings.noModelsAvailable'
                );
            }
            expect(provider.model).toBeUndefined();
            changeType('ai302');
            expect(
                element<HTMLInputElement>('[data-testid="model-input"]').value
            ).toBe('');
            expect(
                modal.contentEl.querySelector(
                    '[data-testid="refresh-models-button"]'
                )
            ).toBeNull();
            changeType('openai');
            expect(
                element<HTMLInputElement | HTMLSelectElement>(selector).value
            ).toBe('');
        }
    );

    it.each([false, true])(
        'refreshes the rendered model options on mobile=%s',
        async mobile => {
            (Platform as any).isMobileApp = mobile;
            const request = deferred<string[]>();
            vi.mocked(plugin.aiProviders.fetchModels).mockReturnValueOnce(
                request.promise
            );
            modal.onOpen();
            click('refresh-models-button');
            const selector = mobile
                ? '[data-testid="model-select"]'
                : '[data-testid="model-combobox-input"]';
            expect(
                element<HTMLInputElement | HTMLSelectElement>(selector).disabled
            ).toBe(true);
            request.resolve(['new-first', 'new-second']);
            await flush();
            const control = element<HTMLInputElement | HTMLSelectElement>(
                selector
            );
            expect(control.disabled).toBe(false);
            expect(control.value).toBe('new-first');
            if (mobile) {
                expect(
                    Array.from((control as HTMLSelectElement).options).map(
                        option => option.value
                    )
                ).toEqual(['', 'new-first', 'new-second']);
            } else {
                expect(control.title).toBe('new-first');
                edit(selector, '');
                await flush();
                expect(
                    Array.from(
                        modal.contentEl.querySelectorAll(
                            '[data-testid="model-suggestion"]'
                        )
                    ).map(suggestion => suggestion.textContent)
                ).toEqual(['new-first', 'new-second']);
            }
        }
    );

    it.each(['success', 'empty', 'failure'])(
        'preserves custom fields through refresh %s and multiple input-mode changes',
        async result => {
            const request = deferred<string[]>();
            vi.mocked(plugin.aiProviders.fetchModels).mockReturnValueOnce(
                request.promise
            );
            modal.onOpen();
            edit('[data-field="provider-name"]', 'Custom fixture');
            edit('[data-field="provider-url"]', 'https://custom.invalid');
            click('refresh-models-button');
            if (result === 'failure')
                request.reject(new Error('expected failure'));
            else request.resolve(result === 'empty' ? [] : ['new-model']);
            await flush();
            expect(provider.model).toBe(
                result === 'success' ? 'new-model' : 'model-a'
            );
            expect(
                element<HTMLInputElement>(
                    '[data-testid="model-combobox-input"]'
                ).disabled
            ).toBe(result === 'empty');
            for (const type of ['ai302', 'ollama', 'openai']) {
                changeType(type);
                expect(provider.name).toBe('Custom fixture');
                expect(provider.url).toBe('https://custom.invalid');
                expect(
                    element<HTMLInputElement>('[data-field="provider-name"]')
                        .value
                ).toBe('Custom fixture');
                expect(
                    element<HTMLInputElement>('[data-field="provider-url"]')
                        .value
                ).toBe('https://custom.invalid');
            }
        }
    );

    it.each(['same', 'different', 'empty'])(
        'keeps refresh and probe independent until refresh selects a %s model',
        async selected => {
            const probe = deferred<IAIModelCapabilities>();
            const refresh = deferred<string[]>();
            vi.mocked(probeModelCapabilities).mockReturnValueOnce(
                probe.promise
            );
            vi.mocked(plugin.aiProviders.fetchModels).mockReturnValueOnce(
                refresh.promise
            );
            modal.onOpen();
            click('check-model-capabilities');
            click('refresh-models-button');
            edit('[data-field="provider-name"]', 'Renamed fixture');
            refresh.resolve(
                selected === 'empty'
                    ? []
                    : [selected === 'same' ? 'model-a' : 'model-b']
            );
            await flush();
            expect(
                element<HTMLButtonElement>(
                    '[data-testid="check-model-capabilities"]'
                ).disabled
            ).toBe(selected !== 'different');
            probe.resolve(capabilities);
            await flush();
            expect(provider.modelCapabilities).toEqual(
                selected === 'different'
                    ? undefined
                    : { 'model-a': capabilities }
            );
            expect(plugin.saveSettings).toHaveBeenCalledTimes(
                selected === 'different' ? 0 : 1
            );
        }
    );

    it('allows a valid probe to complete without cancelling an active refresh', async () => {
        const probe = deferred<IAIModelCapabilities>();
        const refresh = deferred<string[]>();
        vi.mocked(probeModelCapabilities).mockReturnValueOnce(probe.promise);
        vi.mocked(plugin.aiProviders.fetchModels).mockReturnValueOnce(
            refresh.promise
        );
        modal.onOpen();
        click('refresh-models-button');
        click('check-model-capabilities');
        probe.resolve(capabilities);
        await flush();
        expect(
            element<HTMLButtonElement>('[data-testid="refresh-models-button"]')
                .disabled
        ).toBe(true);
        refresh.resolve(['model-a']);
        await flush();
        expect(provider.modelCapabilities?.['model-a']).toEqual(capabilities);
        expect(provider.availableModels).toEqual(['model-a']);
    });

    it('does not invalidate a probe when the model input emits the unchanged value', async () => {
        const probe = deferred<IAIModelCapabilities>();
        vi.mocked(probeModelCapabilities).mockReturnValueOnce(probe.promise);
        modal.onOpen();
        click('check-model-capabilities');
        edit('[data-testid="model-combobox-input"]', 'model-a');
        probe.resolve(capabilities);
        await flush();
        expect(provider.modelCapabilities?.['model-a']).toEqual(capabilities);
    });

    it.each([true, false])(
        'isolates duplicate capabilities while editing duplicate first=%s',
        async duplicateFirst => {
            provider.modelCapabilities = { 'model-a': { ...unchecked } };
            plugin.settings.providers = [provider];
            const tab = new AIProvidersSettingTab(app, plugin);
            await tab.duplicateProvider(provider);
            const duplicate = plugin.settings.providers![1];
            const [first, second] = duplicateFirst
                ? [duplicate, provider]
                : [provider, duplicate];
            const unchanged = JSON.stringify(second);
            modal = new ProviderFormModal(app, plugin, { ...first }, vi.fn());
            modal.onOpen();
            toggleTools(true);
            expect(JSON.stringify(second)).toBe(unchanged);
            expect(first.modelCapabilities?.['model-a'].tools).toBe(true);
            modal.onClose();
            modal = new ProviderFormModal(app, plugin, { ...second }, vi.fn());
            modal.onOpen();
            const vision = element<HTMLInputElement>(
                '[data-testid="model-capability-vision"]'
            );
            vision.checked = true;
            vision.dispatchEvent(new Event('change'));
            expect(first.modelCapabilities?.['model-a']).toEqual({
                ...unchecked,
                tools: true,
            });
            expect(second.modelCapabilities?.['model-a']).toEqual({
                ...unchecked,
                vision: true,
            });
        }
    );

    it('keeps capabilities local for an unsaved provider with no capability map', async () => {
        plugin.settings.providers = [];
        vi.mocked(probeModelCapabilities).mockResolvedValueOnce(capabilities);
        modal.onOpen();
        toggleTools(true);
        click('check-model-capabilities');
        await flush();
        expect(provider.modelCapabilities).toEqual({ 'model-a': capabilities });
        expect(plugin.settings.providers).toEqual([]);
        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });
    it.each([
        ['zai', 'glm-5.3-flash', 'low'],
        ['openai', 'gpt-5', 'minimal'],
        ['openai', 'gpt-5.2', 'none'],
        ['openai', 'gpt-5.2', 'xhigh'],
        ['openai', 'gpt-5.6-sol', 'max'],
    ] as const)(
        'persists %s / %s / %s through Check and isolates duplicates',
        async (type, model, mode) => {
            provider.type = type;
            provider.model = model;
            provider.modelCapabilities = { [model]: { ...unchecked } };
            const duplicate = { ...provider, id: 'duplicate' };
            plugin.settings.providers = [{ ...provider }, duplicate];
            modal.onOpen();
            modal.contentEl.ownerDocument.body.appendChild(
                modal.contentEl as unknown as Node
            );
            const low = element<HTMLInputElement>(
                `[data-reasoning-mode="${mode}"]`
            );
            low.focus();
            low.checked = true;
            low.dispatchEvent(new Event('change'));
            expect(document.activeElement).toBe(
                element(`[data-reasoning-mode="${mode}"]`)
            );
            expect(
                plugin.settings.providers[0].modelCapabilities?.[model]
                    .reasoningModes
            ).toEqual([mode]);
            expect(
                duplicate.modelCapabilities?.[model].reasoningModes
            ).toBeUndefined();
            expect(plugin.saveSettings).toHaveBeenCalled();
            vi.mocked(probeModelCapabilities).mockResolvedValueOnce(
                capabilities
            );
            click('check-model-capabilities');
            await flush();
            expect(provider.modelCapabilities?.[model]).toEqual({
                ...capabilities,
                reasoningModes: [mode],
            });
            const selected = element<HTMLInputElement>(
                `[data-reasoning-mode="${mode}"]`
            );
            selected.checked = false;
            selected.dispatchEvent(new Event('change'));
            expect(provider.modelCapabilities?.[model].reasoningModes).toEqual(
                []
            );
        }
    );

    it('mode edits cancel stale checks and preserve other selections on unsaved providers', async () => {
        provider.type = 'zai';
        provider.model = 'glm-5.3-flash';
        provider.modelCapabilities = {
            'glm-5.3-flash': { ...unchecked, reasoningModes: ['high'] },
        };
        plugin.settings.providers = [];
        const request = deferred<IAIModelCapabilities>();
        vi.mocked(probeModelCapabilities).mockReturnValueOnce(request.promise);
        modal.onOpen();
        click('check-model-capabilities');
        const low = element<HTMLInputElement>('[data-reasoning-mode="low"]');
        low.checked = true;
        low.dispatchEvent(new Event('change'));
        expectProbeIdle();
        request.resolve(capabilities);
        await flush();
        expect(provider.modelCapabilities?.['glm-5.3-flash']).toEqual({
            ...unchecked,
            reasoningModes: ['high', 'low'],
        });
        expect(plugin.saveSettings).not.toHaveBeenCalled();
        changeType('anthropic');
        expect(
            modal.contentEl.querySelector('[data-reasoning-mode]')
        ).toBeNull();
        expect(provider.modelCapabilities).toBeUndefined();
    });
});
