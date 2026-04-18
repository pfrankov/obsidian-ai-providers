import { OpenAIHandler } from './OpenAIHandler';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
import {
    createAIHandlerTests,
    createDefaultVerifyApiCalls,
    IMockClient,
} from '../../test-utils/createAIHandlerTests';

vi.mock('openai', () => ({
    default: class OpenAI {
        config: any;
        constructor(config: any) {
            this.config = config;
        }
        chat = {
            completions: {
                create: vi.fn(),
            },
        };
        models = {
            list: vi.fn(),
        };
    },
}));
vi.mock('obsidian', () => ({
    Platform: { isMobileApp: false },
}));

// Mock FetchSelector
vi.mock('../utils/FetchSelector', async () => {
    const originalModule = await vi.importActual<
        typeof import('../utils/FetchSelector')
    >('../utils/FetchSelector');
    return {
        ...originalModule,
        FetchSelector: vi.fn().mockImplementation(function (settings) {
            const instance = new originalModule.FetchSelector(settings);
            instance.execute = vi
                .fn()
                .mockImplementation(async (provider, operation) => {
                    return operation(vi.fn());
                });
            instance.request = vi
                .fn()
                .mockImplementation(async (provider, operation) => {
                    return operation(vi.fn());
                });
            return instance;
        }),
    };
});

const createHandler = () =>
    new OpenAIHandler({
        _version: 1,
        debugLogging: false,
        useNativeFetch: false,
    });

const createMockProvider = (): IAIProvider => ({
    id: 'test-provider',
    name: 'Test Provider',
    type: 'openai',
    url: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    model: 'gpt-4',
});

const createMockClient = (): IMockClient => ({
    models: {
        list: vi.fn().mockResolvedValue({
            data: [{ id: 'model1' }, { id: 'model2' }],
        }),
    },
    chat: {
        completions: {
            create: vi.fn().mockImplementation(async (_params, { signal }) => {
                const responseStream = {
                    async *[Symbol.asyncIterator]() {
                        for (let i = 0; i < 3; i++) {
                            if (signal?.aborted) break;
                            yield {
                                choices: [{ delta: { content: `chunk${i}` } }],
                            };
                        }
                    },
                };
                return responseStream;
            }),
        },
    },
    embeddings: {
        create: vi.fn().mockResolvedValue({
            data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
        }),
    },
});

const verifyApiCalls = createDefaultVerifyApiCalls();

// Main test suite using shared test utilities
createAIHandlerTests(
    'OpenAIHandler',
    createHandler,
    createMockProvider,
    createMockClient,
    verifyApiCalls,
    {
        mockStreamResponse: {
            choices: [{ delta: { content: 'test response' } }],
        },
        imageHandlingOptions: {
            verifyImageHandling: async (_handler, mockClient) => {
                expect(
                    mockClient.chat?.completions.create
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        messages: expect.arrayContaining([
                            expect.objectContaining({
                                content: expect.arrayContaining([
                                    expect.objectContaining({ type: 'text' }),
                                    expect.objectContaining({
                                        type: 'image_url',
                                        image_url: expect.anything(),
                                    }),
                                ]),
                            }),
                        ]),
                    }),
                    expect.anything()
                );
            },
        },
        embeddingOptions: {
            mockEmbeddingResponse: [[0.1, 0.2, 0.3]],
            progressBehavior: 'per-chunk',
            setupEmbedMock: mockClient => {
                (mockClient as any).embeddings = {
                    create: vi.fn().mockResolvedValue({
                        data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
                    }),
                };
            },
        },
    }
);

describe('OpenAIHandler message mapping', () => {
    it('maps content blocks to OpenAI content parts', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        const mockProvider = createMockProvider();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await handler.execute({
            provider: mockProvider,
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
                },
            ],
        } as any);

        const [payload] = (mockClient.chat?.completions.create as any).mock
            .calls[0];
        expect(payload.messages[0].content).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: 'text' }),
                expect.objectContaining({
                    type: 'image_url',
                    image_url: expect.anything(),
                }),
            ])
        );
    });

    it('throws when no messages or prompt are provided', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        const mockProvider = createMockProvider();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await expect(
            handler.execute({ provider: mockProvider } as any)
        ).rejects.toThrow('Either messages or prompt must be provided');
    });

    it('builds clients with correct baseURL for different providers', () => {
        const handler = createHandler();
        const fetchFn = vi.fn() as any;
        const openaiProvider = createMockProvider();
        const openRouterProvider = {
            ...createMockProvider(),
            type: 'openrouter',
            url: '',
        } as IAIProvider;

        const openaiClient = (handler as any).getClient(
            { ...openaiProvider, url: '' },
            fetchFn
        );
        const openRouterClient = (handler as any).getClient(
            openRouterProvider,
            fetchFn
        );

        expect(openaiClient).toBeDefined();
        expect(openRouterClient).toBeDefined();
        expect(openaiClient.config.baseURL).toBeUndefined();
        expect(openRouterClient.config.baseURL).toBe(
            'http://localhost:1234/v1'
        );
    });

    it('passes fetch implementation directly into OpenAI client config', () => {
        const handler = createHandler();
        const fetchFn = vi.fn() as any;
        const provider = createMockProvider();

        const client = (handler as any).getClient(provider, fetchFn);
        expect(client.config.fetch).toBe(fetchFn);
    });

    it('uses placeholder apiKey when provider apiKey is missing', () => {
        const handler = createHandler();
        const fetchFn = vi.fn() as any;
        const provider = { ...createMockProvider(), apiKey: '' };

        const client = (handler as any).getClient(provider, fetchFn);

        expect(client.config.apiKey).toBe('placeholder-key');
    });

    it('falls back to empty model for embeddings and execute', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        const provider = { ...createMockProvider(), model: '' };
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await handler.embed({
            provider,
            input: 'test',
        } as any);

        expect(mockClient.embeddings?.create).toHaveBeenCalledWith(
            expect.objectContaining({ model: '' }),
            expect.anything()
        );

        await handler.execute({
            provider,
            prompt: 'hi',
        } as any);

        expect(mockClient.chat?.completions.create).toHaveBeenCalledWith(
            expect.objectContaining({ model: '' }),
            expect.anything()
        );
    });

    it('passes abort signals to embedding requests', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        const abortController = new AbortController();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await handler.embed({
            provider: createMockProvider(),
            input: 'test',
            abortController,
        } as any);

        expect(mockClient.embeddings?.create).toHaveBeenCalledWith(
            expect.anything(),
            { signal: abortController.signal }
        );
    });
});

// Basic CORS retry test
describe('OpenAI CORS Handling', () => {
    let handler: OpenAIHandler;
    let mockProvider: IAIProvider;

    beforeEach(() => {
        handler = createHandler();
        mockProvider = createMockProvider();
        vi.clearAllMocks();
    });

    it('should handle CORS errors in fetchModels', async () => {
        const mockClient = createMockClient();
        const corsError = new Error('Access blocked by CORS policy');

        mockClient
            .models!.list.mockRejectedValueOnce(corsError)
            .mockResolvedValueOnce({ data: [{ id: 'model1' }] });

        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);
        vi.spyOn((handler as any).fetchSelector, 'request').mockImplementation(
            async (_provider: any, operation: any) => {
                try {
                    return await operation(vi.fn());
                } catch {
                    return await operation(vi.fn());
                }
            }
        );

        const result = await handler.fetchModels({ provider: mockProvider });
        expect(result).toEqual(['model1']);
    });

    it('should support new object param form for fetchModels', async () => {
        const mockClient = createMockClient();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);
        const result = await handler.fetchModels({ provider: mockProvider });
        expect(result).toEqual(expect.any(Array));
    });

    it('should abort with new object param form', async () => {
        const mockClient = createMockClient();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);
        const abortController = new AbortController();
        abortController.abort();
        await expect(
            handler.fetchModels({ provider: mockProvider, abortController })
        ).rejects.toThrow(/Aborted/);
    });

    it('should abort embedding when abortController is aborted', async () => {
        const mockClient = createMockClient();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);
        const abortController = new AbortController();
        abortController.abort();

        await expect(
            handler.embed({
                provider: mockProvider,
                input: 'test',
                abortController,
            } as any)
        ).rejects.toThrow(/Aborted/);
    });
});

describe('OpenAIHandler streaming reasoning', () => {
    it('wraps streamed reasoning in <think>…</think> in output', async () => {
        const handler = createHandler();
        const provider = createMockProvider();
        const mockClient = createMockClient();

        mockClient.chat!.completions.create.mockImplementation(
            async (_params, _options) => {
                return {
                    async *[Symbol.asyncIterator]() {
                        yield { choices: [{ delta: { role: 'assistant' } }] };
                        yield {
                            choices: [
                                {
                                    delta: {
                                        content: '',
                                        reasoning: ' in',
                                    },
                                },
                            ],
                        };
                        yield {
                            choices: [
                                {
                                    delta: {
                                        content: '',
                                        reasoning: ' Markdown.',
                                    },
                                },
                            ],
                        };
                        yield { choices: [{ delta: { content: 'Hello' } }] };
                    },
                };
            }
        );

        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        const onProgress = vi.fn();
        const result = await handler.execute({
            provider,
            prompt: 'hi',
            onProgress,
        } as any);

        expect(result).toBe('<think> in Markdown.</think>Hello');
        expect(onProgress).toHaveBeenCalledTimes(3);
        expect(onProgress).toHaveBeenNthCalledWith(
            1,
            '<think> in',
            '<think> in'
        );
        expect(onProgress).toHaveBeenNthCalledWith(
            2,
            ' Markdown.',
            '<think> in Markdown.'
        );
        expect(onProgress).toHaveBeenNthCalledWith(
            3,
            '</think>Hello',
            '<think> in Markdown.</think>Hello'
        );
    });

    it('closes <think> at the end when only reasoning is streamed', async () => {
        const handler = createHandler();
        const provider = createMockProvider();
        const mockClient = createMockClient();

        mockClient.chat!.completions.create.mockImplementation(
            async (_params, _options) => {
                return {
                    async *[Symbol.asyncIterator]() {
                        yield {
                            choices: [
                                { delta: { content: '', reasoning: 'a' } },
                            ],
                        };
                    },
                };
            }
        );

        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        const onProgress = vi.fn();
        const result = await handler.execute({
            provider,
            prompt: 'hi',
            onProgress,
        } as any);

        expect(result).toBe('<think>a</think>');
        expect(onProgress).toHaveBeenCalledTimes(2);
        expect(onProgress).toHaveBeenNthCalledWith(1, '<think>a', '<think>a');
        expect(onProgress).toHaveBeenNthCalledWith(
            2,
            '</think>',
            '<think>a</think>'
        );
    });
});

describe('OpenAIHandler tool-calling and role mapping', () => {
    it('extracts text from content blocks and maps tool call helper output', () => {
        const handler = createHandler();

        expect(
            (handler as any).extractTextFromContent([
                { type: 'text', text: 'line one' },
                {
                    type: 'image_url',
                    image_url: { url: 'data:image/png;base64,abc' },
                },
                { type: 'text', text: 'line two' },
            ])
        ).toBe('line one\nline two');

        expect(
            (handler as any).mapToolCallsToOpenAI([
                {
                    id: 'call_helper',
                    type: 'function',
                    function: { name: 'helper', arguments: '{}' },
                },
            ])
        ).toEqual([
            {
                id: 'call_helper',
                type: 'function',
                function: { name: 'helper', arguments: '{}' },
            },
        ]);
        expect(
            (handler as any).mapToolCallsToOpenAI(undefined)
        ).toBeUndefined();
    });

    it('maps advanced message roles to OpenAI payload', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        const provider = createMockProvider();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await handler.execute({
            provider,
            messages: [
                {
                    role: 'developer',
                    content: [{ type: 'text', text: 'developer note' }],
                },
                {
                    role: 'assistant',
                    name: 'assistant-name',
                    content: null,
                    tool_calls: [
                        {
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'search',
                                arguments: '{"q":"hello"}',
                            },
                        },
                    ],
                },
                {
                    role: 'tool',
                    tool_call_id: 'call_1',
                    content: [{ type: 'text', text: 'tool response' }],
                },
                {
                    role: 'user',
                    content: null,
                    images: ['data:image/png;base64,abc'],
                },
            ],
        } as any);

        const [payload] = (mockClient.chat?.completions.create as any).mock
            .calls[0];

        expect(payload.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    role: 'developer',
                    content: [{ type: 'text', text: 'developer note' }],
                }),
                expect.objectContaining({
                    role: 'assistant',
                    name: 'assistant-name',
                    tool_calls: [
                        expect.objectContaining({
                            id: 'call_1',
                            type: 'function',
                        }),
                    ],
                }),
                expect.objectContaining({
                    role: 'tool',
                    tool_call_id: 'call_1',
                }),
            ])
        );
    });

    it('maps assistant text parts and appends images for user block content', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        const provider = createMockProvider();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await handler.execute({
            provider,
            messages: [
                {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'assistant text part' }],
                    tool_calls: [
                        {
                            id: 'call_with_parts',
                            type: 'function',
                            function: { name: 'partTool', arguments: '{}' },
                        },
                    ],
                },
                {
                    role: 'user',
                    content: [{ type: 'text', text: 'describe image' }],
                    images: ['data:image/png;base64,extra'],
                },
            ],
        } as any);

        const [payload] = (mockClient.chat?.completions.create as any).mock
            .calls[0];
        expect(payload.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    role: 'assistant',
                    content: [{ type: 'text', text: 'assistant text part' }],
                    tool_calls: [
                        expect.objectContaining({
                            id: 'call_with_parts',
                            function: expect.objectContaining({
                                name: 'partTool',
                            }),
                        }),
                    ],
                }),
                expect.objectContaining({
                    role: 'user',
                    content: expect.arrayContaining([
                        expect.objectContaining({ type: 'text' }),
                        expect.objectContaining({
                            type: 'image_url',
                            image_url: { url: 'data:image/png;base64,extra' },
                        }),
                    ]),
                }),
            ])
        );
    });

    it('throws when unsupported legacy function role is provided', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        const provider = createMockProvider();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await expect(
            handler.execute({
                provider,
                messages: [{ role: 'function', content: 'missing name' }],
            } as any)
        ).rejects.toThrow('Unsupported message role: function');
    });

    it('supports tool string content without legacy function fallback', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        const provider = createMockProvider();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await handler.execute({
            provider,
            messages: [
                {
                    role: 'tool',
                    tool_call_id: 'call_1',
                    content: 'tool output',
                },
            ],
        } as any);

        const [payload] = (mockClient.chat?.completions.create as any).mock
            .calls[0];
        expect(payload.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    role: 'tool',
                    tool_call_id: 'call_1',
                    content: 'tool output',
                }),
            ])
        );
    });

    it('throws when tool message has no tool_call_id', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        const provider = createMockProvider();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await expect(
            handler.execute({
                provider,
                messages: [{ role: 'tool', content: 'missing id' }],
            } as any)
        ).rejects.toThrow('Tool message requires tool_call_id');
    });

    it('passes top-level tools and tool_choice through in toolsExecute', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        const provider = createMockProvider();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await handler.toolsExecute({
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
            tool_choice: {
                type: 'function',
                function: { name: 'top_level_tool' },
            },
        } as any);

        const [payload] = (mockClient.chat?.completions.create as any).mock
            .calls[0];

        expect(payload.tools).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    function: expect.objectContaining({
                        name: 'top_level_tool',
                    }),
                }),
            ])
        );
        expect(payload.tool_choice).toEqual({
            type: 'function',
            function: { name: 'top_level_tool' },
        });
    });

    it('rejects tool configuration passed through options in toolsExecute', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        const provider = createMockProvider();
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
    });

    it('also rejects tool_choice passed through options in toolsExecute', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        const provider = createMockProvider();
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
                    tool_choice: 'auto',
                },
            } as any)
        ).rejects.toThrow(
            'Pass tools and tool_choice as top-level toolsExecute params'
        );
    });

    it('passes string tool_choice values through in OpenAI format', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        const provider = createMockProvider();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await handler.toolsExecute({
            provider,
            messages: [{ role: 'user', content: 'hi' }],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'string_tool_choice',
                        parameters: { type: 'object', properties: {} },
                    },
                },
            ],
            tool_choice: 'required',
        } as any);

        const [payload] = (mockClient.chat?.completions.create as any).mock
            .calls[0];
        expect(payload.tool_choice).toBe('required');
    });

    it('passes regular options and empty model through in toolsExecute', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        const provider = { ...createMockProvider(), model: '' };
        const abortController = new AbortController();
        const onProgress = vi.fn();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await handler.toolsExecute({
            provider,
            messages: [{ role: 'user', content: 'hi' }],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'string_tool_choice',
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

        expect(mockClient.chat?.completions.create).toHaveBeenCalledWith(
            expect.objectContaining({
                model: '',
                tools: expect.any(Array),
                temperature: 0.2,
            }),
            { signal: abortController.signal }
        );
        expect(onProgress).toHaveBeenCalled();
    });

    it('maps null content for tool/system messages and execute returns empty text fallback', async () => {
        const handler = createHandler();
        const provider = createMockProvider();
        const mockClient = createMockClient();

        mockClient.chat!.completions.create.mockImplementation(
            async (_params, _options) => {
                return {
                    async *[Symbol.asyncIterator]() {
                        yield {
                            choices: [
                                {
                                    delta: {
                                        tool_calls: [
                                            {
                                                index: 0,
                                                id: 'call_empty',
                                                type: 'function',
                                                function: {
                                                    name: 'onlyTool',
                                                    arguments: '{}',
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        };
                    },
                };
            }
        );

        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        const result = await handler.execute({
            provider,
            messages: [
                { role: 'system', content: null },
                {
                    role: 'tool',
                    tool_call_id: 'call_empty',
                    content: null,
                },
                { role: 'user', content: 'continue' },
            ],
        } as any);

        expect(result).toBe('');

        const [payload] = (mockClient.chat?.completions.create as any).mock
            .calls[0];
        expect(payload.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ role: 'system', content: [] }),
                expect.objectContaining({
                    role: 'tool',
                    tool_call_id: 'call_empty',
                    content: [],
                }),
            ])
        );
    });

    it('toolsExecute returns OpenAI-style assistant tool calls from streamed deltas', async () => {
        const handler = createHandler();
        const provider = createMockProvider();
        const mockClient = createMockClient();

        mockClient.chat!.completions.create.mockImplementation(
            async (_params, _options) => {
                return {
                    async *[Symbol.asyncIterator]() {
                        yield {
                            choices: [
                                {
                                    delta: {
                                        tool_calls: [
                                            {
                                                index: 0,
                                                id: 'call_1',
                                                type: 'function',
                                                function: {
                                                    name: 'lookupWeather',
                                                    arguments: '{"city":"Mos',
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        };
                        yield {
                            choices: [
                                {
                                    delta: {
                                        tool_calls: [
                                            {
                                                index: 0,
                                                function: {
                                                    arguments: 'cow"}',
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        };
                    },
                };
            }
        );

        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        const assistantMessage = await handler.toolsExecute({
            provider,
            messages: [{ role: 'user', content: 'weather' }],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'lookupWeather',
                        parameters: { type: 'object', properties: {} },
                    },
                },
            ],
        } as any);

        expect(assistantMessage).toEqual({
            role: 'assistant',
            content: null,
            tool_calls: [
                {
                    id: 'call_1',
                    type: 'function',
                    function: {
                        name: 'lookupWeather',
                        arguments: '{"city":"Moscow"}',
                    },
                },
            ],
        });
    });

    it('toolsExecute propagates aborted errors', async () => {
        const handler = createHandler();
        vi.spyOn((handler as any).fetchSelector, 'execute').mockRejectedValue(
            new Error('Aborted')
        );

        await expect(
            handler.toolsExecute({
                provider: createMockProvider(),
                messages: [{ role: 'user', content: 'weather' }],
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'lookupWeather',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                ],
            } as any)
        ).rejects.toThrow('Aborted');
    });
});
