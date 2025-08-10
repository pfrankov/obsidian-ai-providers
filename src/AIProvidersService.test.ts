import { AIProvidersService } from './AIProvidersService';
import { App } from 'obsidian';
import AIProvidersPlugin from './main';
import {
    IAIProvider,
    IAIProvidersEmbedParams,
    IAIProvidersRetrievalParams,
    IAIDocument,
} from '@obsidian-ai-providers/sdk';

// Mock the handlers
jest.mock('./handlers/OpenAIHandler');
jest.mock('./handlers/OllamaHandler');

// Mock the cache
jest.mock('./cache/EmbeddingsCache', () => ({
    embeddingsCache: {
        init: jest.fn(),
        close: jest.fn(),
        isInitialized: jest.fn().mockReturnValue(true),
    },
}));

// Mock CachedEmbeddingsService
jest.mock('./cache/CachedEmbeddingsService');

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
            saveSettings: jest.fn(),
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
        jest.clearAllMocks();
    });

    it('should always return a promise from embed method', async () => {
        // Mock the CachedEmbeddingsService to return a promise
        const mockEmbedWithCache = jest
            .fn()
            .mockResolvedValue([[0.1, 0.2, 0.3]]);
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
        const mockEmbedWithCache = jest.fn().mockResolvedValue([
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
        expect(service.version).toBe(3);
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
        const { embeddingsCache } = jest.requireMock('./cache/EmbeddingsCache');

        await service.initEmbeddingsCache();

        expect(embeddingsCache.init).toHaveBeenCalledWith('test-app-id');
    });

    describe('execute legacy augmentation', () => {
        beforeEach(() => {
            // Mock handler.execute to stream two chunks then resolve
            const handlers = (service as any).handlers;
            Object.values(handlers).forEach((h: any) => {
                h.execute = jest
                    .fn()
                    .mockImplementation(({ onProgress }: any) => {
                        return new Promise<string>(resolve => {
                            setTimeout(() => {
                                onProgress && onProgress('Hel', 'Hel');
                                onProgress && onProgress('lo', 'Hello');
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
        const { embeddingsCache } = jest.requireMock('./cache/EmbeddingsCache');

        await service.cleanup();

        expect(embeddingsCache.close).toHaveBeenCalled();
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
            const mockEmbedWithCache = jest
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

        it('should preserve document references', async () => {
            // Mock the CachedEmbeddingsService to return embeddings
            const mockEmbedWithCache = jest
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
            const mockEmbedWithCache = jest
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
            const mockOnProgress = jest.fn();
            const mockEmbedWithCache = jest
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

        it('should work without onProgress callback', async () => {
            const mockEmbedWithCache = jest
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
            const mockEmbedWithCache = jest.fn().mockImplementation(params => {
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
