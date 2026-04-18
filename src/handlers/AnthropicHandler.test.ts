import type { Mock } from 'vitest';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
import {
    createAIHandlerTests,
    IMockClient,
    IVerifyApiCallsParams,
} from '../../test-utils/createAIHandlerTests';
import { AnthropicHandler } from './AnthropicHandler';

vi.mock('@anthropic-ai/sdk', () => ({
    default: class Anthropic {
        config: any;
        models = { list: vi.fn() };
        messages = { create: vi.fn() };

        constructor(config: any) {
            this.config = config;
        }
    },
}));

vi.mock('../utils/logger', () => ({
    logger: {
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('../utils/FetchSelector', () => ({
    FetchSelector: vi.fn().mockImplementation(function () {
        return {
            execute: vi
                .fn()
                .mockImplementation(async (_provider, operation) =>
                    operation(vi.fn())
                ),
            request: vi
                .fn()
                .mockImplementation(async (_provider, operation) =>
                    operation(vi.fn())
                ),
        };
    }),
}));

const createHandler = () =>
    new AnthropicHandler({
        _version: 1,
        debugLogging: false,
        useNativeFetch: false,
    } as any);

const createMockProvider = (): IAIProvider => ({
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic' as const,
    apiKey: 'test-key',
    url: 'https://api.anthropic.com',
    model: 'claude-3-opus-20240229',
});

const createMockClient = (): IMockClient => ({
    models: {
        list: vi.fn().mockImplementation(async function* () {
            yield { id: 'claude-3-opus-20240229' };
            yield { id: 'claude-3-sonnet-20240229' };
        }),
    },
    messages: {
        create: vi.fn().mockResolvedValue({
            async *[Symbol.asyncIterator]() {
                yield {
                    type: 'content_block_delta',
                    delta: { text: 'test response' },
                };
            },
        }),
    },
});

const verifyApiCalls = ({
    mockClient,
    executeParams,
}: IVerifyApiCallsParams) => {
    expect(mockClient.messages?.create).toHaveBeenCalled();
    const [payload] = (mockClient.messages?.create as Mock).mock.calls[0];

    expect(payload).toEqual(
        expect.objectContaining({
            model: executeParams.provider.model,
            messages: expect.any(Array),
            stream: true,
            ...executeParams.options,
        })
    );
};

createAIHandlerTests(
    'AnthropicHandler',
    createHandler,
    createMockProvider,
    createMockClient,
    verifyApiCalls,
    {
        mockStreamResponse: {
            type: 'content_block_delta',
            delta: { text: 'test response' },
        },
        embeddingOptions: {
            mode: 'unsupported',
            unsupportedError: /Embeddings are not supported for Anthropic/,
        },
    }
);

describe('AnthropicHandler edge cases', () => {
    it('throws when neither messages nor prompt are provided', () => {
        const handler = createHandler();
        expect(() =>
            (handler as any).buildPayload({ provider: createMockProvider() })
        ).toThrow('Either messages or prompt must be provided');
    });

    it('throws when only system messages are provided', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await expect(
            handler.execute({
                provider: createMockProvider(),
                messages: [{ role: 'system', content: 'system only' }],
            } as any)
        ).rejects.toThrow('At least one message is required');
    });

    it('toolsExecute requires at least one non-system message', () => {
        const handler = createHandler();

        expect(() =>
            (handler as any).buildToolsPayload({
                provider: createMockProvider(),
                messages: [{ role: 'system', content: 'system only' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'tool_name', parameters: {} },
                    },
                ],
            })
        ).toThrow('At least one message is required');
    });

    it('returns null for non-text stream events', () => {
        const handler = createHandler();
        const result = (handler as any).extractTextFromEvent({
            type: 'message_start',
        });
        expect(result).toBeNull();
    });

    it('maps request options and keeps defaults', () => {
        const handler = createHandler();
        const mapped = (handler as any).mapOptions({
            max_tokens: 10,
            temperature: 0.5,
            top_p: 0.9,
            stop: ['stop'],
        });

        expect(mapped).toEqual({
            max_tokens: 10,
            temperature: 0.5,
            top_p: 0.9,
            stop_sequences: ['stop'],
        });
    });

    it('converts supported image URLs and skips unsupported ones', () => {
        const handler = createHandler();
        const result = (handler as any).normalizeContent(
            [
                {
                    type: 'image_url',
                    image_url: { url: 'data:image/png;base64,abc' },
                },
                {
                    type: 'image_url',
                    image_url: { url: 'data:image/bmp;base64,abc' },
                },
            ],
            ['data:image/gif;base64,zzz']
        );

        expect(result.some((block: any) => block.type === 'image')).toBe(true);
    });

    it('returns fallback text content when nothing is extracted', () => {
        const handler = createHandler();
        const result = (handler as any).normalizeContent(
            [{ type: 'image_url', image_url: { url: 'not-a-data-url' } }],
            []
        );

        expect(result).toEqual([{ type: 'text', text: '' }]);
    });

    it('returns array content when multiple blocks exist', () => {
        const handler = createHandler();
        const content = (handler as any).toAnthropicContent([
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
        ]);

        expect(Array.isArray(content)).toBe(true);
    });

    it('buildPayload composes system messages and roles', () => {
        const handler = createHandler();
        const payload = (handler as any).buildPayload({
            provider: createMockProvider(),
            messages: [
                {
                    role: 'system',
                    content: [{ type: 'text', text: 'system' }],
                },
                { role: 'user', content: 'hello' },
                { role: 'assistant', content: 'ok' },
            ],
        });

        expect(payload.system).toBe('system');
        expect(payload.messages[0].role).toBe('user');
        expect(payload.messages[1].role).toBe('assistant');
    });

    it('buildPayload handles empty prompts', () => {
        const handler = createHandler();
        const payload = (handler as any).buildPayload({
            provider: createMockProvider(),
            prompt: '',
        });

        expect(payload.messages[0].content).toBe('');
    });

    it('builds Anthropic client with defaults', () => {
        const handler = createHandler();
        const provider = { ...createMockProvider(), apiKey: '', url: '' };
        const fetchFn = vi.fn();

        const client = (handler as any).getClient(provider, fetchFn);

        expect(client.config.apiKey).toBe('placeholder-key');
        expect(client.config.baseURL).toBe('https://api.anthropic.com');
        expect(client.config.fetch).toBe(fetchFn);
    });

    it('fetchModels returns ids and respects aborts', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);
        const abortController = new AbortController();

        const result = await handler.fetchModels({
            provider: createMockProvider(),
            abortController,
        });

        expect(result).toEqual([
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
        ]);

        abortController.abort();
        await expect(
            handler.fetchModels({
                provider: createMockProvider(),
                abortController,
            })
        ).rejects.toThrow('Aborted');
    });

    it('streams text events and calls onProgress', async () => {
        const handler = createHandler();
        const mockClient = {
            messages: {
                create: vi.fn().mockResolvedValue({
                    async *[Symbol.asyncIterator]() {
                        yield {
                            type: 'content_block_delta',
                            delta: { text: 'a' },
                        };
                        yield { type: 'message_start' };
                        yield {
                            type: 'content_block_delta',
                            delta: { text: 'b' },
                        };
                    },
                }),
            },
        };

        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);
        const onProgress = vi.fn();

        const result = await handler.execute({
            provider: createMockProvider(),
            prompt: 'hi',
            onProgress,
        } as any);

        expect(result).toBe('ab');
        expect(onProgress).toHaveBeenCalled();
    });

    it('uses empty model when provider model is missing', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await handler.execute({
            provider: { ...createMockProvider(), model: '' },
            prompt: 'hi',
        } as any);

        const [payload] = (mockClient.messages?.create as Mock).mock.calls[0];
        expect(payload.model).toBe('');
    });

    it('throws when execute is called after abort', async () => {
        const handler = createHandler();
        const abortController = new AbortController();
        abortController.abort();

        await expect(
            handler.execute({
                provider: createMockProvider(),
                prompt: 'hi',
                abortController,
            } as any)
        ).rejects.toThrow('Aborted');
    });
});

describe('AnthropicHandler tool-calling normalization', () => {
    it('normalizes text blocks and assistant fallback content', () => {
        const handler = createHandler();

        const normalized = (handler as any).normalizeContent(
            [{ type: 'text', text: 'text block' }],
            []
        );
        expect(normalized).toEqual([{ type: 'text', text: 'text block' }]);

        const assistantContent = (handler as any).buildAssistantContent({
            role: 'assistant',
            content: null,
        });
        expect(assistantContent).toBe('');
    });

    it('maps OpenAI-style tool history and top-level tool config to Anthropic payload', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await handler.toolsExecute({
            provider: createMockProvider(),
            messages: [
                { role: 'developer', content: 'dev rules' },
                {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                        {
                            id: 'call_valid',
                            type: 'function',
                            function: {
                                name: 'sum',
                                arguments: '{"a":1}',
                            },
                        },
                        {
                            id: 'call_invalid',
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
                    tool_call_id: 'call_valid',
                    content: '42',
                },
                { role: 'user', content: 'continue' },
            ],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'sum',
                        description: 'sum numbers',
                        parameters: {
                            type: 'object',
                            properties: { a: { type: 'number' } },
                        },
                        strict: true,
                    },
                },
            ],
            tool_choice: {
                type: 'function',
                function: { name: 'sum' },
            },
        } as any);

        const [payload] = (mockClient.messages?.create as Mock).mock.calls[0];
        const assistantMessage = payload.messages.find(
            (message: any) => message.role === 'assistant'
        );
        const toolResultMessage = payload.messages.find(
            (message: any) =>
                message.role === 'user' &&
                Array.isArray(message.content) &&
                message.content[0]?.type === 'tool_result'
        );

        expect(payload.system).toBe('dev rules');
        expect(payload.tools[0].name).toBe('sum');
        expect(payload.tool_choice).toEqual({ type: 'tool', name: 'sum' });
        expect(assistantMessage.content).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: 'tool_use',
                    id: 'call_valid',
                    name: 'sum',
                    input: { a: 1 },
                }),
                expect.objectContaining({
                    type: 'tool_use',
                    id: 'call_invalid',
                    name: 'broken',
                    input: '{bad-json',
                }),
            ])
        );
        expect(toolResultMessage.content[0]).toEqual(
            expect.objectContaining({
                type: 'tool_result',
                tool_use_id: 'call_valid',
                content: '42',
            })
        );
    });

    it('converts Anthropic tool_use stream events into OpenAI tool_calls output', async () => {
        const handler = createHandler();
        const mockClient = {
            messages: {
                create: vi.fn().mockResolvedValue({
                    async *[Symbol.asyncIterator]() {
                        yield {
                            type: 'content_block_start',
                            index: 0,
                            content_block: {
                                type: 'tool_use',
                                id: 'toolu_1',
                                name: 'lookup',
                                input: {},
                            },
                        };
                        yield {
                            type: 'content_block_delta',
                            index: 0,
                            delta: {
                                type: 'input_json_delta',
                                partial_json: '{"city":"Moscow"}',
                            },
                        };
                        yield {
                            type: 'content_block_delta',
                            index: 1,
                            delta: { text: 'done' },
                        };
                    },
                }),
            },
        };
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        const message = await handler.toolsExecute({
            provider: createMockProvider(),
            messages: [{ role: 'user', content: 'weather' }],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'lookup',
                        parameters: { type: 'object', properties: {} },
                    },
                },
            ],
        } as any);

        expect(message).toEqual({
            role: 'assistant',
            content: 'done',
            tool_calls: [
                {
                    id: 'toolu_1',
                    type: 'function',
                    function: {
                        name: 'lookup',
                        arguments: '{"city":"Moscow"}',
                    },
                },
            ],
        });
    });

    it('supports tool_choice variants and tool argument stringification', () => {
        const handler = createHandler();

        expect((handler as any).mapToolChoice('auto')).toEqual({
            type: 'auto',
        });
        expect((handler as any).mapToolChoice('required')).toEqual({
            type: 'any',
        });
        expect((handler as any).mapToolChoice('none')).toEqual({
            type: 'none',
        });

        expect((handler as any).toToolArgumentsString(undefined)).toBe('');
        expect((handler as any).toToolArgumentsString('raw')).toBe('raw');

        const circular: any = {};
        circular.self = circular;
        expect((handler as any).toToolArgumentsString(circular)).toBe(
            '[object Object]'
        );
    });

    it('throws when tool role message has no tool_call_id', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await expect(
            handler.toolsExecute({
                provider: createMockProvider(),
                messages: [{ role: 'tool', content: 'result' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'tool_name', parameters: {} },
                    },
                ],
            } as any)
        ).rejects.toThrow('Tool message requires tool_call_id');
    });

    it('rejects unsupported legacy function role and tool config in options', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await expect(
            handler.toolsExecute({
                provider: createMockProvider(),
                messages: [{ role: 'function', content: 'legacy' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'tool_name', parameters: {} },
                    },
                ],
            } as any)
        ).rejects.toThrow('Unsupported message role: function');

        await expect(
            handler.toolsExecute({
                provider: createMockProvider(),
                messages: [{ role: 'user', content: 'hi' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'tool_name', parameters: {} },
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
                provider: createMockProvider(),
                messages: [{ role: 'user', content: 'hi' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'tool_name', parameters: {} },
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

    it('fills fallback ids and names for tool_use events and handles orphan deltas', () => {
        const handler = createHandler();
        const toolCallsByIndex = new Map();

        (handler as any).appendToolUseStart(toolCallsByIndex, {
            type: 'content_block_start',
            index: 1,
            content_block: {
                type: 'tool_use',
                input: {},
            },
        });

        expect(toolCallsByIndex.get(1)).toEqual({
            id: 'call_2',
            type: 'function',
            function: {
                name: '',
                arguments: '{}',
            },
        });

        (handler as any).appendToolUseDelta(toolCallsByIndex, {
            type: 'content_block_delta',
            index: 3,
            delta: {
                type: 'input_json_delta',
                partial_json: '{"x":1}',
            },
        });

        expect(toolCallsByIndex.get(3)).toEqual({
            id: 'call_4',
            type: 'function',
            function: {
                name: '',
                arguments: '{"x":1}',
            },
        });

        (handler as any).appendToolUseStart(toolCallsByIndex, {
            type: 'content_block_start',
            index: 9,
            content_block: {
                type: 'text',
                text: 'ignore me',
            },
        });

        expect(toolCallsByIndex.has(9)).toBe(false);

        (handler as any).appendToolUseDelta(toolCallsByIndex, {
            type: 'content_block_delta',
            index: 3,
            delta: {
                type: 'input_json_delta',
            },
        });

        expect(toolCallsByIndex.get(3)?.function.arguments).toBe('{"x":1}');
    });

    it('returns null for non-text content block deltas', () => {
        const handler = createHandler();
        const result = (handler as any).extractTextFromEvent({
            type: 'content_block_delta',
            delta: {
                type: 'input_json_delta',
                partial_json: '{}',
            },
        });

        expect(result).toBeNull();

        const textResult = (handler as any).extractTextFromEvent({
            type: 'content_block_delta',
            delta: {
                type: 'text_delta',
                text: 'typed text delta',
            },
        });

        expect(textResult).toBe('typed text delta');
    });

    it('uses default input schema when tool parameters are missing', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await handler.toolsExecute({
            provider: createMockProvider(),
            messages: [{ role: 'user', content: 'tool defaults' }],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'no_params_tool',
                    },
                },
            ],
        } as any);

        const [payload] = (mockClient.messages?.create as Mock).mock.calls[0];
        expect(payload.tools[0]).toEqual(
            expect.objectContaining({
                name: 'no_params_tool',
                input_schema: { type: 'object', properties: {} },
            })
        );
    });

    it('passes regular options and empty model through in toolsExecute', async () => {
        const handler = createHandler();
        const mockClient = createMockClient();
        const abortController = new AbortController();
        const onProgress = vi.fn();
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await handler.toolsExecute({
            provider: { ...createMockProvider(), model: '' },
            messages: [{ role: 'user', content: 'tool defaults' }],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'no_params_tool',
                        parameters: {},
                    },
                },
            ],
            options: {
                temperature: 0.2,
            },
            abortController,
            onProgress,
        } as any);

        expect(mockClient.messages?.create).toHaveBeenCalledWith(
            expect.objectContaining({
                model: '',
                temperature: 0.2,
            }),
            { signal: abortController.signal }
        );
        expect(onProgress).toHaveBeenCalled();
    });

    it('returns null content for toolsExecute and empty string for execute when stream has only tool calls', async () => {
        const handler = createHandler();
        const mockClient = {
            messages: {
                create: vi.fn().mockResolvedValue({
                    async *[Symbol.asyncIterator]() {
                        yield {
                            type: 'content_block_start',
                            index: 0,
                            content_block: {
                                type: 'tool_use',
                                id: 'toolu_only',
                                name: 'only_tool',
                                input: {},
                            },
                        };
                    },
                }),
            },
        };
        vi.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        const toolMessage = await handler.toolsExecute({
            provider: createMockProvider(),
            messages: [{ role: 'user', content: 'tool only' }],
            tools: [
                {
                    type: 'function',
                    function: { name: 'only_tool', parameters: {} },
                },
            ],
        } as any);
        expect(toolMessage.content).toBeNull();
        expect(toolMessage.tool_calls?.[0].id).toBe('toolu_only');

        const executeText = await handler.execute({
            provider: createMockProvider(),
            prompt: 'tool only',
        } as any);
        expect(executeText).toBe('');
    });

    it('toolsExecute propagates aborted errors', async () => {
        const handler = createHandler();
        vi.spyOn((handler as any).fetchSelector, 'execute').mockRejectedValue(
            new Error('Aborted')
        );

        await expect(
            handler.toolsExecute({
                provider: createMockProvider(),
                messages: [{ role: 'user', content: 'tool only' }],
                tools: [
                    {
                        type: 'function',
                        function: { name: 'only_tool', parameters: {} },
                    },
                ],
            } as any)
        ).rejects.toThrow('Aborted');
    });
});
