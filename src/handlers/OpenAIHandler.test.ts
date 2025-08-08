import { OpenAIHandler } from './OpenAIHandler';
import { IAIProvider } from '@obsidian-ai-providers/sdk';
import {
    createAIHandlerTests,
    createDefaultVerifyApiCalls,
    IMockClient,
} from '../../test-utils/createAIHandlerTests';

jest.mock('openai');
jest.mock('obsidian', () => ({
    Platform: { isMobileApp: false },
}));

// Mock FetchSelector
jest.mock('../utils/FetchSelector', () => {
    const originalModule = jest.requireActual('../utils/FetchSelector');
    return {
        ...originalModule,
        FetchSelector: jest.fn().mockImplementation(settings => {
            const instance = new originalModule.FetchSelector(settings);
            instance.execute = jest
                .fn()
                .mockImplementation(async (provider, operation) => {
                    return operation(jest.fn());
                });
            instance.request = jest
                .fn()
                .mockImplementation(async (provider, operation) => {
                    return operation(jest.fn());
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
                            for (let i = 0; i < 3; i++) {
                                if (signal?.aborted) break;
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
    embeddings: {
        create: jest.fn().mockResolvedValue({
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
                    create: jest.fn().mockResolvedValue({
                        data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
                    }),
                };
            },
        },
    }
);

// Basic CORS retry test
describe('OpenAI CORS Handling', () => {
    let handler: OpenAIHandler;
    let mockProvider: IAIProvider;

    beforeEach(() => {
        handler = createHandler();
        mockProvider = createMockProvider();
        jest.clearAllMocks();
    });

    it('should handle CORS errors in fetchModels', async () => {
        const mockClient = createMockClient();
        const corsError = new Error('Access blocked by CORS policy');

        mockClient
            .models!.list.mockRejectedValueOnce(corsError)
            .mockResolvedValueOnce({ data: [{ id: 'model1' }] });

        jest.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);
        jest.spyOn(
            (handler as any).fetchSelector,
            'request'
        ).mockImplementation(
            async (
                provider: IAIProvider,
                operation: (client: any) => Promise<any>
            ) => {
                try {
                    return await operation(jest.fn());
                } catch (error) {
                    return await operation(jest.fn());
                }
            }
        );

        const result = await handler.fetchModels(mockProvider);
        expect(result).toEqual(['model1']);
    });
});
