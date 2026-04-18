import * as obsidian from 'obsidian';
import type { Mock } from 'vitest';
import AIProvidersPlugin from './main';
import { DEFAULT_SETTINGS } from './settings';
import { AIProvidersService } from './AIProvidersService';
import { logger } from './utils/logger';

vi.mock('./AIProvidersService', () => ({
    AIProvidersService: vi.fn().mockImplementation(function () {
        return {
            initEmbeddingsCache: vi.fn().mockResolvedValue(undefined),
            cleanup: vi.fn().mockResolvedValue(undefined),
        };
    }),
}));

vi.mock('./utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        configure: vi.fn(),
        setEnabled: vi.fn(),
        setChunkLoggingEnabled: vi.fn(),
    },
}));

describe('AIProvidersPlugin', () => {
    let app: any;
    let plugin: AIProvidersPlugin;

    beforeEach(() => {
        app = {
            workspace: {
                layoutReady: false,
                onLayoutReady: vi.fn(cb => cb()),
                trigger: vi.fn(),
            },
        };

        plugin = new AIProvidersPlugin(app, {
            id: 'test-plugin',
            name: 'Test Plugin',
            author: 'Test Author',
            version: '1.0.0',
            minAppVersion: '0.0.1',
            description: 'Test Description',
        });

        plugin.loadData = vi.fn().mockResolvedValue({ debugLogging: true });
        plugin.saveData = vi.fn().mockResolvedValue(undefined);
        plugin.addSettingTab = vi.fn();
        vi.clearAllMocks();
    });

    it('loads settings and enables logger', async () => {
        await plugin.loadSettings();

        expect(plugin.settings).toEqual(
            expect.objectContaining({
                ...DEFAULT_SETTINGS,
                debugLogging: true,
            })
        );
        expect(logger.configure).toHaveBeenCalledWith({
            enabled: true,
            chunkLoggingEnabled: false,
        });
    });

    it('defaults debugLogging when missing in saved data', async () => {
        plugin.loadData = vi.fn().mockResolvedValue({
            debugLogging: undefined,
            debugChunkLogging: undefined,
        });

        await plugin.loadSettings();

        expect(logger.configure).toHaveBeenCalledWith({
            enabled: false,
            chunkLoggingEnabled: false,
        });
    });

    it('passes debugChunkLogging through to logger configuration', async () => {
        plugin.loadData = vi
            .fn()
            .mockResolvedValue({ debugLogging: true, debugChunkLogging: true });

        await plugin.loadSettings();

        expect(logger.configure).toHaveBeenCalledWith({
            enabled: true,
            chunkLoggingEnabled: true,
        });
    });

    it('forces chunk logging off in production builds', async () => {
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        vi.resetModules();

        const { default: ProductionPlugin } = await import('./main');
        const { logger: productionLogger } = await import('./utils/logger');

        const productionPlugin = new ProductionPlugin(app, {
            id: 'test-plugin',
            name: 'Test Plugin',
            author: 'Test Author',
            version: '1.0.0',
            minAppVersion: '0.0.1',
            description: 'Test Description',
        });
        productionPlugin.loadData = vi
            .fn()
            .mockResolvedValue({ debugLogging: true, debugChunkLogging: true });

        await productionPlugin.loadSettings();

        expect(productionLogger.configure).toHaveBeenCalledWith({
            enabled: true,
            chunkLoggingEnabled: false,
        });

        process.env.NODE_ENV = originalNodeEnv;
    });

    it('saves settings and re-exposes providers', async () => {
        plugin.settings = { ...DEFAULT_SETTINGS, providers: [] };
        const exposeSpy = vi
            .spyOn(plugin, 'exposeAIProviders')
            .mockImplementation(() => {});

        await plugin.saveSettings();

        expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
        expect(exposeSpy).toHaveBeenCalled();
    });

    it('exposes providers and handles cleanup/reinit errors', async () => {
        const cleanup = vi.fn().mockRejectedValue(new Error('cleanup fail'));
        const initEmbeddingsCache = vi
            .fn()
            .mockRejectedValue(new Error('cache fail'));
        (AIProvidersService as unknown as Mock).mockImplementationOnce(
            function () {
                return {
                    initEmbeddingsCache,
                    cleanup: vi.fn(),
                };
            }
        );

        plugin.aiProviders = { cleanup } as any;
        app.workspace.layoutReady = true;
        const consoleSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        plugin.exposeAIProviders();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(cleanup).toHaveBeenCalled();
        expect(app.aiProviders).toBeDefined();
        expect(initEmbeddingsCache).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalled();
    });

    it('onload registers icons, settings, and triggers ready event', async () => {
        const addIconSpy = vi.spyOn(obsidian, 'addIcon') as unknown as Mock;

        await plugin.onload();

        expect(addIconSpy).toHaveBeenCalled();
        expect(plugin.addSettingTab).toHaveBeenCalled();
        expect(app.workspace.trigger).toHaveBeenCalledWith(
            'ai-providers-ready'
        );
        expect(app.aiProviders).toBeDefined();
    });

    it('onunload cleans up and removes service from app', async () => {
        const cleanup = vi.fn().mockResolvedValue(undefined);
        plugin.aiProviders = { cleanup } as any;
        (app as any).aiProviders = plugin.aiProviders;

        await plugin.onunload();

        expect(cleanup).toHaveBeenCalled();
        expect((app as any).aiProviders).toBeUndefined();
    });
});
