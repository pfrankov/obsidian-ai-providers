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
    FetchSelector: vi.fn().mockImplementation(() => ({
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
    })),
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
