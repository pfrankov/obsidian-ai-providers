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

    it('should call callback immediately when disableFallback is true', async () => {
        const { initAI } = await import('./index');
        await initAI(mockApp, mockPlugin, mockCallback, {
            disableFallback: true,
        });

        expect(mockCallback).toHaveBeenCalled();
        expect(mockPlugin.addSettingTab).not.toHaveBeenCalled();
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
        expect(mockApp.aiProviders.checkCompatibility).toHaveBeenCalledWith(3);
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
        expect(mockApp.aiProviders.checkCompatibility).toHaveBeenCalledWith(3);
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
            'AI Providers version 3 is required'
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
