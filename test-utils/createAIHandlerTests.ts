import { IAIHandler, IAIProvider, IAIProvidersExecuteParams, IAIProvidersEmbedParams } from '@obsidian-ai-providers/sdk';

export type IMockResponse = {
    choices: Array<{
        delta: {
            content: string;
        };
    }>;
} | {
    response: string;
} | {
    message: {
        content: string;
    };
} | {
    type: string;
    delta: {
        text: string;
        [key: string]: any;
    };
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
    embeddings?: {
        create: jest.Mock;
    };
    messages?: {
        create: jest.Mock;
    };
    show?: jest.Mock;
    list?: jest.Mock;
    generate?: jest.Mock;
    embed?: jest.Mock;
}

export type IExecuteParams = IAIProvidersExecuteParams;

export interface IVerifyApiCallsParams {
    mockClient: IMockClient;
    executeParams: IExecuteParams;
}

const flushPromises = () => new Promise(process.nextTick);

const applyStreamMock = (mockClient: IMockClient, mockStream: any) => {
    if (mockClient.chat?.completions?.create) {
        mockClient.chat.completions.create.mockResolvedValue(mockStream);
    } else if (mockClient.generate) {
        mockClient.generate.mockResolvedValue(mockStream);
    } else if ((mockClient as any).messages?.create) {
        (mockClient as any).messages.create.mockResolvedValue(mockStream);
    } else if ((mockClient as any).chat) {
        (mockClient as any).chat.mockResolvedValue(mockStream);
    }
};

// Helper function to setup streaming mock
const setupStreamingMock = (mockClient: IMockClient, mockResponse: IMockResponse) => {
    const mockStream = {
        [Symbol.asyncIterator]: async function* () {
            yield mockResponse;
        }
    };

    applyStreamMock(mockClient, mockStream);
};

// Helper function to extract content from mock response
const extractContent = (mockResponse: IMockResponse): string => {
    if ('response' in mockResponse) {
        return mockResponse.response;
    } else if ('message' in mockResponse && mockResponse.message.content) {
        return mockResponse.message.content;
    } else if (
        (mockResponse as any).delta &&
        typeof (mockResponse as any).delta.text === 'string'
    ) {
        return (mockResponse as any).delta.text;
    } else if ('choices' in mockResponse) {
        return mockResponse.choices[0].delta.content;
    }
    return '';
};

export interface ICreateAIHandlerTestsOptions {
    mockStreamResponse?: IMockResponse;
    defaultVerifyApiCalls?: (params: IVerifyApiCallsParams) => void;
    imageHandlingOptions?: {
        setupImageMock?: (mockClient: IMockClient) => void;
        verifyImageHandling?: (handler: IAIHandler, mockClient: IMockClient) => Promise<void>;
        testImage?: string;
    };
    additionalStreamingTests?: Array<{
        name: string;
        executeParams: Partial<IExecuteParams>;
        setup?: (mockClient: IMockClient) => void;
    verify?: (resultText: string, mockClient: IMockClient) => void;
    }>;
    embeddingOptions?: {
        mode?: 'default' | 'unsupported';
        mockEmbeddingResponse?: number[][];
        setupEmbedMock?: (mockClient: IMockClient) => void;
        // Simplified progress behavior configuration
        progressBehavior?: 'per-chunk' | 'per-item';
        unsupportedError?: RegExp | string;
    };
    errorHandlingOptions?: {
        setupErrorMocks?: (mockClient: IMockClient) => void;
        verifyErrorHandling?: (handler: IAIHandler, mockClient: IMockClient) => Promise<void>;
    };
    initializationOptions?: {
        createHandlerWithOptions?: (options: any) => IAIHandler;
        verifyInitialization?: (handler: IAIHandler, mockClient: IMockClient) => void;
    };
    contextOptimizationOptions?: {
        setupContextMock?: (mockClient: IMockClient) => void;
        verifyContextOptimization?: (handler: IAIHandler, mockClient: IMockClient) => Promise<void>;
    };
    cachingOptions?: {
        setupCacheMock?: (mockClient: IMockClient) => void;
        verifyCaching?: (handler: IAIHandler, mockClient: IMockClient) => Promise<void>;
    };
}

export const createAIHandlerTests = (
    handlerName: string,
    createHandler: () => IAIHandler,
    createMockProvider: () => IAIProvider,
    createMockClient: () => IMockClient,
    verifyApiCalls?: (params: IVerifyApiCallsParams) => void,
    options?: ICreateAIHandlerTestsOptions
) => {
    // Use default implementation if verifyApiCalls is not provided
    const verifyApiCallsFn = verifyApiCalls || options?.defaultVerifyApiCalls || ((params: IVerifyApiCallsParams) => {
        const { mockClient, executeParams } = params;
        
        // Basic verification that can work for most APIs
        if (executeParams.messages || executeParams.prompt) {
            // Assert that some API call was made
            if (mockClient.chat?.completions?.create) {
                expect(mockClient.chat.completions.create).toHaveBeenCalled();
            } else if (mockClient.generate) {
                expect(mockClient.generate).toHaveBeenCalled();
            } else if ((mockClient as any).chat) {
                expect((mockClient as any).chat).toHaveBeenCalled();
            }
        }
    });
    
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
                    const result = await handler.fetchModels({ provider: mockProvider });

                    expect(Array.isArray(result)).toBe(true);
                    expect(result.length).toBeGreaterThan(0);
                    expect(result.every(id => typeof id === 'string')).toBe(
                        true
                    );

                    if (mockClient.models?.list) {
                        expect(mockClient.models.list).toHaveBeenCalled();
                    } else if (mockClient.list) {
                        expect(mockClient.list).toHaveBeenCalled();
                    }
                });
            });
        });

        const embeddingMode = options?.embeddingOptions?.mode ?? 'default';

        if (embeddingMode === 'unsupported') {
            describe('Embeddings', () => {
                it('should report unsupported embeddings clearly', async () => {
                    await expect(
                        handler.embed({
                            provider: mockProvider,
                            input: 'test text for embedding',
                        } as IAIProvidersEmbedParams)
                    ).rejects.toThrow(
                        options?.embeddingOptions?.unsupportedError ||
                            /unsupported|not support|Embedding/i
                    );
                });
            });
        } else {
            describe('Embeddings', () => {
                const prepareEmbeddingMock = () => {
                    const mockEmbeddingResponse =
                        options?.embeddingOptions?.mockEmbeddingResponse || [
                            [0.1, 0.2, 0.3],
                        ];

                    if (options?.embeddingOptions?.setupEmbedMock) {
                        options.embeddingOptions.setupEmbedMock(mockClient);
                    } else if ((mockClient as any).embeddings?.create) {
                        (mockClient as any).embeddings.create.mockResolvedValue({
                            data: mockEmbeddingResponse.map((embedding, i) => ({
                                embedding,
                                index: i,
                            })),
                        });
                    } else if ((mockClient as any).embed) {
                        (mockClient as any).embed.mockResolvedValue({
                            embeddings: mockEmbeddingResponse,
                        });
                    }

                    return mockEmbeddingResponse;
                };

                const expectEmbeddingCall = (expectedInput: string) => {
                    if ((mockClient as any).embeddings?.create) {
                        expect(
                            (mockClient as any).embeddings.create
                        ).toHaveBeenCalled();
                        const callArgs = (mockClient as any).embeddings.create.mock
                            .calls[0];
                        expect(callArgs[0]).toEqual({
                            model: mockProvider.model,
                            input: [expectedInput],
                        });
                    } else if ((mockClient as any).embed) {
                        expect((mockClient as any).embed).toHaveBeenCalledWith({
                            model: mockProvider.model,
                            input: expectedInput,
                            options: expect.anything(),
                        });
                    }
                };
                it('should correctly generate embeddings with input field', async () => {
                    prepareEmbeddingMock();
                    
                    const embedParams = {
                        provider: mockProvider,
                        input: "test text for embedding"
                    };
                    
                    const result = await handler.embed(embedParams);
                    expect(result).toEqual(expect.any(Array));
                    expect(result[0]).toEqual(expect.any(Array));
                    expect(result[0].length).toBeGreaterThan(0);
                    
                    expectEmbeddingCall('test text for embedding');
                });
                
                it('should correctly generate embeddings with text field for backwards compatibility', async () => {
                    prepareEmbeddingMock();
                    
                    // Test with text field instead of input (for backwards compatibility)
                    const embedParams = {
                        provider: mockProvider,
                        text: "test text for embedding" // Using text instead of input
                    } as any;
                    
                    const result = await handler.embed(embedParams);
                    expect(result).toEqual(expect.any(Array));
                    expect(result[0]).toEqual(expect.any(Array));
                    expect(result[0].length).toBeGreaterThan(0);
                    
                    expectEmbeddingCall('test text for embedding');
                });
                
                // Add additional test for backward compatibility with specific error handling
                it('should throw error when neither input nor text is provided', async () => {
                    // Test with an empty params object
                    const embedParams = {
                        provider: mockProvider,
                        // Intentionally not providing input or text
                    } as IAIProvidersEmbedParams;
                    
                    // Expect the call to throw an error about missing parameters
                    await expect(handler.embed(embedParams)).rejects.toThrow(/Either input or text/);
                });

                it('should call onProgress callback with correct progress', async () => {
                    prepareEmbeddingMock();
                    const onProgressMock = jest.fn();
                    const testInputs = ['text1', 'text2', 'text3'];
                    
                    const embedParams = {
                        provider: mockProvider,
                        input: testInputs,
                        onProgress: onProgressMock
                    } as IAIProvidersEmbedParams;
                    
                    await handler.embed(embedParams);
                    
                    const progressBehavior = options?.embeddingOptions?.progressBehavior || 'per-item';
                    
                    if (progressBehavior === 'per-chunk') {
                        expect(onProgressMock).toHaveBeenCalledTimes(1);
                        expect(onProgressMock).toHaveBeenCalledWith(testInputs);
                    } else {
                        expect(onProgressMock).toHaveBeenCalledTimes(testInputs.length);
                        expect(onProgressMock).toHaveBeenNthCalledWith(1, [testInputs[0]]);
                        expect(onProgressMock).toHaveBeenNthCalledWith(2, [
                            testInputs[0],
                            testInputs[1],
                        ]);
                        expect(onProgressMock).toHaveBeenNthCalledWith(3, [
                            testInputs[0],
                            testInputs[1],
                            testInputs[2],
                        ]);
                    }
                });

                it('should work without onProgress callback', async () => {
                    prepareEmbeddingMock();
                    const embedParams = {
                        provider: mockProvider,
                        input: ['text1', 'text2']
                    } as IAIProvidersEmbedParams;
                    
                    // Should not throw error when onProgress is not provided
                    await expect(handler.embed(embedParams)).resolves.toBeDefined();
                });
            });
        }

        describe('Execution', () => {
            describe('Streaming', () => {
                it('should handle streaming response with messages format', async () => {
                    const mockResponse = options?.mockStreamResponse || {
                        choices: [{ delta: { content: 'test response' } }]
                    };

                    setupStreamingMock(mockClient, mockResponse);

                    const executeParams = {
                        provider: mockProvider,
                        messages: [
                            { role: 'system' as const, content: 'You are a helpful assistant' },
                            { role: 'user' as const, content: 'Hello' }
                        ],
                        options: {}
                    };

                    const onProgressMock = jest.fn();
                    const fullText = await handler.execute({
                        ...executeParams,
                        onProgress: onProgressMock as any,
                    });

                    const expectedContent = extractContent(mockResponse);
                    
                    expect(onProgressMock).toHaveBeenCalledWith(expectedContent, expectedContent);
                    expect(fullText).toBe(expectedContent);

                    verifyApiCallsFn({ mockClient, executeParams });
                });

                it('should handle streaming response with prompt format', async () => {
                    const mockResponse = options?.mockStreamResponse || {
                        choices: [{ delta: { content: 'test response' } }]
                    };

                    setupStreamingMock(mockClient, mockResponse);

                    const executeParams = {
                        provider: mockProvider,
                        systemPrompt: 'You are a helpful assistant',
                        prompt: 'Hello',
                        options: {}
                    };

                    const onProgressMock = jest.fn();
                    const fullText = await handler.execute({
                        ...executeParams,
                        onProgress: onProgressMock as any,
                    });

                    const expectedContent = extractContent(mockResponse);
                    
                    expect(onProgressMock).toHaveBeenCalledWith(expectedContent, expectedContent);
                    expect(fullText).toBe(expectedContent);

                    verifyApiCallsFn({ mockClient, executeParams });
                });
            });

            describe('Error Handling', () => {
                it('should properly handle and propagate errors', async () => {
                    const mockError = new Error('Test error');
                    let errorThrown = false;

                    const mockStream = {
                        [Symbol.asyncIterator]: async function* () {
                            await flushPromises();
                            errorThrown = true;
                            yield options?.mockStreamResponse || { choices: [{ delta: { content: '' } }] };
                            throw mockError;
                        }
                    };

                    applyStreamMock(mockClient, mockStream);

                    await expect(handler.execute({
                        provider: mockProvider,
                        messages: [
                            { role: 'system' as const, content: 'You are a helpful assistant' },
                            { role: 'user' as const, content: 'Hello' }
                        ],
                        options: {},
                    })).rejects.toThrow('Test error');
                });
            });

            describe('Cancellation', () => {
                it('should support request abortion and cleanup', async () => {
                    let chunkCount = 0;
                    const mockStream = {
                        [Symbol.asyncIterator]: async function* () {
                            while (chunkCount < 5) {
                                yield options?.mockStreamResponse || { choices: [{ delta: { content: `chunk${chunkCount}` } }] };
                                chunkCount++;
                                await flushPromises();
                            }
                        }
                    };

                    applyStreamMock(mockClient, mockStream);

                    const abortController = new AbortController();
                    const chunks: string[] = [];
                    await expect(handler.execute({
                        provider: mockProvider,
                        messages: [ { role: 'user' as const, content: 'test prompt' } ],
                        options: {},
                        abortController,
                        onProgress: (chunk: string) => {
                            chunks.push(chunk);
                            if (chunks.length === 2) abortController.abort();
                        }
                    })).rejects.toThrow('Aborted');
                    expect(chunks.length).toBe(2);
                });
            });
        });

        // Context optimization tests
        if (options?.contextOptimizationOptions) {
            describe('Context Optimization', () => {
                beforeEach(() => {
                    if (options?.contextOptimizationOptions?.setupContextMock) {
                        options.contextOptimizationOptions.setupContextMock(mockClient);
                    }
                });

                it('should optimize context for large inputs', async () => {
                    if (options?.contextOptimizationOptions?.verifyContextOptimization) {
                        // Create a large prompt to trigger context optimization
                        const executeParams = {
                            provider: mockProvider,
                            prompt: 'a'.repeat(8000), // Large enough to trigger optimization
                            options: {}
                        };

                        // Setup streaming test
                        const mockResponse = options?.mockStreamResponse || {
                            choices: [{ delta: { content: 'test response' } }]
                        };

                        const mockStream = {
                            [Symbol.asyncIterator]: async function* () {
                                yield mockResponse;
                            }
                        };

                        applyStreamMock(mockClient, mockStream);

                        await handler.execute(executeParams);
                        
                        await options.contextOptimizationOptions.verifyContextOptimization(handler, mockClient);
                    }
                });

                it('should not optimize context for image requests', async () => {
                    const executeParams: IExecuteParams = {
                        provider: mockProvider,
                        prompt: 'Hello',
                        images: ['base64image'],
                        options: {}
                    };

                    // Setup streaming test
                    const mockResponse = options?.mockStreamResponse || {
                        choices: [{ delta: { content: 'test response' } }]
                    };

                    const mockStream = {
                        [Symbol.asyncIterator]: async function* () {
                            yield mockResponse;
                        }
                    };

                    applyStreamMock(mockClient, mockStream);

                    await handler.execute(executeParams);

                    // Verify that context optimization was not applied
                    if (options?.contextOptimizationOptions?.verifyContextOptimization) {
                        await options.contextOptimizationOptions.verifyContextOptimization(handler, mockClient);
                    }
                });

                it('should not unnecessarily increase context for small inputs', async () => {
                    const executeParams: IExecuteParams = {
                        provider: mockProvider,
                        prompt: 'Short prompt',
                        options: {}
                    };

                    // Setup streaming test
                    const mockResponse = options?.mockStreamResponse || {
                        choices: [{ delta: { content: 'test response' } }]
                    };

                    const mockStream = {
                        [Symbol.asyncIterator]: async function* () {
                            yield mockResponse;
                        }
                    };

                    applyStreamMock(mockClient, mockStream);

                    await handler.execute(executeParams);

                    // Verify that context was not unnecessarily increased
                    if (options?.contextOptimizationOptions?.verifyContextOptimization) {
                        await options.contextOptimizationOptions.verifyContextOptimization(handler, mockClient);
                    }
                });
            });
        }

        // Caching behavior tests
        if (options?.cachingOptions) {
            describe('Caching Behavior', () => {
                beforeEach(() => {
                    if (options?.cachingOptions?.setupCacheMock) {
                        options.cachingOptions.setupCacheMock(mockClient);
                    }
                });

                it('should cache model info', async () => {
                    if (options?.cachingOptions?.verifyCaching) {
                        // First request to populate cache
                        const executeParams = {
                            provider: mockProvider,
                            prompt: 'test request',
                            options: {}
                        };

                        // Setup streaming test
                        const mockResponse = options?.mockStreamResponse || {
                            choices: [{ delta: { content: 'test response' } }]
                        };

                        const mockStream = {
                            [Symbol.asyncIterator]: async function* () {
                                yield mockResponse;
                            }
                        };

                        applyStreamMock(mockClient, mockStream);

                        await handler.execute(executeParams);
                        
                        await options.cachingOptions.verifyCaching(handler, mockClient);
                    }
                });

                it('should maintain separate cache entries for different models', async () => {
                    if (options?.cachingOptions?.verifyCaching) {
                        // First model request
                        const executeParams1 = {
                            provider: {
                                ...mockProvider,
                                model: 'model1' // First model
                            },
                            prompt: 'test request for model1',
                            options: {}
                        };

                        // Setup streaming test for first model
                        const mockResponse = options?.mockStreamResponse || {
                            choices: [{ delta: { content: 'test response' } }]
                        };

                        const mockStream = {
                            [Symbol.asyncIterator]: async function* () {
                                yield mockResponse;
                            }
                        };

                        applyStreamMock(mockClient, mockStream);

                        // Execute first model request
                        await handler.execute(executeParams1);
                        
                        // Second model request
                        const executeParams2 = {
                            provider: {
                                ...mockProvider,
                                model: 'model2' // Second model
                            },
                            prompt: 'test request for model2',
                            options: {}
                        };
                        
                        // Execute second model request
                        await handler.execute(executeParams2);
                        
                        // Verify caching
                        await options.cachingOptions.verifyCaching(handler, mockClient);
                    }
                });
            });
        }

        // Add image handling test if image options provided
        if (options?.imageHandlingOptions) {
            describe('Image Handling', () => {
                beforeEach(() => {
                    if (options?.imageHandlingOptions?.setupImageMock) {
                        options.imageHandlingOptions.setupImageMock(mockClient);
                    }
                });

                it('should correctly handle images in requests', async () => {
                    // Setup mock image response
                    const mockResponse = options?.mockStreamResponse || {
                        choices: [{ delta: { content: 'description of the image' } }]
                    };

                    const mockStream = {
                        [Symbol.asyncIterator]: async function* () {
                            yield mockResponse;
                        }
                    };

                    applyStreamMock(mockClient, mockStream);

                    // Create a test image if not provided
                    const testImage = options.imageHandlingOptions?.testImage || 
                        'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9U6KKKADpRRRQA//Z';

                    // Execute with image
                    const executeParams = {
                        provider: mockProvider,
                        prompt: 'Describe this image',
                        images: [testImage],
                        options: {}
                    };

                    const onProgressMock = jest.fn();
                    const fullText = await handler.execute({
                        ...executeParams,
                        onProgress: onProgressMock as any,
                    });

                    const expectedContent = extractContent(mockResponse);
                    
                    expect(onProgressMock).toHaveBeenCalledWith(expectedContent, expectedContent);
                    expect(fullText).toBe(expectedContent);

                    // Verify API calls for image handling
                    verifyApiCallsFn({ mockClient, executeParams });

                    // Provider-specific image handling verification
                    if (options.imageHandlingOptions?.verifyImageHandling) {
                        await options.imageHandlingOptions.verifyImageHandling(handler, mockClient);
                    }
                });
            });
        }
    });
};

// Helper to create a default API call verification function
export const createDefaultVerifyApiCalls = (options?: {
    formatImages?: (images?: string[]) => any;
    apiField?: string;
    imagesInMessages?: boolean;
}): ((params: IVerifyApiCallsParams) => void) => {
    return ({ mockClient, executeParams }: IVerifyApiCallsParams) => {
        let expectedMessages: any[] = [];
        
        // Format messages based on the input format
        if (executeParams.messages) {
            expectedMessages = executeParams.messages.map(msg => {
                // Handle string content or complex content objects
                const messageContent = typeof msg.content === 'string' ? msg.content : '';
                return {
                    role: msg.role,
                    content: messageContent
                };
            });
        } else {
            // Handle system prompt if present
            if (executeParams.systemPrompt) {
                expectedMessages.push({ role: 'system', content: executeParams.systemPrompt });
            }

            // Handle user message with or without images
            if (executeParams.images?.length) {
                // Process images if needed
                const processedImages = options?.formatImages 
                    ? options.formatImages(executeParams.images) 
                    : undefined;
                
                // Format images if a formatter is provided
                if (processedImages) {
                    if (options?.imagesInMessages) {
                        // Add images inside the message (Ollama's updated format)
                        expectedMessages.push({ 
                            role: 'user', 
                            content: executeParams.prompt || "",
                            images: processedImages
                        });
                    } else {
                        // Add images as a separate parameter (Ollama's old format)
                        expectedMessages.push({ 
                            role: 'user', 
                            content: executeParams.prompt || ""
                        });
                    }
                } else {
                    // Default format (OpenAI style)
                    expectedMessages.push({ 
                        role: 'user', 
                        content: executeParams.images?.length 
                            ? [
                                {
                                    type: "text",
                                    text: executeParams.prompt || "",
                                },
                                ...executeParams.images.map((image) => ({
                                    type: "image_url",
                                    image_url: { url: image }
                                }))
                            ]
                            : executeParams.prompt || ""
                    });
                }
            } else {
                // Simple text prompt
                expectedMessages.push({ role: 'user', content: executeParams.prompt || "" });
            }
        }

        // Determine which client API to check
        const apiField = options?.apiField || 'chat';
        
        // Process images if needed
        const processedImages = executeParams.images && options?.formatImages 
            ? options.formatImages(executeParams.images) 
            : undefined;
        
        // Handle different client structures
        if (apiField === 'chat' && mockClient.chat && 'completions' in mockClient.chat) {
            // OpenAI style client
            expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: executeParams.provider.model,
                    messages: expectedMessages,
                    stream: true,
                    ...executeParams.options
                }),
                expect.any(Object)
            );
        } else if (apiField === 'generate' && mockClient.generate) {
            // Some providers use generate
            expect(mockClient.generate).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: executeParams.provider.model,
                    messages: expectedMessages,
                    stream: true,
                    ...executeParams.options
                })
            );
        } else {
            // Generic chat implementation (like Ollama)
            const chatFn = (mockClient as any)[apiField];
            if (chatFn && chatFn.mock) {
                const expectedObject: any = {
                    model: executeParams.provider.model,
                    messages: expectedMessages,
                    stream: true
                };
                
                // Add images if they were processed with formatter and should be separate
                if (processedImages && !options?.imagesInMessages) {
                    expectedObject.images = processedImages;
                }
                
                // Add options if needed
                if (executeParams.options && Object.keys(executeParams.options).length > 0) {
                    expectedObject.options = expect.anything(); 
                }
                
                expect(chatFn).toHaveBeenCalledWith(
                    expect.objectContaining(expectedObject)
                );
            }
        }
    };
};
