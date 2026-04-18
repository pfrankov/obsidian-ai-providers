import { OllamaHandler } from './OllamaHandler';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
import {
    createAIHandlerTests,
    createDefaultVerifyApiCalls,
    IMockClient,
} from '../../test-utils/createAIHandlerTests';
import { Ollama } from 'ollama';
import type { Mock } from 'vitest';

vi.mock('ollama', () => ({
    Ollama: vi.fn().mockImplementation(function () {
        return {
            list: vi.fn(),
            generate: vi.fn(),
            chat: vi.fn(),
            embed: vi.fn(),
            show: vi.fn(),
            abort: vi.fn(),
        };
    }),
}));

const createHandler = () => {
    const handler = new OllamaHandler({
        _version: 1,
        debugLogging: false,
        useNativeFetch: false,
    });

    const mockFetchSelector = {
        execute: vi
            .fn()
            .mockImplementation(
                async (
                    provider: any,
                    operation: (client: any) => Promise<any>
                ) => {
                    return operation(vi.fn());
                }
            ),
        request: vi
            .fn()
            .mockImplementation(
                async (
                    provider: any,
                    operation: (client: any) => Promise<any>
                ) => {
                    return operation(vi.fn());
                }
            ),
        clear: vi.fn(),
    };

    (handler as any).fetchSelector = mockFetchSelector;
    return handler;
};

const createMockProvider = (): IAIProvider => ({
    id: 'test-provider',
    name: 'Test Provider',
    type: 'ollama',
    url: 'http://localhost:11434',
    apiKey: '',
    model: 'llama2',
});

const createMockOpenWebUIProvider = (): IAIProvider => ({
    id: 'test-openwebui-provider',
    name: 'Test OpenWebUI Provider',
    type: 'ollama-openwebui',
    url: 'http://localhost:3000/ollama',
    apiKey: 'test-api-key',
    model: 'llama2',
});

const createMockClient = (): IMockClient => {
    const mockClient: IMockClient = {
        list: vi.fn().mockResolvedValue({
            models: [{ name: 'model1' }, { name: 'model2' }],
        }),
        generate: vi.fn().mockImplementation(async () => {
            return {
                async *[Symbol.asyncIterator]() {
                    yield { message: { content: 'test response' } };
                    return;
                },
            };
        }),
    };

    (mockClient as any).show = vi.fn().mockResolvedValue({
        model_info: { num_ctx: 4096 },
    });

    (mockClient as any).embed = vi.fn().mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3]],
    });

    (mockClient as any).chat = (mockClient as any).generate;

    return mockClient;
};

const verifyApiCalls = createDefaultVerifyApiCalls({
    formatImages: images =>
        images?.map(img => img.replace(/^data:image\/(.*?);base64,/, '')),
    apiField: 'chat',
    imagesInMessages: true,
});

// Main test suite using shared test utilities
createAIHandlerTests(
    'OllamaHandler',
    createHandler,
    createMockProvider,
    createMockClient,
    verifyApiCalls,
    {
        mockStreamResponse: { message: { content: 'test response' } },
        contextOptimizationOptions: {
            setupContextMock: (mockClient: IMockClient) => {
                (mockClient as any).show.mockResolvedValue({
                    model_info: { num_ctx: 4096 },
                });
            },
            verifyContextOptimization: async (
                _handler: any,
                mockClient: IMockClient
            ) => {
                expect((mockClient as any).show).toHaveBeenCalledWith({
                    model: 'llama2',
                });
            },
        },
        cachingOptions: {
            setupCacheMock: (mockClient: IMockClient) => {
                mockClient.show?.mockResolvedValue({
                    model_info: { num_ctx: 4096 },
                });
            },
            verifyCaching: async (handler: any, mockClient: IMockClient) => {
                expect((mockClient as any).show).toHaveBeenCalled();
            },
        },
        embeddingOptions: {
            progressBehavior: 'per-item',
        },
        imageHandlingOptions: {
            verifyImageHandling: async (_handler, mockClient) => {
                const chatCalls = (mockClient as any).chat.mock.calls;
                if (chatCalls.length > 0) {
                    const lastCall = chatCalls[chatCalls.length - 1][0];
                    if (lastCall.images && lastCall.images.length > 0) {
                        expect(lastCall.images[0]).not.toContain('data:image/');
                    }
                }
            },
        },
    }
);

// Basic functionality tests
describe('Ollama Specific Features', () => {
    it('should optimize context size for large inputs', () => {
        const handler = new OllamaHandler({
            _version: 1,
            debugLogging: false,
            useNativeFetch: false,
        });
        const optimizeContext = (handler as any).optimizeContext.bind(handler);

        const result = optimizeContext({
            inputLength: 10000,
            lastContextLength: 2048,
            defaultContextLength: 2048,
            limit: 8192,
        });
        expect(result.shouldUpdate).toBe(true);
        expect(result.num_ctx).toBeGreaterThan(2048);
    });

    it('should support OpenWebUI provider type', () => {
        const mockOpenWebUIProvider = createMockOpenWebUIProvider();
        expect(mockOpenWebUIProvider.apiKey).toBe('test-api-key');
        expect(mockOpenWebUIProvider.type).toBe('ollama-openwebui');
    });
});

describe('OllamaHandler edge cases', () => {
    it('throws when neither messages nor prompt are provided', () => {
        const handler = createHandler();
        expect(() =>
            (handler as any).prepareChatMessages({
                provider: createMockProvider(),
            })
        ).toThrow('Either messages or prompt must be provided');
    });

    it('falls back to default model info when lookup fails', async () => {
        const handler = createHandler();
        const mockClient = {
            chat: vi.fn().mockResolvedValue({
                async *[Symbol.asyncIterator]() {
                    yield { message: { content: 'ok' }, done: true };
                },
            }),
        };

        vi.spyOn(handler as any, 'getCachedModelInfo').mockRejectedValueOnce(
            new Error('fail')
        );

        const result = await (handler as any).executeOllamaGeneration({
            params: {
                provider: createMockProvider(),
                prompt: 'hi',
            },
            ollama: mockClient,
        });

        expect(result).toEqual(
            expect.objectContaining({ role: 'assistant', content: 'ok' })
        );
        expect(mockClient.chat).toHaveBeenCalled();
    });

    it('aborts embed operations when the controller is cancelled', async () => {
        const handler = createHandler();
        const abortController = new AbortController();
        const mockClient = {
            abort: vi.fn(),
            embed: vi.fn().mockResolvedValue({
                embeddings: [[0.1, 0.2, 0.3]],
            }),
        };

        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        const embedPromise = handler.embed({
            provider: createMockProvider(),
            input: ['test'],
            abortController,
        } as any);

        abortController.abort();
        await expect(embedPromise).rejects.toThrow('Aborted');

        expect(mockClient.abort).toHaveBeenCalled();
    });
});

describe('OllamaHandler internal behaviors', () => {
    it('creates clients with authorization headers when apiKey is set', () => {
        const handler = createHandler();
        const provider = { ...createMockProvider(), apiKey: 'secret-key' };
        const fetchFn = vi.fn();
        (Ollama as unknown as Mock).mockImplementation(function () {
            return {};
        });

        (handler as any).getClient(provider, fetchFn);

        expect(Ollama).toHaveBeenCalledWith(
            expect.objectContaining({
                headers: { Authorization: 'Bearer secret-key' },
            })
        );
    });

    it('uses cached model info when available', async () => {
        const handler = createHandler();
        const provider = createMockProvider();
        const modelName = 'llama2';
        (handler as any).modelInfoCache.set(`${provider.url}_${modelName}`, {
            contextLength: 4096,
            lastContextLength: 2048,
        });

        const result = await (handler as any).getCachedModelInfo(
            provider,
            modelName
        );

        expect(result.contextLength).toBe(4096);
    });

    it('uses openwebui config for model lookups', async () => {
        const handler = createHandler();
        const provider = createMockOpenWebUIProvider();
        const mockClient = {
            show: vi.fn().mockResolvedValue({ model_info: {} }),
        };
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await (handler as any).getCachedModelInfo(provider, 'llama2');

        expect(mockClient.show).toHaveBeenCalledWith({ name: 'llama2' });
    });

    it('uses native fetch when configured', async () => {
        const handler = new OllamaHandler({
            _version: 1,
            debugLogging: false,
            useNativeFetch: true,
        });
        const provider = createMockProvider();
        const mockClient = {
            show: vi.fn().mockResolvedValue({ model_info: {} }),
        };
        const getClientSpy = vi
            .spyOn(handler as any, 'getClient')
            .mockReturnValue(mockClient);

        await (handler as any).getCachedModelInfo(provider, 'llama2');

        expect(getClientSpy).toHaveBeenCalledWith(provider, globalThis.fetch);
    });

    it('marks fetchModels operations as aborted', async () => {
        const handler = createHandler();
        const abortController = new AbortController();
        const mockClient = {
            abort: vi.fn(),
            list: vi.fn().mockResolvedValue({ models: [] }),
        };

        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        const promise = handler.fetchModels({
            provider: createMockProvider(),
            abortController,
        });

        abortController.abort();
        await expect(promise).rejects.toThrow('Aborted');

        expect(mockClient.abort).toHaveBeenCalled();
    });

    it('optimizes context without updates for small inputs', () => {
        const handler = createHandler();
        const optimizeContext = (handler as any).optimizeContext.bind(handler);

        const result = optimizeContext({
            inputLength: 10,
            lastContextLength: 512,
            defaultContextLength: 2048,
            limit: 2048,
        });

        expect(result.shouldUpdate).toBe(false);
        expect(result.num_ctx).toBeUndefined();
    });

    it('reuses lastContextLength when larger than default', () => {
        const handler = createHandler();
        const optimizeContext = (handler as any).optimizeContext.bind(handler);

        const result = optimizeContext({
            inputLength: 10,
            lastContextLength: 4096,
            defaultContextLength: 2048,
            limit: 8192,
        });

        expect(result.shouldUpdate).toBe(false);
        expect(result.num_ctx).toBe(4096);
    });

    it('uses default context lengths when model info is empty', () => {
        const handler = createHandler();
        const optimizeSpy = vi.spyOn(handler as any, 'optimizeContext');
        const provider = createMockProvider();

        const result = (handler as any).applyContextOptimization({
            provider,
            modelName: provider.model,
            inputLength: 10,
            modelInfo: { contextLength: 0, lastContextLength: 0 },
            defaultContextLength: 2048,
        });

        expect(optimizeSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                lastContextLength: 2048,
                limit: 2048,
            })
        );
        expect(result).toBeUndefined();
    });

    it('adds images to empty chat when none exist', () => {
        const handler = createHandler();
        const chatMessages: any[] = [];

        (handler as any).applyImagesToChatMessages(chatMessages, ['img1']);

        expect(chatMessages).toHaveLength(1);
        expect(chatMessages[0].images).toEqual(['img1']);
    });

    it('updates model info on completed stream', async () => {
        const handler = createHandler();
        const setSpy = vi.spyOn(
            handler as any,
            'setModelInfoLastContextLength'
        );
        const response = {
            async *[Symbol.asyncIterator]() {
                yield {
                    message: { content: 'ok' },
                    done: true,
                    total_duration: 10,
                    context: [1, 2, 3],
                };
            },
        };

        const result = await (handler as any).streamOllamaResponse({
            response,
            provider: createMockProvider(),
            modelName: 'llama2',
        });

        expect(result).toEqual(
            expect.objectContaining({ role: 'assistant', content: 'ok' })
        );
        expect(setSpy).toHaveBeenCalled();
    });

    it('keeps cached context length when updates provide no value', () => {
        const handler = createHandler();
        const provider = createMockProvider();
        const cacheKey = `${provider.url}_${provider.model}`;
        (handler as any).modelInfoCache.set(cacheKey, {
            contextLength: 2048,
            lastContextLength: 512,
        });

        (handler as any).setModelInfoLastContextLength(provider, 'llama2', 0);

        expect(
            (handler as any).modelInfoCache.get(cacheKey)?.lastContextLength
        ).toBe(512);
    });

    it('supports empty model names for generation and embeddings', async () => {
        const handler = createHandler();
        const provider = { ...createMockProvider(), model: '' };
        const mockClient = {
            chat: vi.fn().mockResolvedValue({
                async *[Symbol.asyncIterator]() {
                    yield { message: { content: 'ok' } };
                },
            }),
            embed: vi.fn().mockResolvedValue({
                embeddings: [[0.1, 0.2, 0.3]],
            }),
        };

        vi.spyOn(handler as any, 'getCachedModelInfo').mockResolvedValue({
            contextLength: 2048,
            lastContextLength: 2048,
        });

        const result = await (handler as any).executeOllamaGeneration({
            params: {
                provider,
                prompt: 'hi',
            },
            ollama: mockClient,
        });

        expect(result).toEqual(
            expect.objectContaining({ role: 'assistant', content: 'ok' })
        );
        expect(mockClient.chat).toHaveBeenCalledWith(
            expect.objectContaining({ model: '' })
        );

        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        const embeddings = await handler.embed({
            provider,
            input: 'test',
        } as any);

        expect(embeddings).toHaveLength(1);
        expect(mockClient.embed).toHaveBeenCalledWith(
            expect.objectContaining({ model: '' })
        );
    });

    it('aborts embed client when signal triggers mid-request', async () => {
        const handler = createHandler();
        const abortController = new AbortController();
        const mockClient = {
            abort: vi.fn(),
            embed: vi.fn(
                () =>
                    new Promise((_resolve, reject) => {
                        abortController.signal.addEventListener('abort', () =>
                            reject(new Error('Aborted'))
                        );
                    })
            ),
        };

        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);
        vi.spyOn(handler as any, 'getCachedModelInfo').mockResolvedValue({
            contextLength: 2048,
            lastContextLength: 2048,
        });
        const addListenerSpy = vi.spyOn(
            abortController.signal,
            'addEventListener'
        );

        const promise = handler.embed({
            provider: createMockProvider(),
            input: ['test'],
            abortController,
        } as any);

        await Promise.resolve();
        const abortHandler = addListenerSpy.mock.calls.find(
            call => call[0] === 'abort'
        )?.[1] as (() => void) | undefined;
        expect(abortHandler).toBeDefined();
        abortHandler?.();
        expect(mockClient.abort).toHaveBeenCalledTimes(1);
        abortController.abort();
        await expect(promise).rejects.toThrow('Aborted');
        expect(mockClient.abort).toHaveBeenCalled();
    });

    it('extracts text and images from message content blocks', () => {
        const handler = createHandler();
        const provider = createMockProvider();

        const result = (handler as any).prepareChatMessages({
            provider,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'hello' },
                        {
                            type: 'image_url',
                            image_url: { url: 'data:image/png;base64,abc' },
                        },
                    ],
                    images: ['data:image/png;base64,extra'],
                },
            ],
        });

        expect(result.chatMessages[0].content).toContain('hello');
        expect(result.extractedImages.length).toBe(2);
    });

    it('maps OpenAI-style tool history and tools config to Ollama payload', async () => {
        const handler = createHandler();
        const provider = createMockProvider();
        const mockClient = {
            chat: vi.fn().mockResolvedValue({
                async *[Symbol.asyncIterator]() {
                    yield {
                        message: {
                            tool_calls: [
                                {
                                    function: {
                                        name: 'lookup',
                                        arguments: { city: 'Moscow' },
                                    },
                                },
                            ],
                        },
                        done: true,
                        total_duration: 1,
                        context: [1],
                    };
                },
            }),
        };

        vi.spyOn(handler as any, 'getCachedModelInfo').mockResolvedValue({
            contextLength: 4096,
            lastContextLength: 2048,
        });
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        const message = await handler.toolsExecute({
            provider,
            messages: [
                {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                        {
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'sum',
                                arguments: '{"a":1}',
                            },
                        },
                        {
                            id: 'call_2',
                            type: 'function',
                            function: {
                                name: 'broken',
                                arguments: '{bad-json',
                            },
                        },
                    ],
                },
                {
                    role: 'tool',
                    name: 'sum',
                    tool_call_id: 'call_1',
                    content: '42',
                },
            ],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'top_level_tool',
                        parameters: { type: 'object', properties: {} },
                    },
                },
            ],
        } as any);

        const [payload] = (mockClient.chat as Mock).mock.calls[0];
        expect(payload.tools[0].function.name).toBe('top_level_tool');
        expect(payload.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    role: 'assistant',
                    tool_calls: [
                        expect.objectContaining({
                            function: {
                                name: 'sum',
                                arguments: { a: 1 },
                            },
                        }),
                        expect.objectContaining({
                            function: {
                                name: 'broken',
                                arguments: { raw: '{bad-json' },
                            },
                        }),
                    ],
                }),
                expect.objectContaining({
                    role: 'tool',
                    tool_name: 'sum',
                    content: '42',
                }),
            ])
        );
        expect(message).toEqual({
            role: 'assistant',
            content: null,
            tool_calls: [
                {
                    id: 'call_1',
                    type: 'function',
                    function: {
                        name: 'lookup',
                        arguments: '{"city":"Moscow"}',
                    },
                },
            ],
        });
    });

    it('rejects tool config in options and unsupported tool_choice for Ollama', async () => {
        const handler = createHandler();
        const provider = createMockProvider();
        const mockClient = createMockClient();

        vi.spyOn(handler as any, 'getCachedModelInfo').mockResolvedValue({
            contextLength: 4096,
            lastContextLength: 2048,
        });
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await expect(
            handler.toolsExecute({
                provider,
                messages: [{ role: 'user', content: 'hi' }],
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'top_level_tool',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                ],
                options: {
                    tools: [],
                },
            } as any)
        ).rejects.toThrow(
            'Pass tools and tool_choice as top-level toolsExecute params'
        );

        await expect(
            handler.toolsExecute({
                provider,
                messages: [{ role: 'user', content: 'hi' }],
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'top_level_tool',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                ],
                options: {
                    tool_choice: 'auto',
                },
            } as any)
        ).rejects.toThrow(
            'Pass tools and tool_choice as top-level toolsExecute params'
        );

        await expect(
            handler.toolsExecute({
                provider,
                messages: [{ role: 'user', content: 'hi' }],
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'top_level_tool',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                ],
                tool_choice: 'required',
            } as any)
        ).rejects.toThrow('tool_choice is not supported for Ollama providers');
    });

    it('stringifyToolArguments supports string and fallback conversion', () => {
        const handler = createHandler();

        expect((handler as any).stringifyToolArguments('raw')).toBe('raw');
        expect((handler as any).stringifyToolArguments(undefined)).toBe('{}');

        const circular: any = {};
        circular.self = circular;
        expect((handler as any).stringifyToolArguments(circular)).toBe(
            '[object Object]'
        );
    });

    it('wraps non-object parsed tool arguments as value', () => {
        const handler = createHandler();
        const result = (handler as any).parseToolArguments({
            id: 'call_1',
            type: 'function',
            function: {
                name: 'numberTool',
                arguments: '1',
            },
        });

        expect(result).toEqual({ value: 1 });
    });

    it('execute returns empty string when stream has only tool calls', async () => {
        const handler = createHandler();
        const provider = createMockProvider();
        const mockClient = {
            chat: vi.fn().mockResolvedValue({
                async *[Symbol.asyncIterator]() {
                    yield {
                        message: {
                            tool_calls: [
                                {
                                    function: {
                                        name: 'lookup',
                                        arguments: { q: 'x' },
                                    },
                                },
                            ],
                        },
                    };
                },
            }),
        };

        vi.spyOn(handler as any, 'getCachedModelInfo').mockResolvedValue({
            contextLength: 4096,
            lastContextLength: 2048,
        });
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        const result = await handler.execute({
            provider,
            prompt: 'tool only',
        } as any);

        expect(result).toBe('');
    });

    it('toolsExecute passes regular options, empty model and abort signal', async () => {
        const handler = createHandler();
        const provider = { ...createMockProvider(), model: '' };
        const abortController = new AbortController();
        const onProgress = vi.fn();
        const mockClient = {
            abort: vi.fn(),
            chat: vi.fn().mockResolvedValue({
                async *[Symbol.asyncIterator]() {
                    yield {
                        message: { content: 'ok' },
                        done: true,
                        total_duration: 1,
                        context: [1, 2, 3],
                    };
                },
            }),
        };

        vi.spyOn(handler as any, 'getCachedModelInfo').mockResolvedValue({
            contextLength: 4096,
            lastContextLength: 2048,
        });
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await handler.toolsExecute({
            provider,
            messages: [
                {
                    role: 'developer',
                    content: 'a'.repeat(10000),
                },
            ],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'tool_name',
                        parameters: { type: 'object', properties: {} },
                    },
                },
            ],
            options: {
                temperature: 0.2,
            },
            abortController,
            onProgress,
        } as any);

        expect(mockClient.chat).toHaveBeenCalledWith(
            expect.objectContaining({
                model: '',
                messages: [
                    expect.objectContaining({
                        role: 'system',
                    }),
                ],
                options: expect.objectContaining({
                    temperature: 0.2,
                    num_ctx: expect.any(Number),
                }),
            })
        );
        expect(onProgress).toHaveBeenCalled();
    });

    it('toolsExecute wires abort listeners to Ollama client', async () => {
        const handler = createHandler();
        const provider = createMockProvider();
        const abortController = new AbortController();
        const addListenerSpy = vi.spyOn(
            abortController.signal,
            'addEventListener'
        );
        const mockClient = {
            abort: vi.fn(),
            chat: vi.fn().mockResolvedValue({
                async *[Symbol.asyncIterator]() {
                    yield {
                        message: { content: 'ok' },
                    };
                },
            }),
        };

        vi.spyOn(handler as any, 'getCachedModelInfo').mockResolvedValue({
            contextLength: 4096,
            lastContextLength: 2048,
        });
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        const promise = handler.toolsExecute({
            provider,
            messages: [{ role: 'user', content: 'tool only' }],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'tool_name',
                        parameters: { type: 'object', properties: {} },
                    },
                },
            ],
            abortController,
        } as any);

        await Promise.resolve();
        const abortHandler = addListenerSpy.mock.calls.find(
            call => call[0] === 'abort'
        )?.[1] as (() => void) | undefined;
        abortHandler?.();

        await promise;
        expect(mockClient.abort).toHaveBeenCalled();
    });

    it('toolsExecute falls back to default model info and propagates aborted errors', async () => {
        const handler = createHandler();
        const provider = createMockProvider();
        const mockClient = {
            abort: vi.fn(),
            chat: vi.fn().mockResolvedValue({
                async *[Symbol.asyncIterator]() {
                    yield {
                        message: { content: 'ok' },
                    };
                },
            }),
        };

        vi.spyOn(handler as any, 'getCachedModelInfo').mockRejectedValue(
            new Error('fail')
        );
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        const result = await handler.toolsExecute({
            provider,
            messages: [{ role: 'user', content: 'tool only' }],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'tool_name',
                        parameters: { type: 'object', properties: {} },
                    },
                },
            ],
        } as any);
        expect(result.content).toBe('ok');

        vi.spyOn((handler as any).fetchSelector, 'execute').mockRejectedValue(
            new Error('Aborted')
        );

        await expect(
            handler.toolsExecute({
                provider,
                messages: [{ role: 'user', content: 'tool only' }],
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'tool_name',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                ],
            } as any)
        ).rejects.toThrow('Aborted');
    });

    it('normalizes developer role and rejects unsupported legacy roles', async () => {
        const handler = createHandler();

        expect((handler as any).normalizeMessageRole('developer')).toBe(
            'system'
        );
        expect(() => (handler as any).normalizeMessageRole('function')).toThrow(
            'Unsupported message role: function'
        );
    });
});
