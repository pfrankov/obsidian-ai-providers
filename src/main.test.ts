import * as obsidian from 'obsidian';
import type { Mock } from 'vitest';
import AIProvidersPlugin from './main';
import { DEFAULT_SETTINGS } from './settings';
import { AIProvidersService } from './AIProvidersService';
import { logger } from './utils/logger';
import { IAIProvider } from '@obsidian-ai-providers/sdk';

vi.mock('./AIProvidersService', () => ({
    AIProvidersService: vi.fn().mockImplementation(() => ({
        initEmbeddingsCache: vi.fn().mockResolvedValue(undefined),
        cleanup: vi.fn().mockResolvedValue(undefined),
    })),
}));

vi.mock('./utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        setEnabled: vi.fn(),
    },
}));

describe('AIProvidersPlugin', () => {
    let app: any;
    let plugin: AIProvidersPlugin;

    const createProvider = (
        overrides: Partial<IAIProvider> = {}
    ): IAIProvider => ({
        id: 'provider-1',
        name: 'Provider 1',
        apiKey: 'secret-key',
        url: 'https://example.com',
        type: 'openai',
        model: 'gpt-4o-mini',
        ...overrides,
    });

    beforeEach(() => {
        app = {
            workspace: {
                layoutReady: false,
                onLayoutReady: vi.fn(cb => cb()),
                trigger: vi.fn(),
            },
            secretStorage: {
                getSecret: vi.fn().mockResolvedValue(null),
                setSecret: vi.fn().mockResolvedValue(undefined),
                deleteSecret: vi.fn().mockResolvedValue(undefined),
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
        const provider = createProvider();
        plugin.loadData = vi.fn().mockResolvedValue({
            debugLogging: true,
            providers: [provider],
        });

        await plugin.loadSettings();

        expect(plugin.settings).toEqual(
            expect.objectContaining({
                ...DEFAULT_SETTINGS,
                debugLogging: true,
                providers: [provider],
            })
        );
        expect(app.secretStorage.setSecret).toHaveBeenCalled();
        expect(plugin.saveData).toHaveBeenCalledWith(
            expect.objectContaining({
                providers: [
                    expect.not.objectContaining({
                        apiKey: expect.anything(),
                    }),
                ],
            })
        );
        expect(logger.setEnabled).toHaveBeenCalledWith(true);
    });

    it('defaults debugLogging when missing in saved data', async () => {
        plugin.loadData = vi
            .fn()
            .mockResolvedValue({ debugLogging: undefined });

        await plugin.loadSettings();

        expect(logger.setEnabled).toHaveBeenCalledWith(false);
    });

    it('saves settings and re-exposes providers', async () => {
        plugin.settings = {
            ...DEFAULT_SETTINGS,
            providers: [createProvider()],
        };
        const exposeSpy = vi
            .spyOn(plugin, 'exposeAIProviders')
            .mockImplementation(() => {});

        await plugin.saveSettings();

        expect(app.secretStorage.setSecret).toHaveBeenCalledWith(
            expect.stringMatching(/^ai-providers-/),
            'secret-key'
        );
        expect(plugin.saveData).toHaveBeenCalledWith(
            expect.objectContaining({
                providers: [
                    expect.not.objectContaining({
                        apiKey: expect.anything(),
                    }),
                ],
            })
        );
        expect(exposeSpy).toHaveBeenCalled();
    });

    it('hydrates providers from secret storage when data is already scrubbed', async () => {
        const provider = createProvider();
        plugin.loadData = vi.fn().mockResolvedValue({
            providers: [{ ...provider, apiKey: undefined }],
        });
        app.secretStorage.getSecret = vi
            .fn()
            .mockResolvedValue(provider.apiKey);

        await plugin.loadSettings();

        expect(plugin.settings.providers?.[0].apiKey).toBe('secret-key');
        expect(plugin.saveData).not.toHaveBeenCalled();
    });

    it('keeps plaintext apiKey in persisted data when secret storage is unavailable', async () => {
        const provider = createProvider();
        delete app.secretStorage;
        plugin.settings = {
            ...DEFAULT_SETTINGS,
            providers: [provider],
        };

        await plugin.saveSettings();

        expect(plugin.saveData).toHaveBeenCalledWith(
            expect.objectContaining({
                providers: [expect.objectContaining({ apiKey: 'secret-key' })],
            })
        );
    });

    it('deletes stored secrets for removed providers', async () => {
        const keptProvider = createProvider();
        const removedProvider = createProvider({
            id: 'provider-2',
            name: 'Provider 2',
        });
        plugin.loadData = vi.fn().mockResolvedValue({
            providers: [keptProvider, removedProvider],
        });

        await plugin.loadSettings();

        plugin.settings.providers = [keptProvider];
        await plugin.saveSettings();

        expect(app.secretStorage.deleteSecret).toHaveBeenCalledWith(
            expect.stringMatching(/^ai-providers-/)
        );
    });

    it('keeps plaintext apiKey when secret storage write fails', async () => {
        const provider = createProvider();
        app.secretStorage.setSecret = vi
            .fn()
            .mockRejectedValue(new Error('nope'));
        plugin.settings = {
            ...DEFAULT_SETTINGS,
            providers: [provider],
        };

        await plugin.saveSettings();

        expect(logger.warn).toHaveBeenCalled();
        expect(plugin.saveData).toHaveBeenCalledWith(
            expect.objectContaining({
                providers: [expect.objectContaining({ apiKey: 'secret-key' })],
            })
        );
    });

    it('exposes providers and handles cleanup/reinit errors', async () => {
        const cleanup = vi.fn().mockRejectedValue(new Error('cleanup fail'));
        const initEmbeddingsCache = vi
            .fn()
            .mockRejectedValue(new Error('cache fail'));
        (AIProvidersService as unknown as Mock).mockImplementationOnce(() => ({
            initEmbeddingsCache,
            cleanup: vi.fn(),
        }));

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
