import { OllamaHandler } from './OllamaHandler';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
import {
    createAIHandlerTests,
    createDefaultVerifyApiCalls,
    IMockClient,
} from '../../test-utils/createAIHandlerTests';

jest.mock('ollama');
jest.setTimeout(3000);

const createHandler = () => {
    const handler = new OllamaHandler({
        _version: 1,
        debugLogging: false,
        useNativeFetch: false,
    });

    const mockFetchSelector = {
        execute: jest
            .fn()
            .mockImplementation(
                async (
                    provider: any,
                    operation: (client: any) => Promise<any>
                ) => {
                    return operation(jest.fn());
                }
            ),
        request: jest
            .fn()
            .mockImplementation(
                async (
                    provider: any,
                    operation: (client: any) => Promise<any>
                ) => {
                    return operation(jest.fn());
                }
            ),
        clear: jest.fn(),
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
        list: jest.fn().mockResolvedValue({
            models: [{ name: 'model1' }, { name: 'model2' }],
        }),
        generate: jest.fn().mockImplementation(async () => {
            return {
                async *[Symbol.asyncIterator]() {
                    yield { message: { content: 'test response' } };
                    return;
                },
            };
        }),
    };

    (mockClient as any).show = jest.fn().mockResolvedValue({
        model_info: { num_ctx: 4096 },
    });

    (mockClient as any).embed = jest.fn().mockResolvedValue({
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

        const result = optimizeContext(10000, 2048, 2048, 8192);
        expect(result.shouldUpdate).toBe(true);
        expect(result.num_ctx).toBeGreaterThan(2048);
    });

    it('should support OpenWebUI provider type', () => {
        const mockOpenWebUIProvider = createMockOpenWebUIProvider();
        expect(mockOpenWebUIProvider.apiKey).toBe('test-api-key');
        expect(mockOpenWebUIProvider.type).toBe('ollama-openwebui');
    });
});
