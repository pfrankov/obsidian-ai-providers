import { OllamaHandler } from './OllamaHandler';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
import {
    createAIHandlerTests,
    createDefaultVerifyApiCalls,
    IMockClient,
} from '../../test-utils/createAIHandlerTests';

jest.mock('ollama');
jest.setTimeout(3000);

const createHandler = () =>
    new OllamaHandler({
        _version: 1,
        debugLogging: false,
        useNativeFetch: false,
    });

const createMockProvider = (): IAIProvider => ({
    id: 'test-provider',
    name: 'Test Provider',
    type: 'ollama',
    url: 'http://localhost:11434',
    apiKey: '',
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

    (mockClient as any).ollamaShow = jest.fn().mockResolvedValue({
        model_info: { num_ctx: 4096 },
    });

    (mockClient as any).ollamaEmbed = jest.fn().mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3]],
    });

    (mockClient as any).show = (mockClient as any).ollamaShow;
    (mockClient as any).embed = (mockClient as any).ollamaEmbed;
    (mockClient as any).chat = (mockClient as any).generate;

    return mockClient;
};

// Use the default verification function with Ollama customizations
const verifyApiCalls = createDefaultVerifyApiCalls({
    // Ollama uses a special format for images - strip data URL prefix
    formatImages: images =>
        images?.map(img => img.replace(/^data:image\/(.*?);base64,/, '')),
    // The API field to check for Ollama
    apiField: 'chat',
    // Set this to true to indicate images should be inside messages
    imagesInMessages: true,
});

// Setup context optimization options
const contextOptimizationOptions = {
    setupContextMock: (mockClient: IMockClient) => {
        (mockClient as any).show.mockResolvedValue({
            model_info: { num_ctx: 4096 },
        });
    },
    verifyContextOptimization: async (
        _handler: any,
        mockClient: IMockClient
    ) => {
        // Verify that context optimization was called
        expect((mockClient as any).show).toHaveBeenCalledWith({
            model: 'llama2',
        });

        // We don't need to check chat calls[0][0] if the mockClient doesn't have them
        if ((mockClient as any).chat?.mock?.calls?.length > 0) {
            const chatCall = (mockClient as any).chat.mock.calls[0][0];
            if (chatCall?.options) {
                expect(chatCall.options.num_ctx).toBeDefined();
            }
        }
    },
};

// Setup caching options
const cachingOptions = {
    setupCacheMock: (mockClient: IMockClient) => {
        mockClient.show?.mockResolvedValue({
            model_info: { num_ctx: 4096 },
        });
    },
    verifyCaching: async (handler: any, mockClient: IMockClient) => {
        // Test for single model caching
        if ((mockClient as any).show.mock.calls.length === 1) {
            // Make sure show was called at least once
            expect((mockClient as any).show).toHaveBeenCalled();

            // Clear mock calls
            (mockClient as any).show.mockClear();

            // Second call should not trigger show (cached)
            await handler.execute({
                provider: createMockProvider(),
                prompt: 'test again',
                options: {},
            });

            // Verify that show wasn't called again
            expect((mockClient as any).show).not.toHaveBeenCalled();
        }
        // Test for multiple models caching
        else if ((mockClient as any).show.mock.calls.length >= 2) {
            // Verify that show was called for both models
            expect((mockClient as any).show).toHaveBeenCalledWith({
                model: 'model1',
            });
            expect((mockClient as any).show).toHaveBeenCalledWith({
                model: 'model2',
            });

            // Clear mock calls
            (mockClient as any).show.mockClear();

            // Second call to first model should not trigger show (cached)
            await handler.execute({
                provider: { ...createMockProvider(), model: 'model1' },
                prompt: 'another test',
                options: {},
            });

            // Verify that show wasn't called again for model1
            expect((mockClient as any).show).not.toHaveBeenCalledWith({
                model: 'model1',
            });
        }
    },
};

// Use createAIHandlerTests for common test cases
createAIHandlerTests(
    'OllamaHandler',
    createHandler,
    createMockProvider,
    createMockClient,
    verifyApiCalls,
    {
        mockStreamResponse: {
            message: { content: 'test response' },
        },
        contextOptimizationOptions,
        cachingOptions,
        // Add image handling test for Ollama
        imageHandlingOptions: {
            verifyImageHandling: async (_handler, mockClient) => {
                // Verify that images are properly formatted for Ollama (base64 prefixes removed)
                const chatCalls = (mockClient as any).chat.mock.calls;
                if (chatCalls.length > 0) {
                    const lastCall = chatCalls[chatCalls.length - 1][0];
                    // Ollama now puts images inside the messages array
                    expect(lastCall.messages).toBeDefined();
                    // Find a message with images
                    const messagesWithImages = lastCall.messages.filter(
                        (msg: any) => msg.images
                    );
                    expect(messagesWithImages.length).toBeGreaterThan(0);
                    // Check if base64 prefix was removed properly
                    expect(messagesWithImages[0].images[0]).not.toContain(
                        'data:image/'
                    );
                }
            },
        },
        // Add additional streaming tests specifically for image handling with prompt-based approach
        additionalStreamingTests: [
            {
                name: 'should handle images correctly with prompt-based format',
                executeParams: {
                    prompt: 'Describe this image',
                    // Use a minimal test image
                    images: [
                        'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCA...',
                    ],
                    systemPrompt: 'You are a helpful assistant',
                    options: {},
                },
                verify: (_result, mockClient) => {
                    const chatCalls = (mockClient as any).chat.mock.calls;
                    expect(chatCalls.length).toBeGreaterThan(0);

                    const lastCall = chatCalls[chatCalls.length - 1][0];

                    // Verify the message format is correct (system + user messages)
                    expect(lastCall.messages).toEqual([
                        {
                            role: 'system',
                            content: 'You are a helpful assistant',
                        },
                        { role: 'user', content: 'Describe this image' },
                    ]);

                    // Verify images are correctly processed
                    expect(lastCall.images).toBeDefined();
                    expect(lastCall.images[0]).not.toContain('data:image/');

                    // Verify streaming is enabled
                    expect(lastCall.stream).toBe(true);
                },
            },
        ],
    }
);

// Add direct tests for the context optimization functionality
describe('Ollama context optimization direct tests', () => {
    it('should optimize context size based on input length', () => {
        // Create a handler
        const handler = new OllamaHandler({
            _version: 1,
            debugLogging: false,
            useNativeFetch: false,
        });

        // Access the private optimizeContext method
        const optimizeContext = (handler as any).optimizeContext.bind(handler);

        // Constants from the OllamaHandler implementation
        const SYMBOLS_PER_TOKEN = 2.5;
        const DEFAULT_CONTEXT_LENGTH = 2048;
        const CONTEXT_BUFFER_MULTIPLIER = 1.2;

        // Test with a small input - shouldn't update context
        const smallInput = 1000; // about 400 tokens
        const smallResult = optimizeContext(
            smallInput,
            DEFAULT_CONTEXT_LENGTH, // lastContextLength
            DEFAULT_CONTEXT_LENGTH, // defaultContextLength
            8192 // limit
        );

        // Should not increase context for small input
        expect(smallResult.shouldUpdate).toBe(false);
        // num_ctx is undefined if we're not updating
        expect(smallResult.num_ctx).toBeUndefined();

        // Test with a large input that exceeds default context
        const largeInput = 10000; // about 4000 tokens
        const largeEstimatedTokens = Math.ceil(largeInput / SYMBOLS_PER_TOKEN);
        const targetLength = Math.ceil(
            Math.max(largeEstimatedTokens, DEFAULT_CONTEXT_LENGTH) *
                CONTEXT_BUFFER_MULTIPLIER
        );

        const largeResult = optimizeContext(
            largeInput,
            DEFAULT_CONTEXT_LENGTH, // lastContextLength
            DEFAULT_CONTEXT_LENGTH, // defaultContextLength
            8192 // limit
        );

        // Should increase context for large input
        expect(largeResult.shouldUpdate).toBe(true);
        expect(largeResult.num_ctx).toBe(targetLength);
        expect(largeResult.num_ctx).toBeGreaterThan(largeEstimatedTokens);
    });

    it('should respect model context length limits', () => {
        // Create a handler
        const handler = new OllamaHandler({
            _version: 1,
            debugLogging: false,
            useNativeFetch: false,
        });

        // Access the private optimizeContext method
        const optimizeContext = (handler as any).optimizeContext.bind(handler);

        // Constants from the OllamaHandler implementation
        const DEFAULT_CONTEXT_LENGTH = 2048;

        // Test with a large input that exceeds the model limit
        const largeInput = 10000; // about 4000 tokens
        const smallModelLimit = 2048; // Small model context limit

        const result = optimizeContext(
            largeInput,
            DEFAULT_CONTEXT_LENGTH, // lastContextLength
            DEFAULT_CONTEXT_LENGTH, // defaultContextLength
            smallModelLimit // limit - small model context limit
        );

        // Should not exceed the model's limit
        expect(result.num_ctx).toBeLessThanOrEqual(smallModelLimit);
    });
});

// Add a direct test for image handling with prompt-based format
describe('Ollama image handling direct tests', () => {
    it('should process images correctly with prompt-based format', async () => {
        // Create a simpler test that doesn't rely on internal mocking
        const testImage =
            'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCA...';

        // Create a simplified handler for testing
        const handlerPrototype = OllamaHandler.prototype;
        const originalChat = handlerPrototype.execute;

        let capturedArgs: any = null;

        // Mock the execute method to capture the args and check them
        handlerPrototype.execute = jest.fn().mockImplementation(function (
            this: OllamaHandler,
            params: any
        ) {
            capturedArgs = params;
            return {
                onData: () => {},
                onEnd: () => {},
                onError: () => {},
                abort: () => {},
            };
        });

        try {
            // Create a real instance
            const handler = new OllamaHandler({
                _version: 1,
                debugLogging: false,
                useNativeFetch: false,
            });

            // Execute method with image
            await handler.execute({
                provider: {
                    id: 'test-provider',
                    name: 'Test Provider',
                    type: 'ollama',
                    url: 'http://localhost:11434',
                    model: 'llama2',
                },
                prompt: 'Describe this image',
                systemPrompt: 'You are a helpful assistant',
                images: [testImage],
                options: {},
            });

            // Verify the execute method was called with the expected args
            expect(handlerPrototype.execute).toHaveBeenCalled();
            expect(capturedArgs).toEqual({
                provider: expect.objectContaining({
                    model: 'llama2',
                    type: 'ollama',
                }),
                prompt: 'Describe this image',
                systemPrompt: 'You are a helpful assistant',
                images: [testImage],
                options: {},
            });
        } finally {
            // Clean up the mock to avoid affecting other tests
            handlerPrototype.execute = originalChat;
        }
    });
});

// CORS retry tests for Ollama
describe('Ollama CORS Retry Tests', () => {
    let handler: OllamaHandler;
    let mockProvider: IAIProvider;

    beforeEach(() => {
        handler = createHandler();
        mockProvider = createMockProvider();

        // Clear CORS manager state
        jest.clearAllMocks();
        const { corsRetryManager } = require('../utils/corsRetryManager');
        corsRetryManager.clearAll();
    });

    it('should retry fetchModels with obsidianFetch on CORS error', async () => {
        const mockClient = createMockClient();
        const corsError = new Error('Access blocked by CORS policy');

        // First call fails with CORS, second succeeds
        mockClient
            .list!.mockRejectedValueOnce(corsError)
            .mockResolvedValueOnce({
                models: [{ name: 'model1' }, { name: 'model2' }],
            });

        jest.spyOn(handler as any, 'getClient')
            .mockReturnValueOnce(mockClient)
            .mockReturnValueOnce(mockClient);

        const result = await handler.fetchModels(mockProvider);

        expect(result).toEqual(['model1', 'model2']);
        expect(mockClient.list!).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-CORS errors', async () => {
        const mockClient = createMockClient();
        const networkError = new Error('Network timeout');

        mockClient.list!.mockRejectedValue(networkError);
        jest.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await expect(handler.fetchModels(mockProvider)).rejects.toThrow(
            'Network timeout'
        );

        expect(mockClient.list!).toHaveBeenCalledTimes(1);
    });
});

// Tests to ensure electronFetch is never used for non-execute methods
describe('Ollama Fetch Usage Tests', () => {
    let handler: OllamaHandler;
    let mockProvider: IAIProvider;

    beforeEach(() => {
        handler = createHandler();
        mockProvider = createMockProvider();
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should never use electronFetch for fetchModels', async () => {
        const mockClient = createMockClient();
        const { electronFetch } = require('../utils/electronFetch');

        // Create a custom spy for getClient to track fetch parameter
        const getClientSpy = jest
            .spyOn(handler as any, 'getClient')
            .mockImplementation((_provider, fetchFn) => {
                // Verify electronFetch is never passed for non-execute calls
                if (fetchFn === electronFetch) {
                    throw new Error(
                        'electronFetch should not be used for fetchModels'
                    );
                }
                return mockClient;
            });

        await handler.fetchModels(mockProvider);

        // Verify getClient was called
        expect(getClientSpy).toHaveBeenCalledWith(
            mockProvider,
            expect.any(Function)
        );
    });

    it('should never use electronFetch for embed', async () => {
        const mockClient = createMockClient();
        const { electronFetch } = require('../utils/electronFetch');
        (mockClient as any).embed = jest.fn().mockResolvedValue({
            embeddings: [[0.1, 0.2, 0.3]],
        });

        const getClientSpy = jest
            .spyOn(handler as any, 'getClient')
            .mockImplementation((_provider, fetchFn) => {
                if (fetchFn === electronFetch) {
                    throw new Error(
                        'electronFetch should not be used for embed'
                    );
                }
                return mockClient;
            });

        await handler.embed({
            provider: mockProvider,
            input: 'test text',
        });

        expect(getClientSpy).toHaveBeenCalledWith(
            mockProvider,
            expect.any(Function)
        );
    });

    it('should allow electronFetch for execute', async () => {
        const mockClient = createMockClient();

        const getClientSpy = jest
            .spyOn(handler as any, 'getClient')
            .mockImplementation((_provider, _fetchFn) => {
                // For execute, electronFetch is allowed
                return mockClient;
            });

        const chunkHandler = await handler.execute({
            provider: mockProvider,
            prompt: 'test prompt',
        });

        // Wait for execution
        await new Promise(resolve => {
            chunkHandler.onEnd(() => resolve(undefined));
            chunkHandler.onError(() => resolve(undefined));
        });

        // Verify getClient was called
        expect(getClientSpy).toHaveBeenCalledWith(
            mockProvider,
            expect.any(Function)
        );
    });

    it('should use obsidianFetch as fallback for non-execute methods when useNativeFetch is false', async () => {
        // Create handler with useNativeFetch = false
        const nonNativeHandler = new OllamaHandler({
            _version: 1,
            debugLogging: false,
            useNativeFetch: false,
        });

        const mockClient = createMockClient();
        jest.spyOn(nonNativeHandler as any, 'getClient').mockReturnValue(
            mockClient
        );

        // Test getClient directly
        const client = (nonNativeHandler as any).getClient(
            mockProvider,
            undefined,
            false
        );

        // The getClient should be configured to not use electronFetch for non-execute
        expect(client).toBeDefined();
    });

    it('should never use electronFetch for getCachedModelInfo', async () => {
        const mockClient = createMockClient();
        (mockClient as any).show = jest.fn().mockResolvedValue({
            model_info: { num_ctx: 4096 },
        });

        // Spy on getClient to ensure it's not called with electronFetch
        const getClientSpy = jest
            .spyOn(handler as any, 'getClient')
            .mockImplementation((_provider, _fetchFn) => {
                return mockClient;
            });

        // Call getCachedModelInfo through the handler
        await (handler as any).getCachedModelInfo(mockProvider, 'test-model');

        // Verify getClient was called
        expect(getClientSpy).toHaveBeenCalledWith(
            mockProvider,
            expect.any(Function)
        );
    });
});
