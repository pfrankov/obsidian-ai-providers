import { initAI } from './index';

// Mock Obsidian modules
jest.mock('obsidian', () => ({
    Plugin: class MockPlugin {
        app: any;
        manifest: any;
        constructor(app: any, manifest: any) {
            this.app = app;
            this.manifest = manifest;
        }
        addSettingTab = jest.fn();
        registerEvent = jest.fn();
    },
    PluginSettingTab: class MockPluginSettingTab {
        app: any;
        plugin: any;
        containerEl: any;
        constructor(app: any, plugin: any) {
            this.app = app;
            this.plugin = plugin;
            this.containerEl = { empty: jest.fn() };
        }
        display = jest.fn();
    },
    sanitizeHTMLToDom: jest.fn().mockReturnValue(document.createElement('div')),
}));

describe('initAI', () => {
    let mockApp: any;
    let mockPlugin: any;
    let mockCallback: jest.Mock;

    beforeEach(() => {
        mockApp = {
            workspace: {
                on: jest.fn(),
                off: jest.fn(),
            },
            plugins: {
                disablePlugin: jest.fn(),
                enablePlugin: jest.fn(),
            },
        };
        mockPlugin = {
            app: mockApp,
            manifest: { id: 'test-plugin' },
            addSettingTab: jest.fn(),
            registerEvent: jest.fn(),
        };
        mockCallback = jest.fn();
        jest.clearAllMocks();
    });

    it('should call callback immediately when disableFallback is true', async () => {
        await initAI(mockApp, mockPlugin, mockCallback, {
            disableFallback: true,
        });

        expect(mockCallback).toHaveBeenCalled();
        expect(mockPlugin.addSettingTab).not.toHaveBeenCalled();
    });

    it('should wait for AI providers and show fallback when disableFallback is false', async () => {
        const mockOnDone = jest.fn();

        // Mock AI providers already available
        mockApp.aiProviders = {
            checkCompatibility: jest.fn(),
        };

        await initAI(mockApp, mockPlugin, mockOnDone, {
            disableFallback: false,
        });

        expect(mockOnDone).toHaveBeenCalled();
        expect(mockApp.aiProviders.checkCompatibility).toHaveBeenCalledWith(3);
    });

    it('should wait for AI providers and show fallback when disableFallback is not specified', async () => {
        const mockOnDone = jest.fn();

        // Mock AI providers already available
        mockApp.aiProviders = {
            checkCompatibility: jest.fn(),
        };

        await initAI(mockApp, mockPlugin, mockOnDone);

        expect(mockOnDone).toHaveBeenCalled();
        expect(mockApp.aiProviders.checkCompatibility).toHaveBeenCalledWith(3);
    });

    it('should handle AI providers not available when disableFallback is false', async () => {
        const mockOnDone = jest.fn();

        // Mock AI providers not available
        mockApp.aiProviders = null;

        // Mock setTimeout to call fallback immediately
        jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
            callback();
            return 1 as any;
        });

        jest.spyOn(global, 'clearTimeout').mockImplementation(() => {});

        // Mock workspace.on to never call the callback (AI providers never loads)
        mockApp.workspace.on.mockImplementation(() => ({ off: jest.fn() }));

        // This should show fallback settings tab
        const initPromise = initAI(mockApp, mockPlugin, mockOnDone, {
            disableFallback: false,
        });

        // Wait a bit to let the timeout execute
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockPlugin.addSettingTab).toHaveBeenCalled();

        // Cleanup
        jest.restoreAllMocks();
    });
});
