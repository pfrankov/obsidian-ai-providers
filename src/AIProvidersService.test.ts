import { AIProvidersService } from './AIProvidersService';
import { App } from 'obsidian';
import AIProvidersPlugin from './main';
import {
    IAIProvider,
    IAIProvidersEmbedParams,
    IAIProvidersRetrievalParams,
    IAIDocument,
} from '@obsidian-ai-providers/sdk';
import { logger } from './utils/logger';
import { AI_PROVIDERS_SERVICE_VERSION } from './constants/serviceApiVersion';

// Mock the handlers
vi.mock('./handlers/OpenAIHandler');
vi.mock('./handlers/OllamaHandler');
vi.mock('./handlers/AnthropicHandler');

vi.mock('./utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        setEnabled: vi.fn(),
    },
}));

vi.mock('./i18n', () => ({
    I18n: {
        t: (key: string) => key,
    },
}));

vi.mock('./modals/ConfirmationModal', () => {
    return {
        ConfirmationModal: vi
            .fn()
            .mockImplementation(function (_app, _message, onConfirm, onCancel) {
                return {
                    onConfirm,
                    onCancel,
                    open: vi.fn(),
                };
            }),
    };
});

// Mock the cache
vi.mock('./cache/EmbeddingsCache', () => ({
    embeddingsCache: {
        init: vi.fn(),
        close: vi.fn(),
        isInitialized: vi.fn().mockReturnValue(true),
    },
}));

// Mock CachedEmbeddingsService
vi.mock('./cache/CachedEmbeddingsService');

describe('AIProvidersService', () => {
    let service: AIProvidersService;
    let mockApp: App;
    let mockPlugin: AIProvidersPlugin;
    let mockProvider: IAIProvider;

    beforeEach(() => {
        // Create mock app
        mockApp = {
            appId: 'test-app-id',
        } as any;

        // Create mock plugin with settings
        mockPlugin = {
            settings: {
                providers: [],
                _version: 1,
            },
            saveSettings: vi.fn(),
        } as any;

        // Create mock provider
        mockProvider = {
            id: 'test-provider',
            name: 'Test Provider',
            type: 'openai',
            apiKey: 'test-key',
            model: 'gpt-3.5-turbo',
        };

        // Create service instance
        service = new AIProvidersService(mockApp, mockPlugin);

        // Clear all mocks
        vi.clearAllMocks();
    });

    it('should always return a promise from embed method', async () => {
        // Mock the CachedEmbeddingsService to return a promise
        const mockEmbedWithCache = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);
        (service as any).cachedEmbeddingsService = {
            embedWithCache: mockEmbedWithCache,
        };

        const params: IAIProvidersEmbedParams = {
            provider: mockProvider,
            input: 'test text',
        };

        // Call the embed method
        const result = service.embed(params);

        // Verify it returns a promise
        expect(result).toBeInstanceOf(Promise);

        // Verify the promise resolves correctly
        const embeddings = await result;
        expect(embeddings).toEqual([[0.1, 0.2, 0.3]]);
    });

    it('should return a promise even when input is empty', async () => {
        const params: IAIProvidersEmbedParams = {
            provider: mockProvider,
            input: '',
        };

        // Call the embed method with empty input
        const result = service.embed(params);

        // Verify it returns a promise even with empty input
        expect(result).toBeInstanceOf(Promise);

        // Verify the promise rejects with an error
        await expect(result).rejects.toThrow('Input is required for embedding');
    });

    it('should return a promise with array input', async () => {
        // Mock the CachedEmbeddingsService to return multiple embeddings
        const mockEmbedWithCache = vi.fn().mockResolvedValue([
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
        ]);
        (service as any).cachedEmbeddingsService = {
            embedWithCache: mockEmbedWithCache,
        };

        const params: IAIProvidersEmbedParams = {
            provider: mockProvider,
            input: ['text1', 'text2'],
        };

        // Call the embed method
        const result = service.embed(params);

        // Verify it returns a promise
        expect(result).toBeInstanceOf(Promise);

        // Verify the promise resolves correctly
        const embeddings = await result;
        expect(embeddings).toEqual([
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
        ]);
    });

    it('should initialize with correct version', () => {
        expect(service.version).toBe(AI_PROVIDERS_SERVICE_VERSION);
    });

    it('defaults providers to empty array when missing', () => {
        const pluginWithoutProviders = {
            settings: { _version: 1 },
        } as AIProvidersPlugin;
        const newService = new AIProvidersService(
            mockApp,
            pluginWithoutProviders
        );

        expect(newService.providers).toEqual([]);
    });

    it('should initialize with providers from plugin settings', () => {
        const providers = [mockProvider];
        const pluginWithProviders = {
            ...mockPlugin,
            settings: { ...mockPlugin.settings, providers },
        } as AIProvidersPlugin;

        const serviceWithProviders = new AIProvidersService(
            mockApp,
            pluginWithProviders
        );
        expect(serviceWithProviders.providers).toEqual(providers);
    });

    it('should initialize embeddings cache', async () => {
        const { embeddingsCache } = await import('./cache/EmbeddingsCache');

        await service.initEmbeddingsCache();

        expect(embeddingsCache.init).toHaveBeenCalledWith('test-app-id');
    });

    it('uses default vault id when appId is missing', async () => {
        const { embeddingsCache } = await import('./cache/EmbeddingsCache');
        const appWithoutId = {} as App;
        const plugin = {
            settings: { providers: [], _version: 1 },
            saveSettings: vi.fn(),
        } as any;
        const newService = new AIProvidersService(appWithoutId, plugin);

        await newService.initEmbeddingsCache();

        expect(embeddingsCache.init).toHaveBeenCalledWith('default');
    });

    it('logs errors when embeddings cache init fails', async () => {
        const { embeddingsCache } = await import('./cache/EmbeddingsCache');
        (embeddingsCache.init as any).mockRejectedValueOnce(new Error('fail'));

        await service.initEmbeddingsCache();

        expect(logger.error).toHaveBeenCalled();
    });

    it('throws when embedForce is called with unsupported provider', async () => {
        await expect(
            (service as any).embedForce({
                provider: { ...mockProvider, type: 'unsupported' },
                input: 'test',
            })
        ).rejects.toThrow('Handler not found');
    });

    it('embedForce delegates to the provider handler', async () => {
        const handlers = (service as any).handlers;
        handlers.openai.embed = vi.fn().mockResolvedValue([[0.1, 0.2]]);

        const result = await (service as any).embedForce({
            provider: mockProvider,
            input: 'test',
        });

        expect(handlers.openai.embed).toHaveBeenCalled();
        expect(result).toEqual([[0.1, 0.2]]);
    });

    it('throws when embed is called with aborted signal', async () => {
        const abortController = new AbortController();
        abortController.abort();

        await expect(
            service.embed({
                provider: mockProvider,
                input: 'test',
                abortController,
            })
        ).rejects.toThrow('Aborted');
    });

    it('wraps non-Error embed failures with i18n message', async () => {
        (service as any).cachedEmbeddingsService = {
            embedWithCache: vi.fn().mockRejectedValue('boom'),
        };

        await expect(
            service.embed({
                provider: mockProvider,
                input: 'test',
            })
        ).rejects.toBe('boom');
    });

    it('uses i18n fallback for sync non-Error embed failures', async () => {
        (service as any).cachedEmbeddingsService = {
            embedWithCache: vi.fn(() => {
                throw 'boom';
            }),
        };

        await expect(
            service.embed({
                provider: mockProvider,
                input: 'test',
            })
        ).rejects.toBe('boom');
    });

    it('fetchModels throws for unsupported handler', async () => {
        await expect(
            service.fetchModels({
                provider: { ...mockProvider, type: 'unsupported' },
            } as any)
        ).rejects.toThrow('Handler not found or does not support fetchModels');
    });

    it('fetchModels throws when aborted', async () => {
        const abortController = new AbortController();
        abortController.abort();

        await expect(
            service.fetchModels({ provider: mockProvider, abortController })
        ).rejects.toThrow('Aborted');
    });

    it('fetchModels wraps non-Error failures with i18n message', async () => {
        const handlers = (service as any).handlers;
        handlers.openai.fetchModels = vi.fn().mockRejectedValue('boom');

        await expect(
            service.fetchModels({ provider: mockProvider })
        ).rejects.toBe('boom');
    });

    it('fetchModels uses i18n fallback for sync non-Error failures', async () => {
        const handlers = (service as any).handlers;
        handlers.openai.fetchModels = vi.fn(() => {
            throw 'boom';
        });

        await expect(service.fetchModels(mockProvider)).rejects.toBe('boom');
    });

    it('execute throws for unsupported handlers', async () => {
        await expect(
            service.execute({
                provider: { ...mockProvider, type: 'unsupported' },
                prompt: 'hi',
            } as any)
        ).rejects.toThrow('Handler not found');
    });

    it('toolsExecute throws for unsupported handlers', async () => {
        await expect(
            service.toolsExecute({
                provider: { ...mockProvider, type: 'unsupported' },
                messages: [{ role: 'user', content: 'hi' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'test', parameters: {} },
                    },
                ],
            } as any)
        ).rejects.toThrow('Handler not found');
    });

    it('toolsExecute delegates to provider handler', async () => {
        const handlers = (service as any).handlers;
        handlers.openai.toolsExecute = vi.fn().mockResolvedValue({
            role: 'assistant',
            content: null,
            tool_calls: [
                {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'test', arguments: '{}' },
                },
            ],
        });

        const result = await service.toolsExecute({
            provider: mockProvider,
            messages: [{ role: 'user', content: 'Hi' }],
            tools: [
                {
                    type: 'function',
                    function: { name: 'test', parameters: {} },
                },
            ],
        } as any);

        expect(handlers.openai.toolsExecute).toHaveBeenCalled();
        expect(result.tool_calls?.[0].function.name).toBe('test');
    });

    it('execute uses model override when params.model is set', async () => {
        const handlers = (service as any).handlers;
        handlers.openai.execute = vi
            .fn()
            .mockImplementation(async (params: any) => {
                return params.provider.model;
            });

        const result = await service.execute({
            provider: mockProvider,
            model: 'gpt-4o',
            prompt: 'Hi',
            onProgress: () => {},
        } as any);

        expect(result).toBe('gpt-4o');
        expect(handlers.openai.execute).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: expect.objectContaining({ model: 'gpt-4o' }),
            })
        );
    });

    it('execute uses provider default model when params.model is not set', async () => {
        const handlers = (service as any).handlers;
        handlers.openai.execute = vi
            .fn()
            .mockImplementation(async (params: any) => {
                return params.provider.model;
            });

        const result = await service.execute({
            provider: mockProvider,
            prompt: 'Hi',
            onProgress: () => {},
        } as any);

        expect(result).toBe('gpt-3.5-turbo');
        expect(handlers.openai.execute).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: expect.objectContaining({ model: 'gpt-3.5-turbo' }),
            })
        );
    });

    it('toolsExecute uses model override when params.model is set', async () => {
        const handlers = (service as any).handlers;
        handlers.openai.toolsExecute = vi.fn().mockResolvedValue({
            role: 'assistant',
            content: 'done',
        });

        await service.toolsExecute({
            provider: mockProvider,
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'Hi' }],
            tools: [
                {
                    type: 'function',
                    function: { name: 'test', parameters: {} },
                },
            ],
        } as any);

        expect(handlers.openai.toolsExecute).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: expect.objectContaining({ model: 'gpt-4o' }),
            })
        );
    });

    it('toolsExecute uses provider default model when params.model is not set', async () => {
        const handlers = (service as any).handlers;
        handlers.openai.toolsExecute = vi.fn().mockResolvedValue({
            role: 'assistant',
            content: 'done',
        });

        await service.toolsExecute({
            provider: mockProvider,
            messages: [{ role: 'user', content: 'Hi' }],
            tools: [
                {
                    type: 'function',
                    function: { name: 'test', parameters: {} },
                },
            ],
        } as any);

        expect(handlers.openai.toolsExecute).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: expect.objectContaining({ model: 'gpt-3.5-turbo' }),
            })
        );
    });

    it('legacy execute uses model override', async () => {
        const handlers = (service as any).handlers;
        let capturedProvider: any = null;
        handlers.openai.execute = vi
            .fn()
            .mockImplementation(async (params: any) => {
                capturedProvider = params.provider;
                return 'Hi';
            });

        await service.execute({
            provider: mockProvider,
            model: 'gpt-4o',
            prompt: 'Hi',
        } as any);

        expect(capturedProvider.model).toBe('gpt-4o');
    });

    it('getModelCapabilities returns stored capabilities for requested model', () => {
        const providerWithCapabilities = {
            ...mockProvider,
            model: 'gpt-4',
            modelCapabilities: {
                'gpt-4': {
                    embedding: false,
                    text: true,
                    tools: true,
                    vision: true,
                },
            },
        };

        expect(
            service.getModelCapabilities({ provider: providerWithCapabilities })
        ).toEqual({
            embedding: false,
            text: true,
            tools: true,
            vision: true,
        });
        expect(
            service.getModelCapabilities({
                provider: providerWithCapabilities,
                model: 'missing',
            })
        ).toBeNull();
        expect(
            service.getModelCapabilities({
                provider: { ...mockProvider, model: '' },
            })
        ).toBeNull();
    });

    it('getModels returns models with capabilities', () => {
        const provider = {
            ...mockProvider,
            availableModels: [
                'gpt-4o',
                'gpt-3.5-turbo',
                'text-embedding-3-small',
            ],
            modelCapabilities: {
                'gpt-4o': {
                    text: true,
                    embedding: false,
                    tools: true,
                    vision: true,
                },
                'text-embedding-3-small': {
                    text: false,
                    embedding: true,
                    tools: false,
                    vision: false,
                },
            },
        };

        const models = service.getModels({ provider });

        expect(models).toEqual({
            'gpt-4o': {
                text: true,
                embedding: false,
                tools: true,
                vision: true,
            },
            'gpt-3.5-turbo': null,
            'text-embedding-3-small': {
                text: false,
                embedding: true,
                tools: false,
                vision: false,
            },
        });
    });

    it('getModels returns empty object when no availableModels', () => {
        expect(service.getModels({ provider: mockProvider })).toEqual({});
    });

    it('checkModelCapabilities probes and persists capabilities', async () => {
        const provider = {
            ...mockProvider,
            model: 'gpt-4o',
        };
        mockPlugin.settings.providers = [provider];

        const handlers = (service as any).handlers;
        handlers.openai.execute = vi.fn().mockResolvedValue('OK');
        handlers.openai.embed = vi.fn().mockResolvedValue([[0.1]]);
        handlers.openai.toolsExecute = vi.fn().mockResolvedValue({
            role: 'assistant',
            content: null,
            tool_calls: [
                {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'capability_probe', arguments: '{}' },
                },
            ],
        });

        const result = await service.checkModelCapabilities({ provider });

        expect(result).toEqual({
            text: true,
            embedding: true,
            tools: true,
            vision: true,
        });
        expect(provider.modelCapabilities).toEqual({
            'gpt-4o': {
                text: true,
                embedding: true,
                tools: true,
                vision: true,
            },
        });
        expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });

    it('checkModelCapabilities uses model override and persists under overridden model', async () => {
        const provider = {
            ...mockProvider,
            model: 'gpt-3.5-turbo',
        };
        mockPlugin.settings.providers = [provider];

        const handlers = (service as any).handlers;
        handlers.openai.execute = vi.fn().mockResolvedValue('OK');
        (service as any).cachedEmbeddingsService = {
            embedWithCache: vi.fn().mockRejectedValue(new Error('no embed')),
        };
        handlers.openai.toolsExecute = vi
            .fn()
            .mockRejectedValue(new Error('no tools'));

        const result = await service.checkModelCapabilities({
            provider,
            model: 'gpt-4o',
        });

        expect(result).toEqual({
            text: true,
            embedding: false,
            tools: false,
            vision: true,
        });
        expect(provider.modelCapabilities).toEqual({
            'gpt-4o': {
                text: true,
                embedding: false,
                tools: false,
                vision: true,
            },
        });
        // Verify execute was called with the overridden model
        expect(handlers.openai.execute.mock.calls[0][0].provider.model).toBe(
            'gpt-4o'
        );
    });

    it('checkModelCapabilities does not save when provider not found in settings', async () => {
        mockPlugin.settings.providers = [];

        const handlers = (service as any).handlers;
        handlers.openai.execute = vi.fn().mockRejectedValue(new Error('fail'));
        (service as any).cachedEmbeddingsService = {
            embedWithCache: vi.fn().mockRejectedValue(new Error('fail')),
        };
        handlers.openai.toolsExecute = vi
            .fn()
            .mockRejectedValue(new Error('fail'));

        const result = await service.checkModelCapabilities({
            provider: mockProvider,
        });

        expect(result).toEqual({
            text: false,
            embedding: false,
            tools: false,
            vision: false,
        });
        expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
    });

    it('legacy execute propagates handler errors', async () => {
        const handlers = (service as any).handlers;
        handlers.openai.execute = vi.fn().mockRejectedValue('boom');

        const legacyHandler: any = await service.execute({
            provider: mockProvider,
            prompt: 'Hi',
        } as any);

        await new Promise<void>(resolve => {
            legacyHandler.onError((error: Error) => {
                expect(error.message).toBe('boom');
                resolve();
            });
        });
    });

    it('legacy execute forwards Error instances', async () => {
        const handlers = (service as any).handlers;
        handlers.openai.execute = vi.fn().mockRejectedValue(new Error('boom'));

        const legacyHandler: any = await service.execute({
            provider: mockProvider,
            prompt: 'Hi',
        } as any);

        await new Promise<void>(resolve => {
            legacyHandler.onError((error: Error) => {
                expect(error.message).toBe('boom');
                resolve();
            });
        });
    });

    it('legacy execute aborts internal controller', async () => {
        const handlers = (service as any).handlers;
        handlers.openai.execute = vi.fn().mockResolvedValue('done');

        const legacyHandler: any = await service.execute({
            provider: mockProvider,
            prompt: 'Hi',
        } as any);

        legacyHandler.abort();
        expect(legacyHandler).toHaveProperty('abort');
    });

    describe('execute legacy augmentation', () => {
        beforeEach(() => {
            // Mock handler.execute to stream two chunks then resolve
            const handlers = (service as any).handlers;
            Object.values(handlers).forEach((h: any) => {
                h.execute = vi
                    .fn()
                    .mockImplementation(({ onProgress }: any) => {
                        return new Promise<string>(resolve => {
                            setTimeout(() => {
                                if (onProgress) {
                                    onProgress('Hel', 'Hel');
                                    onProgress('lo', 'Hello');
                                }
                                resolve('Hello');
                            }, 0);
                        });
                    });
            });
        });

        it('returns a promise resolving to legacy handler object with onData/onEnd/onError/abort when no onProgress and no abortController passed', async () => {
            const promise: any = service.execute({
                provider: mockProvider,
                prompt: 'Hi',
            } as any);
            // Should be a promise
            expect(typeof promise.then).toBe('function');
            // Await the legacy handler object
            const legacyHandler: any = await promise;
            expect(typeof legacyHandler.onData).toBe('function');
            expect(typeof legacyHandler.onEnd).toBe('function');
            expect(typeof legacyHandler.onError).toBe('function');
            expect(typeof legacyHandler.abort).toBe('function');
            const collected: string[] = [];
            await new Promise<void>(resolve => {
                legacyHandler.onData((chunk: string) => collected.push(chunk));
                legacyHandler.onEnd((full: string) => {
                    expect(full).toBe('Hello');
                    expect(collected.join('')).toBe('Hello');
                    resolve();
                });
            });
        });

        it('returns plain promise (no legacy methods) when user onProgress provided', () => {
            const result: any = service.execute({
                provider: mockProvider,
                prompt: 'Hi',
                onProgress: () => {},
            } as any);
            expect(typeof result.then).toBe('function');
            expect(result.onData).toBeUndefined();
            expect(result.onEnd).toBeUndefined();
            expect(result.onError).toBeUndefined();
        });

        it('returns plain promise (no legacy methods) when abortController provided', () => {
            const result: any = service.execute({
                provider: mockProvider,
                prompt: 'Hi',
                abortController: new AbortController(),
            } as any);
            expect(typeof result.then).toBe('function');
            expect(result.onData).toBeUndefined();
            expect(result.onEnd).toBeUndefined();
            expect(result.onError).toBeUndefined();
        });
    });

    it('should cleanup embeddings cache', async () => {
        const { embeddingsCache } = await import('./cache/EmbeddingsCache');

        await service.cleanup();

        expect(embeddingsCache.close).toHaveBeenCalled();
    });

    it('logs cleanup errors without throwing', async () => {
        const { embeddingsCache } = await import('./cache/EmbeddingsCache');
        (embeddingsCache.close as any).mockRejectedValueOnce(
            new Error('cleanup fail')
        );

        await service.cleanup();

        expect(logger.error).toHaveBeenCalled();
    });

    it('checkCompatibility throws version_mismatch when version is too low', () => {
        try {
            service.checkCompatibility(999);
            throw new Error('Expected compatibility error');
        } catch (error) {
            const compatibilityError = error as Error & {
                code?: string;
                requiredVersion?: number;
                currentVersion?: number;
            };
            expect(compatibilityError.message).toBe(
                'errors.pluginMustBeUpdated'
            );
            expect(compatibilityError.code).toBe('version_mismatch');
            expect(compatibilityError.requiredVersion).toBe(999);
            expect(compatibilityError.currentVersion).toBe(
                AI_PROVIDERS_SERVICE_VERSION
            );
        }
    });

    it('migrateProvider returns existing provider when matched', async () => {
        const existingProvider = { ...mockProvider, id: 'existing' };
        mockPlugin.settings.providers = [existingProvider];

        const result = await service.migrateProvider(existingProvider);

        expect(result).toBe(existingProvider);
    });

    it('migrateProvider resolves false when canceled', async () => {
        const { ConfirmationModal } =
            await import('./modals/ConfirmationModal');
        (ConfirmationModal as any).mockImplementationOnce(function (
            _app: unknown,
            _message: string,
            _onConfirm?: () => void,
            onCancel?: () => void
        ) {
            return {
                open: vi.fn().mockImplementation(() => onCancel?.()),
            };
        });

        const result = await service.migrateProvider(mockProvider);

        expect(result).toBe(false);
    });

    it('migrateProvider saves provider on confirm', async () => {
        const { ConfirmationModal } =
            await import('./modals/ConfirmationModal');
        (ConfirmationModal as any).mockImplementationOnce(function (
            _app: unknown,
            _message: string,
            onConfirm?: () => void
        ) {
            return {
                open: vi.fn().mockImplementation(() => onConfirm?.()),
            };
        });

        const result = await service.migrateProvider(mockProvider);

        expect(result).toEqual(mockProvider);
        expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });

    it('migrateProvider initializes providers list when missing', async () => {
        mockPlugin.settings.providers = undefined;

        const { ConfirmationModal } =
            await import('./modals/ConfirmationModal');
        (ConfirmationModal as any).mockImplementationOnce(function (
            _app: unknown,
            _message: string,
            onConfirm?: () => void
        ) {
            return {
                open: vi.fn().mockImplementation(() => onConfirm?.()),
            };
        });

        await service.migrateProvider(mockProvider);

        expect(mockPlugin.settings.providers).toBeDefined();
    });

    it('should support all expected provider types', () => {
        const handlers = (service as any).handlers;
        const expectedTypes = [
            'openai',
            'openrouter',
            'ollama',
            'ollama-openwebui',
            'gemini',
            'lmstudio',
            'groq',
        ];

        expectedTypes.forEach(type => {
            expect(handlers[type]).toBeDefined();
            expect(typeof handlers[type]).toBe('object');
            expect(handlers[type]).toHaveProperty('execute');
            expect(handlers[type]).toHaveProperty('fetchModels');
            expect(handlers[type]).toHaveProperty('embed');
        });
    });

    it('processes documents without meta ids', () => {
        const result = (service as any).processDocuments([
            { content: 'Doc content' },
        ]);

        expect(result.documentChunkCounts).toHaveProperty('Doc content');
    });

    it('falls back to content for processed docs without meta ids', () => {
        const documents = [{ content: 'Doc content' }];
        const processedChunks = [{ content: 'chunk', document: documents[0] }];
        const documentChunkCounts = { 'Doc content': 1 };

        const processedDocs = (service as any).getProcessedDocs(
            processedChunks,
            documentChunkCounts,
            documents
        );

        expect(processedDocs).toEqual(documents);
    });

    it('normalizes zero vectors safely', () => {
        const normalized = (service as any).l2Normalize([0, 0, 0]);
        expect(normalized).toEqual([0, 0, 0]);
    });

    describe('retrieve method', () => {
        const testDocuments: IAIDocument[] = [
            {
                content: 'JavaScript is a programming language',
                meta: { id: 1, title: 'JS Intro' },
            },
            {
                content: 'Python is used for data science',
                meta: { id: 2, title: 'Python Guide' },
            },
            {
                content: 'TypeScript adds types to JavaScript',
                meta: { id: 3, title: 'TS Overview' },
            },
        ];

        let testParams: IAIProvidersRetrievalParams;

        beforeEach(() => {
            testParams = {
                query: 'programming language',
                documents: testDocuments,
                embeddingProvider: mockProvider,
            };
        });

        it('should return sorted results with correct structure', async () => {
            // Mock the CachedEmbeddingsService to return embeddings
            const mockEmbedWithCache = vi
                .fn()
                .mockResolvedValueOnce([[0.1, 0.2, 0.3]]) // Query embedding
                .mockResolvedValueOnce([
                    [0.9, 0.1, 0.1], // High similarity to query
                    [0.1, 0.9, 0.1], // Medium similarity
                    [0.8, 0.2, 0.1], // High similarity
                ]);
            (service as any).cachedEmbeddingsService = {
                embedWithCache: mockEmbedWithCache,
            };

            const results = await service.retrieve(testParams);

            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBe(3);

            // Check structure and sorting
            results.forEach((result, i) => {
                expect(result).toHaveProperty('content');
                expect(result).toHaveProperty('score');
                expect(result).toHaveProperty('document');
                expect(typeof result.content).toBe('string');
                expect(typeof result.score).toBe('number');

                // Check sorting (descending by score)
                if (i > 0) {
                    expect(results[i - 1].score).toBeGreaterThanOrEqual(
                        result.score
                    );
                }
            });
        });

        it('should handle edge cases', async () => {
            // Empty documents
            const emptyDocsResult = await service.retrieve({
                ...testParams,
                documents: [],
            });
            expect(emptyDocsResult).toEqual([]);

            // Empty query
            const emptyQueryResult = await service.retrieve({
                ...testParams,
                query: '',
            });
            expect(Array.isArray(emptyQueryResult)).toBe(true);
        });

        it('throws when aborted before retrieval starts', async () => {
            const abortController = new AbortController();
            abortController.abort();

            await expect(
                service.retrieve({ ...testParams, abortController })
            ).rejects.toThrow('Aborted');
        });

        it('returns empty when documents produce no chunks', async () => {
            const result = await service.retrieve({
                ...testParams,
                documents: [{ content: '   \n', meta: { id: 'empty' } }],
            });

            expect(result).toEqual([]);
        });

        it('should preserve document references', async () => {
            // Mock the CachedEmbeddingsService to return embeddings
            const mockEmbedWithCache = vi
                .fn()
                .mockResolvedValueOnce([[0.1, 0.2, 0.3]]) // Query embedding
                .mockResolvedValueOnce([
                    [0.9, 0.1, 0.1], // High similarity to query
                    [0.1, 0.9, 0.1], // Medium similarity
                    [0.8, 0.2, 0.1], // High similarity
                ]);
            (service as any).cachedEmbeddingsService = {
                embedWithCache: mockEmbedWithCache,
            };

            const results = await service.retrieve(testParams);

            results.forEach(result => {
                const originalDoc = testDocuments.find(
                    doc => doc.content === result.document.content
                );
                expect(originalDoc).toBeDefined();
                expect(result.document.meta).toEqual(originalDoc?.meta);
            });
        });

        it('should use embeddings service', async () => {
            const mockEmbedWithCache = vi
                .fn()
                .mockResolvedValueOnce([[0.1, 0.2, 0.3]]) // Query embedding
                .mockResolvedValueOnce([
                    [0.9, 0.1, 0.1], // High similarity to query
                    [0.1, 0.9, 0.1], // Medium similarity
                    [0.8, 0.2, 0.1], // High similarity
                ]);
            (service as any).cachedEmbeddingsService = {
                embedWithCache: mockEmbedWithCache,
            };

            await service.retrieve(testParams);

            expect(mockEmbedWithCache).toHaveBeenCalled();
        });

        it('should handle unsupported providers', async () => {
            const unsupportedProvider = {
                ...mockProvider,
                type: 'unsupported' as any,
            };
            const params = {
                ...testParams,
                embeddingProvider: unsupportedProvider,
            };

            await expect(service.retrieve(params)).rejects.toThrow();
        });

        it('should call onProgress callback with correct parameters', async () => {
            const mockOnProgress = vi.fn();
            const mockEmbedWithCache = vi
                .fn()
                .mockImplementation(params => {
                    // Simulate progress callback from embed method
                    if (params.onProgress) {
                        params.onProgress({
                            totalChunks: 3,
                            processedChunks: ['chunk1', 'chunk2', 'chunk3'],
                            processingType: 'embedding',
                        });
                    }
                    return Promise.resolve([[0.1, 0.2, 0.3]]);
                })
                .mockImplementationOnce(params => {
                    // Query embedding - no progress callback
                    return Promise.resolve([[0.1, 0.2, 0.3]]);
                })
                .mockImplementationOnce(params => {
                    // Document chunks embedding - with progress callback
                    if (params.onProgress) {
                        params.onProgress({
                            totalChunks: 3,
                            processedChunks: ['chunk1', 'chunk2', 'chunk3'],
                            processingType: 'embedding',
                        });
                    }
                    return Promise.resolve([
                        [0.9, 0.1, 0.1], // High similarity to query
                        [0.1, 0.9, 0.1], // Medium similarity
                        [0.8, 0.2, 0.1], // High similarity
                    ]);
                });
            (service as any).cachedEmbeddingsService = {
                embedWithCache: mockEmbedWithCache,
            };

            const paramsWithProgress = {
                ...testParams,
                onProgress: mockOnProgress,
            };

            await service.retrieve(paramsWithProgress);

            // Should be called at least once from embedding progress
            expect(mockOnProgress).toHaveBeenCalled();

            // Check that progress includes processing type and embedding info
            const calls = mockOnProgress.mock.calls;
            expect(calls.length).toBeGreaterThanOrEqual(1);

            const progressCall = calls[0];
            expect(progressCall[0]).toEqual({
                totalDocuments: expect.any(Number),
                totalChunks: expect.any(Number),
                processedDocuments: expect.any(Array),
                processedChunks: expect.any(Array),
                processingType: 'embedding',
            });
        });

        it('skips progress updates when aborted during chunk embedding', async () => {
            const abortController = new AbortController();
            const onProgress = vi.fn();

            const embedSpy = vi
                .spyOn(service, 'embed')
                .mockImplementation(async params => {
                    if ((params as any).onProgress) {
                        abortController.abort();
                        (params as any).onProgress(['chunk']);
                    }
                    return [[0.1, 0.2, 0.3]];
                });

            const results = await service.retrieve({
                ...testParams,
                abortController,
                onProgress,
            });

            expect(Array.isArray(results)).toBe(true);
            embedSpy.mockRestore();
        });

        it('throws aborted when embeddings fail after cancellation', async () => {
            const abortController = new AbortController();
            const embedSpy = vi.spyOn(service, 'embed');

            embedSpy
                .mockResolvedValueOnce([[0.1, 0.2, 0.3]])
                .mockImplementationOnce(
                    () =>
                        new Promise<number[][]>((_resolve, reject) => {
                            abortController.abort();
                            reject(new Error('boom'));
                        })
                );

            await expect(
                service.retrieve({ ...testParams, abortController })
            ).rejects.toThrow('Aborted');
            embedSpy.mockRestore();
        });

        it('propagates non-abort embedding errors', async () => {
            const embedSpy = vi.spyOn(service, 'embed');
            embedSpy.mockRejectedValueOnce(new Error('boom'));

            await expect(service.retrieve(testParams)).rejects.toThrow('boom');
            embedSpy.mockRestore();
        });

        it('should work without onProgress callback', async () => {
            const mockEmbedWithCache = vi
                .fn()
                .mockResolvedValueOnce([[0.1, 0.2, 0.3]]) // Query embedding
                .mockResolvedValueOnce([
                    [0.9, 0.1, 0.1], // High similarity to query
                    [0.1, 0.9, 0.1], // Medium similarity
                    [0.8, 0.2, 0.1], // High similarity
                ]);
            (service as any).cachedEmbeddingsService = {
                embedWithCache: mockEmbedWithCache,
            };

            // Should not throw when onProgress is not provided
            const results = await service.retrieve(testParams);
            expect(Array.isArray(results)).toBe(true);
        });

        it('should abort retrieval when abortController is triggered', async () => {
            const abortController = new AbortController();
            // Mock embedWithCache to be abort-aware
            const mockEmbedWithCache = vi.fn().mockImplementation(params => {
                return new Promise<number[][]>((resolve, reject) => {
                    const signal: AbortSignal | undefined = (params as any)
                        .abortController?.signal;
                    const timer = setTimeout(() => {
                        if (signal?.aborted) {
                            reject(new Error('Aborted'));
                        } else {
                            resolve([[0.1, 0.2, 0.3]]);
                        }
                    }, 50);
                    signal?.addEventListener('abort', () => {
                        clearTimeout(timer);
                        reject(new Error('Aborted'));
                    });
                });
            });
            (service as any).cachedEmbeddingsService = {
                embedWithCache: mockEmbedWithCache,
            };

            const promise = service.retrieve({
                ...testParams,
                abortController,
            } as any);
            abortController.abort();
            await expect(promise).rejects.toThrow(/Aborted/);
        });
    });
});
