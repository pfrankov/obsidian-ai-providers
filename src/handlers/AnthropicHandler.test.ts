import { IAIProvider } from '@obsidian-ai-providers/sdk';
import {
    createAIHandlerTests,
    IMockClient,
    IVerifyApiCallsParams,
} from '../../test-utils/createAIHandlerTests';
import { AnthropicHandler } from './AnthropicHandler';

jest.mock('../utils/FetchSelector', () => ({
    FetchSelector: jest.fn().mockImplementation(() => ({
        execute: jest
            .fn()
            .mockImplementation(async (_provider, operation) =>
                operation(jest.fn())
            ),
        request: jest
            .fn()
            .mockImplementation(async (_provider, operation) =>
                operation(jest.fn())
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
        list: jest.fn().mockImplementation(async function* () {
            yield { id: 'claude-3-opus-20240229' };
            yield { id: 'claude-3-sonnet-20240229' };
        }),
    },
    messages: {
        create: jest.fn().mockResolvedValue({
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
    const [payload] = (mockClient.messages?.create as jest.Mock).mock.calls[0];

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
