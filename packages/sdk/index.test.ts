import type { Mock } from 'vitest';
import { sanitizeHTMLToDom } from 'obsidian';

// Mock Obsidian modules
vi.mock('obsidian', () => ({
    Plugin: class MockPlugin {
        app: any;
        manifest: any;
        constructor(app: any, manifest: any) {
            this.app = app;
            this.manifest = manifest;
        }
        addSettingTab = vi.fn();
        registerEvent = vi.fn();
    },
    PluginSettingTab: class MockPluginSettingTab {
        app: any;
        plugin: any;
        containerEl: any;
        constructor(app: any, plugin: any) {
            this.app = app;
            this.plugin = plugin;
            this.containerEl = document.createElement('div');
            this.containerEl.empty = function () {
                while (this.firstChild) {
                    this.removeChild(this.firstChild);
                }
            };
            this.containerEl.createEl = function (tag: string) {
                const el = document.createElement(tag);
                (el as any).addClass = function (className: string) {
                    this.classList.add(className);
                };
                this.appendChild(el);
                return el;
            };
            this.containerEl.createDiv = function (className?: string) {
                const el = document.createElement('div');
                if (className) {
                    el.className = className;
                }
                (el as any).addClass = function (className: string) {
                    this.classList.add(className);
                };
                this.appendChild(el);
                return el;
            };
        }
    },
    sanitizeHTMLToDom: vi.fn().mockReturnValue(document.createElement('div')),
}));

describe('initAI', () => {
    let mockApp: any;
    let mockPlugin: any;
    let mockCallback: Mock;
    let readyHandler: (() => void) | null = null;

    beforeEach(() => {
        vi.resetModules();
    });

    beforeEach(() => {
        mockApp = {
            workspace: {
                on: vi.fn((event: string, handler: () => void) => {
                    if (event === 'ai-providers-ready') {
                        readyHandler = handler;
                    }
                    return { off: vi.fn() };
                }),
                off: vi.fn(),
            },
            plugins: {
                disablePlugin: vi.fn(),
                enablePlugin: vi.fn(),
            },
        };
        mockPlugin = {
            app: mockApp,
            manifest: { id: 'test-plugin' },
            addSettingTab: vi.fn(),
            registerEvent: vi.fn(),
        };
        mockCallback = vi.fn();
        readyHandler = null;
        vi.clearAllMocks();
        (sanitizeHTMLToDom as unknown as Mock).mockReturnValue(
            document.createElement('div')
        );
    });

    describe('fallback timeout lifecycle', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it('cancels the pending fallback when the shared wait is canceled before the deadline', async () => {
            const { initAI, waitForAI } = await import('./index');
            const initResult = initAI(mockApp, mockPlugin, mockCallback).catch(
                error => error
            );
            const resolver = await waitForAI();
            expect(await waitForAI()).toBe(resolver);
            const waitResult = resolver.promise.catch(error => error);

            await vi.advanceTimersByTimeAsync(99);
            resolver.cancel();
            const error = await waitResult;
            expect(error).toEqual(
                new Error('Waiting for AI Providers was cancelled')
            );
            expect(await initResult).toBe(error);
            const remainingTimers = vi.getTimerCount();
            await vi.advanceTimersByTimeAsync(100);

            expect(mockPlugin.addSettingTab).not.toHaveBeenCalled();
            expect(mockCallback).not.toHaveBeenCalled();
            expect(mockApp.plugins.disablePlugin).not.toHaveBeenCalled();
            expect(mockApp.plugins.enablePlugin).not.toHaveBeenCalled();
            expect(remainingTimers).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('clears the fallback at readiness even while the callback is pending', async () => {
            const { initAI } = await import('./index');
            let finishCallback!: () => void;
            mockCallback.mockReturnValue(
                new Promise<void>(resolve => {
                    finishCallback = resolve;
                })
            );
            const initPromise = initAI(mockApp, mockPlugin, mockCallback);
            await vi.advanceTimersByTimeAsync(99);
            mockApp.aiProviders = { checkCompatibility: vi.fn() };
            readyHandler!();
            await vi.advanceTimersByTimeAsync(0);

            expect(mockCallback).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
            await vi.advanceTimersByTimeAsync(100);
            expect(mockPlugin.addSettingTab).not.toHaveBeenCalled();
            finishCallback();
            await initPromise;

            expect(mockApp.plugins.disablePlugin).not.toHaveBeenCalled();
            expect(mockApp.plugins.enablePlugin).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        });

        it.each(['ready', 'canceled'])(
            'still reloads after the fallback when waiting ends as %s',
            async outcome => {
                const { initAI, waitForAI } = await import('./index');
                const initResult = initAI(
                    mockApp,
                    mockPlugin,
                    mockCallback
                ).catch(error => error);
                const resolver = await waitForAI();
                const waitResult = resolver.promise.catch(error => error);
                await vi.advanceTimersByTimeAsync(99);
                expect(mockPlugin.addSettingTab).not.toHaveBeenCalled();
                await vi.advanceTimersByTimeAsync(1);
                expect(mockPlugin.addSettingTab).toHaveBeenCalledTimes(1);
                expect(mockCallback).not.toHaveBeenCalled();
                expect(mockApp.plugins.disablePlugin).not.toHaveBeenCalled();

                if (outcome === 'ready') {
                    mockApp.aiProviders = { checkCompatibility: vi.fn() };
                    readyHandler!();
                    expect(await waitResult).toBe(mockApp.aiProviders);
                    expect(await initResult).toBeUndefined();
                    expect(mockCallback).toHaveBeenCalledTimes(1);
                } else {
                    resolver.cancel();
                    const error = await waitResult;
                    expect(error.message).toBe(
                        'Waiting for AI Providers was cancelled'
                    );
                    expect(await initResult).toBe(error);
                    expect(mockCallback).not.toHaveBeenCalled();
                }

                expect(
                    mockApp.plugins.disablePlugin
                ).toHaveBeenCalledExactlyOnceWith(mockPlugin.manifest.id);
                expect(
                    mockApp.plugins.enablePlugin
                ).toHaveBeenCalledExactlyOnceWith(mockPlugin.manifest.id);
                expect(
                    mockApp.plugins.disablePlugin.mock.invocationCallOrder[0]
                ).toBeLessThan(
                    mockApp.plugins.enablePlugin.mock.invocationCallOrder[0]
                );
                expect(vi.getTimerCount()).toBe(0);
            }
        );

        it('finishes after showing fallback when app.plugins is absent', async () => {
            const { initAI } = await import('./index');
            delete mockApp.plugins;
            const initPromise = initAI(mockApp, mockPlugin, mockCallback);
            await vi.advanceTimersByTimeAsync(100);
            mockApp.aiProviders = { checkCompatibility: vi.fn() };
            readyHandler!();
            await expect(initPromise).resolves.toBeUndefined();

            expect(mockPlugin.addSettingTab).toHaveBeenCalledTimes(1);
            expect(mockCallback).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        });

        it.each([0, 100])(
            'preserves callback rejection and reload behavior after waiting %i ms',
            async delay => {
                const { initAI } = await import('./index');
                const error = new Error('callback failed');
                mockCallback.mockRejectedValue(error);
                const initResult = initAI(
                    mockApp,
                    mockPlugin,
                    mockCallback
                ).catch(error => error);
                await vi.advanceTimersByTimeAsync(delay);
                mockApp.aiProviders = { checkCompatibility: vi.fn() };
                readyHandler!();
                expect(await initResult).toBe(error);
                expect(vi.getTimerCount()).toBe(0);
                await vi.advanceTimersByTimeAsync(100);

                expect(mockCallback).toHaveBeenCalledTimes(1);
                const expectedReloads = delay === 100 ? 1 : 0;
                expect(mockPlugin.addSettingTab).toHaveBeenCalledTimes(
                    expectedReloads
                );
                expect(mockApp.plugins.disablePlugin).toHaveBeenCalledTimes(
                    expectedReloads
                );
                expect(mockApp.plugins.enablePlugin).toHaveBeenCalledTimes(
                    expectedReloads
                );
            }
        );

        it('does not start a fallback timer or wait when disableFallback is true and the callback rejects', async () => {
            const { initAI } = await import('./index');
            const error = new Error('callback failed');
            mockCallback.mockRejectedValue(error);
            await expect(
                initAI(mockApp, mockPlugin, mockCallback, {
                    disableFallback: true,
                })
            ).rejects.toBe(error);
            expect(vi.getTimerCount()).toBe(0);
            await vi.advanceTimersByTimeAsync(100);

            expect(mockCallback).toHaveBeenCalledTimes(1);
            expect(mockPlugin.addSettingTab).not.toHaveBeenCalled();
            expect(mockApp.workspace.on).not.toHaveBeenCalled();
            expect(mockApp.plugins.disablePlugin).not.toHaveBeenCalled();
            expect(mockApp.plugins.enablePlugin).not.toHaveBeenCalled();
        });
    });

    it('should call callback immediately when disableFallback is true', async () => {
        const { initAI } = await import('./index');
        await initAI(mockApp, mockPlugin, mockCallback, {
            disableFallback: true,
        });

        expect(mockCallback).toHaveBeenCalled();
        expect(mockPlugin.addSettingTab).not.toHaveBeenCalled();
        expect(mockApp.workspace.on).not.toHaveBeenCalled();
    });

    it('should wait for AI providers and show fallback when disableFallback is false', async () => {
        const { initAI } = await import('./index');
        const mockOnDone = vi.fn();

        // Mock AI providers already available
        mockApp.aiProviders = {
            checkCompatibility: vi.fn(),
        };

        await initAI(mockApp, mockPlugin, mockOnDone, {
            disableFallback: false,
        });

        expect(mockOnDone).toHaveBeenCalled();
        expect(mockApp.aiProviders.checkCompatibility).toHaveBeenCalledWith(4);
    });

    it('should wait for AI providers and show fallback when disableFallback is not specified', async () => {
        const { initAI } = await import('./index');
        const mockOnDone = vi.fn();

        // Mock AI providers already available
        mockApp.aiProviders = {
            checkCompatibility: vi.fn(),
        };

        await initAI(mockApp, mockPlugin, mockOnDone);

        expect(mockOnDone).toHaveBeenCalled();
        expect(mockApp.aiProviders.checkCompatibility).toHaveBeenCalledWith(4);
    });

    it('should handle AI providers not available when disableFallback is false', async () => {
        const { initAI } = await import('./index');
        const mockOnDone = vi.fn();

        // Mock AI providers not available
        mockApp.aiProviders = null;

        // Mock setTimeout to call fallback immediately
        vi.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
            callback();
            return 1 as any;
        });

        vi.spyOn(global, 'clearTimeout').mockImplementation(() => {});

        // Mock workspace.on to never call the callback (AI providers never loads)
        mockApp.workspace.on.mockImplementation(() => ({ off: vi.fn() }));

        // This should show fallback settings tab
        initAI(mockApp, mockPlugin, mockOnDone, {
            disableFallback: false,
        });

        // Wait a bit to let the timeout execute
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockPlugin.addSettingTab).toHaveBeenCalled();

        // Cleanup
        vi.restoreAllMocks();
    });

    it('shows fallback settings tab on version mismatch', async () => {
        const { initAI } = await import('./index');
        const mockOnDone = vi.fn();

        mockApp.aiProviders = {
            checkCompatibility: vi.fn(() => {
                const error: any = new Error('version mismatch');
                error.code = 'version_mismatch';
                throw error;
            }),
        };

        await expect(initAI(mockApp, mockPlugin, mockOnDone)).rejects.toThrow(
            'AI Providers version 4 is required'
        );

        expect(mockPlugin.addSettingTab).toHaveBeenCalled();
    });

    it('rethrows compatibility errors that are not version mismatches', async () => {
        const { initAI } = await import('./index');
        const mockOnDone = vi.fn();

        mockApp.aiProviders = {
            checkCompatibility: vi.fn(() => {
                throw new Error('compat failed');
            }),
        };

        await expect(initAI(mockApp, mockPlugin, mockOnDone)).rejects.toThrow(
            'compat failed'
        );
    });

    it('keeps required API version in sync with AI Providers service', async () => {
        const [{ __testing__ }, { AI_PROVIDERS_SERVICE_VERSION }] =
            await Promise.all([
                import('./index'),
                import('../../src/constants/serviceApiVersion'),
            ]);

        expect(__testing__.REQUIRED_AI_PROVIDERS_VERSION).toBe(
            AI_PROVIDERS_SERVICE_VERSION
        );
    });

    it('disables and re-enables plugin if fallback was shown', async () => {
        const { initAI } = await import('./index');
        const mockOnDone = vi.fn();

        mockApp.aiProviders = null;
        vi.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
            callback();
            return 1 as any;
        });
        vi.spyOn(global, 'clearTimeout').mockImplementation(() => {});

        const initPromise = initAI(mockApp, mockPlugin, mockOnDone, {
            disableFallback: false,
        });

        mockApp.aiProviders = { checkCompatibility: vi.fn() };
        readyHandler?.();
        await initPromise;

        expect(mockPlugin.addSettingTab).toHaveBeenCalled();
        expect(mockApp.plugins.disablePlugin).toHaveBeenCalledWith(
            mockPlugin.manifest.id
        );
        expect(mockApp.plugins.enablePlugin).toHaveBeenCalledWith(
            mockPlugin.manifest.id
        );

        vi.restoreAllMocks();
    });

    it('renders fallback settings tab content', async () => {
        const { initAI } = await import('./index');
        const mockOnDone = vi.fn();

        mockApp.aiProviders = null;
        vi.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
            callback();
            return 1 as any;
        });

        const initPromise = initAI(mockApp, mockPlugin, mockOnDone, {
            disableFallback: false,
        });

        mockApp.aiProviders = { checkCompatibility: vi.fn() };
        readyHandler?.();
        await initPromise;

        const fallbackTab = mockPlugin.addSettingTab.mock.calls[0][0];
        await fallbackTab.display();

        expect(
            fallbackTab.containerEl.querySelector('.ai-providers-notice')
        ).toBeTruthy();

        vi.restoreAllMocks();
    });
});

describe('waitForAI', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('throws when manager is not initialized', async () => {
        const { waitForAI } = await import('./index');

        await expect(waitForAI()).rejects.toThrow(
            'AIProvidersManager not initialized'
        );
    });

    it('resolves immediately when aiProviders is ready', async () => {
        const { initAI, waitForAI } = await import('./index');

        const app = {
            workspace: {
                on: vi.fn(),
                off: vi.fn(),
            },
        } as any;
        const plugin = {
            app,
            manifest: { id: 'test-plugin' },
            addSettingTab: vi.fn(),
            registerEvent: vi.fn(),
        } as any;

        const aiProviders = { checkCompatibility: vi.fn() };
        app.aiProviders = aiProviders;

        await initAI(app, plugin, async () => {}, { disableFallback: true });

        const resolver = await waitForAI();
        await expect(resolver.promise).resolves.toBe(aiProviders);
    });

    it('allows cancelling waitForAI promises', async () => {
        const { initAI, waitForAI } = await import('./index');

        const app = {
            workspace: {
                on: vi.fn(),
                off: vi.fn(),
            },
        } as any;
        const plugin = {
            app,
            manifest: { id: 'test-plugin' },
            addSettingTab: vi.fn(),
            registerEvent: vi.fn(),
        } as any;

        await initAI(app, plugin, async () => {}, { disableFallback: true });

        const resolver = await waitForAI();
        resolver.cancel();

        await expect(resolver.promise).rejects.toThrow(
            'Waiting for AI Providers was cancelled'
        );
    });

    it('returns same resolver while waiting for aiProviders', async () => {
        const { initAI, waitForAI } = await import('./index');

        const app = {
            workspace: {
                on: vi.fn(),
                off: vi.fn(),
            },
        } as any;
        const plugin = {
            app,
            manifest: { id: 'test-plugin' },
            addSettingTab: vi.fn(),
            registerEvent: vi.fn(),
        } as any;

        app.aiProviders = null;
        await initAI(app, plugin, async () => {}, { disableFallback: true });

        const resolver1 = await waitForAI();
        const resolver2 = await waitForAI();

        expect(resolver1).toBe(resolver2);
        resolver1.cancel();
        await expect(resolver1.promise).rejects.toThrow(
            'Waiting for AI Providers was cancelled'
        );
    });

    it('resets the manager via testing hook', async () => {
        const { initAI, __testing__ } = await import('./index');

        const app = {
            workspace: {
                on: vi.fn(),
                off: vi.fn(),
            },
        } as any;
        const plugin = {
            app,
            manifest: { id: 'test-plugin' },
            addSettingTab: vi.fn(),
            registerEvent: vi.fn(),
        } as any;

        await initAI(app, plugin, async () => {}, { disableFallback: true });
        __testing__.resetManager();
    });

    it('resolves waitForAIProviders immediately when ready', async () => {
        const { __testing__ } = await import('./index');

        const app = {
            aiProviders: { checkCompatibility: vi.fn() },
            workspace: {
                on: vi.fn(),
                off: vi.fn(),
            },
        } as any;
        const plugin = {
            registerEvent: vi.fn(),
        } as any;

        const resolver = await __testing__.waitForAIProviders(app, plugin);
        await expect(resolver.promise).resolves.toBe(app.aiProviders);
    });

    it('resolves waitForAIProviders after ready event fires', async () => {
        const { __testing__ } = await import('./index');
        let readyHandler: (() => void) | null = null;

        const app = {
            aiProviders: null,
            workspace: {
                on: vi.fn((_event: string, handler: () => void) => {
                    readyHandler = handler;
                    return {};
                }),
                off: vi.fn(),
            },
        } as any;
        const plugin = {
            registerEvent: vi.fn(),
        } as any;

        const resolver = await __testing__.waitForAIProviders(app, plugin);
        app.aiProviders = { checkCompatibility: vi.fn() };
        readyHandler?.();

        await expect(resolver.promise).resolves.toBe(app.aiProviders);
        expect(app.workspace.off).toHaveBeenCalled();
    });
});
