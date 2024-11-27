import { IAIHandler, IAIProvider } from '../src/types';

export type IMockResponse = {
    choices: Array<{
        delta: {
            content: string;
        };
    }>;
} | {
    response: string;
};

export interface IMockClient {
    models?: {
        list: jest.Mock;
    };
    chat?: {
        completions: {
            create: jest.Mock;
        };
    };
    list?: jest.Mock;
    generate?: jest.Mock;
}

export interface IExecuteParams {
    provider: IAIProvider;
    systemPrompt: string;
    prompt: string;
    options: Record<string, any>;
}

export interface IVerifyApiCallsParams {
    mockClient: IMockClient;
    executeParams: IExecuteParams;
}

export const createAIHandlerTests = (
    handlerName: string,
    createHandler: () => IAIHandler,
    createMockProvider: () => IAIProvider,
    createMockClient: () => IMockClient,
    verifyApiCalls: (params: IVerifyApiCallsParams) => void,
    options?: {
        mockStreamResponse?: IMockResponse;
    }
) => {
    describe(handlerName, () => {
        let handler: IAIHandler;
        let mockProvider: IAIProvider;
        let mockClient: IMockClient;

        beforeEach(() => {
            handler = createHandler();
            mockProvider = createMockProvider();
            mockClient = createMockClient();
            jest.spyOn(handler as any, 'getClient').mockReturnValue(mockClient);
        });

        describe('Model Management', () => {
            describe('fetchModels', () => {
                it('should successfully fetch available models', async () => {
                    const result = await handler.fetchModels(mockProvider);

                    if (mockClient.models?.list) {
                        expect(result).toEqual(['model1', 'model2']);
                        expect(mockClient.models.list).toHaveBeenCalled();
                    } else if (mockClient.list) {
                        expect(result).toEqual(['model1', 'model2']);
                        expect(mockClient.list).toHaveBeenCalled();
                    }
                });
            });
        });

        describe('Execution', () => {
            describe('Streaming', () => {
                it('should handle streaming response with correct data flow', async () => {
                    const mockResponse = options?.mockStreamResponse || {
                        choices: [{ delta: { content: 'test response' } }]
                    };

                    const mockStream = {
                        [Symbol.asyncIterator]: async function* () {
                            yield mockResponse;
                        }
                    };

                    if (mockClient.chat?.completions.create) {
                        mockClient.chat.completions.create.mockResolvedValue(mockStream);
                    } else if (mockClient.generate) {
                        mockClient.generate.mockResolvedValue(mockStream);
                    }

                    const executeParams = {
                        provider: mockProvider,
                        systemPrompt: 'You are a helpful assistant',
                        prompt: 'Hello',
                        options: {}
                    };

                    const result = await handler.execute(executeParams);

                    const onDataMock = jest.fn();
                    const onEndMock = jest.fn();

                    result.onData(onDataMock);
                    result.onEnd(onEndMock);

                    await new Promise(resolve => setTimeout(resolve, 100));

                    const expectedContent = 'response' in mockResponse 
                        ? mockResponse.response 
                        : mockResponse.choices[0].delta.content;
                    
                    expect(onDataMock).toHaveBeenCalledWith(expectedContent, expectedContent);
                    expect(onEndMock).toHaveBeenCalledWith(expectedContent);

                    // Verify API calls using the provided function
                    verifyApiCalls({ mockClient, executeParams });
                });
            });

            describe('Error Handling', () => {
                it('should properly handle and propagate errors', async () => {
                    const mockError = new Error('Test error');
                    let errorThrown = false;

                    const mockStream = {
                        [Symbol.asyncIterator]: async function* () {
                            await new Promise(resolve => setTimeout(resolve, 10));
                            errorThrown = true;
                            yield options?.mockStreamResponse || { choices: [{ delta: { content: '' } }] };
                            throw mockError;
                        }
                    };

                    if (mockClient.chat?.completions.create) {
                        mockClient.chat.completions.create.mockResolvedValue(mockStream);
                    } else if (mockClient.generate) {
                        mockClient.generate.mockResolvedValue(mockStream);
                    }

                    const result = await handler.execute({
                        provider: mockProvider,
                        systemPrompt: 'You are a helpful assistant',
                        prompt: 'Hello',
                        options: {}
                    });

                    const onErrorMock = jest.fn();
                    result.onError(onErrorMock);

                    while (!errorThrown) {
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }

                    await new Promise(resolve => setTimeout(resolve, 50));

                    expect(onErrorMock).toHaveBeenCalledWith(mockError);
                });
            });

            describe('Cancellation', () => {
                it('should support request abortion and cleanup', async () => {
                    const chunkHandler = await handler.execute({
                        provider: mockProvider,
                        prompt: 'test prompt'
                    });

                    const chunks: string[] = [];
                    chunkHandler.onData((chunk) => {
                        chunks.push(chunk);
                    });

                    await new Promise(resolve => setTimeout(resolve, 150));
                    chunkHandler.abort();

                    await new Promise(resolve => setTimeout(resolve, 300));

                    expect(chunks.length).toBeGreaterThan(0);
                    expect(chunks.length).toBeLessThan(5);
                });
            });
        });
    });
}; 