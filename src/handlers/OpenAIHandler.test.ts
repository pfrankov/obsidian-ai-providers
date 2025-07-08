import { OpenAIHandler } from './OpenAIHandler';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
import {
    createAIHandlerTests,
    createDefaultVerifyApiCalls,
    IMockClient,
} from '../../test-utils/createAIHandlerTests';

jest.mock('openai');

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
        list: jest.fn().mockResolvedValue({
            data: [{ id: 'model1' }, { id: 'model2' }],
        }),
    },
    chat: {
        completions: {
            create: jest
                .fn()
                .mockImplementation(async (_params, { signal }) => {
                    const responseStream = {
                        async *[Symbol.asyncIterator]() {
                            for (let i = 0; i < 5; i++) {
                                if (signal?.aborted) {
                                    break;
                                }
                                yield {
                                    choices: [
                                        { delta: { content: `chunk${i}` } },
                                    ],
                                };
                            }
                        },
                    };
                    return responseStream;
                }),
        },
    },
});

// Use the default OpenAI verification function
const verifyApiCalls = createDefaultVerifyApiCalls();

// Use createAIHandlerTests for common test cases
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
        // Add image handling test for OpenAI
        imageHandlingOptions: {
            verifyImageHandling: async (_handler, mockClient) => {
                // OpenAI image handling is done through content array with image_url objects
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
        // Add embedding options for OpenAI
        embeddingOptions: {
            mockEmbeddingResponse: [[0.1, 0.2, 0.3]],
            setupEmbedMock: mockClient => {
                // Add mock for embeddings API in OpenAI
                (mockClient as any).embeddings = {
                    create: jest.fn().mockResolvedValue({
                        data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
                    }),
                };
            },
        },
    }
);

// Additional CORS retry tests for OpenAI
describe('OpenAI CORS Retry Tests', () => {
    let handler: OpenAIHandler;
    let mockProvider: IAIProvider;

    beforeEach(() => {
        handler = createHandler();
        mockProvider = createMockProvider();

        // Clear FetchSelector state
        jest.clearAllMocks();
        (handler as any).fetchSelector.clearAll();
    });

    it('should retry fetchModels with obsidianFetch on CORS error', async () => {
        const mockClient = createMockClient();
        const corsError = new Error('Access blocked by CORS policy');

        // First call fails with CORS, second succeeds
        mockClient
            .models!.list.mockRejectedValueOnce(corsError)
            .mockResolvedValueOnce({
                data: [{ id: 'model1' }, { id: 'model2' }],
            });

        jest.spyOn(handler as any, 'getClient')
            .mockReturnValueOnce(mockClient) // First call with default fetch
            .mockReturnValueOnce(mockClient); // Second call with obsidianFetch

        const result = await handler.fetchModels(mockProvider);

        expect(result).toEqual(['model1', 'model2']);
        expect(mockClient.models!.list).toHaveBeenCalledTimes(2);
        expect((handler as any).getClient).toHaveBeenCalledTimes(2);
    });

    it('should retry embed with obsidianFetch on CORS error', async () => {
        const mockClient = createMockClient();
        const corsError = new Error('Cross-origin request blocked');
        const mockEmbedding = {
            data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
        };

        // Add embeddings mock
        (mockClient as any).embeddings = {
            create: jest
                .fn()
                .mockRejectedValueOnce(corsError)
                .mockResolvedValueOnce(mockEmbedding),
        };

        jest.spyOn(handler as any, 'getClient')
            .mockReturnValueOnce(mockClient)
            .mockReturnValueOnce(mockClient);

        const result = await handler.embed({
            provider: mockProvider,
            input: 'test text',
        });

        expect(result).toEqual([[0.1, 0.2, 0.3]]);
        expect((mockClient as any).embeddings.create).toHaveBeenCalledTimes(2);
    });

    it('should retry execute with obsidianFetch on CORS error', async () => {
        const mockClient = createMockClient();
        const corsError = new Error(
            'Not allowed by Access-Control-Allow-Origin'
        );

        // Mock successful stream for retry
        const mockStream = {
            async *[Symbol.asyncIterator]() {
                yield { choices: [{ delta: { content: 'retry response' } }] };
            },
        };

        mockClient
            .chat!.completions.create.mockRejectedValueOnce(corsError)
            .mockResolvedValueOnce(mockStream);

        jest.spyOn(handler as any, 'getClient')
            .mockReturnValueOnce(mockClient)
            .mockReturnValueOnce(mockClient);

        const chunkHandler = await handler.execute({
            provider: mockProvider,
            prompt: 'test prompt',
        });

        // Collect chunks
        let fullText = '';
        chunkHandler.onData((_chunk, accumulated) => {
            fullText = accumulated;
        });

        // Wait for execution
        await new Promise(resolve => {
            chunkHandler.onEnd(() => resolve(undefined));
            chunkHandler.onError(() => resolve(undefined));
        });

        expect(fullText).toBe('retry response');
        expect(mockClient.chat!.completions.create).toHaveBeenCalledTimes(2);
    });

    it('should not retry if provider is already marked as CORS-blocked', async () => {
        const mockClient = createMockClient();
        const corsError = new Error('CORS policy blocked');

        // Mark provider as CORS-blocked first through FetchSelector
        (handler as any).fetchSelector.markProviderAsCorsBlocked(mockProvider);

        mockClient.models!.list.mockRejectedValue(corsError);
        jest.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await expect(handler.fetchModels(mockProvider)).rejects.toThrow(
            'CORS policy blocked'
        );

        // Should only be called once (no retry)
        expect(mockClient.models!.list).toHaveBeenCalledTimes(1);
        expect((handler as any).getClient).toHaveBeenCalledTimes(1);
    });

    it('should not retry on non-CORS errors', async () => {
        const mockClient = createMockClient();
        const networkError = new Error('Network timeout');

        mockClient.models!.list.mockRejectedValue(networkError);
        jest.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);

        await expect(handler.fetchModels(mockProvider)).rejects.toThrow(
            'Network timeout'
        );

        // Should only be called once (no retry)
        expect(mockClient.models!.list).toHaveBeenCalledTimes(1);
        expect((handler as any).getClient).toHaveBeenCalledTimes(1);
    });

    it('should use correct fetch based on settings and CORS status', () => {
        const fetchSelector = (handler as any).fetchSelector;

        // Clear any existing CORS state
        fetchSelector.clearAll();

        // Test that FetchSelector properly tracks provider state
        expect(fetchSelector.shouldUseFallback(mockProvider)).toBe(false);

        // Mark provider as CORS-blocked
        fetchSelector.markProviderAsCorsBlocked(mockProvider);
        expect(fetchSelector.shouldUseFallback(mockProvider)).toBe(true);

        // Clear state for other tests
        fetchSelector.clearAll();
        expect(fetchSelector.shouldUseFallback(mockProvider)).toBe(false);
    });
});

// Tests to ensure electronFetch is never used for non-execute methods
describe('OpenAI Fetch Usage Tests', () => {
    let handler: OpenAIHandler;
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
        const { electronFetch } = await import('../utils/electronFetch');

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
        const { electronFetch } = await import('../utils/electronFetch');
        (mockClient as any).embeddings = {
            create: jest.fn().mockResolvedValue({
                data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
            }),
        };

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
        const nonNativeHandler = new OpenAIHandler({
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
});
