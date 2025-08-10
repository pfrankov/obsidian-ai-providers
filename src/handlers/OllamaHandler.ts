import {
    IAIHandler,
    IAIProvider,
    IAIProvidersEmbedParams,
    IAIProvidersExecuteParams,
    IAIProvidersPluginSettings,
} from '@obsidian-ai-providers/sdk';
import { Ollama } from 'ollama';
import { electronFetch } from '../utils/electronFetch';
import { obsidianFetch } from '../utils/obsidianFetch';
import { logger } from '../utils/logger';
import { FetchSelector } from '../utils/FetchSelector';

// Add interface for model cache
interface ModelInfo {
    contextLength: number;
    lastContextLength: number;
}

const SYMBOLS_PER_TOKEN = 2.5;
const DEFAULT_CONTEXT_LENGTH = 2048;
const EMBEDDING_CONTEXT_LENGTH = 2048;
const CONTEXT_BUFFER_MULTIPLIER = 1.2; // 20% buffer

export class OllamaHandler implements IAIHandler {
    private modelInfoCache: Map<string, ModelInfo>;
    private fetchSelector: FetchSelector;

    constructor(private settings: IAIProvidersPluginSettings) {
        this.modelInfoCache = new Map();
        this.fetchSelector = new FetchSelector(settings);
    }

    private getClient(
        provider: IAIProvider,
        fetch: typeof electronFetch | typeof obsidianFetch
    ): Ollama {
        const clientConfig: any = {
            host: provider.url,
            fetch,
        };

        if (provider.apiKey) {
            clientConfig.headers = clientConfig.headers || {};
            clientConfig.headers.Authorization = `Bearer ${provider.apiKey}`;
        }

        return new Ollama(clientConfig);
    }

    private getDefaultModelInfo(): ModelInfo {
        return {
            contextLength: 0,
            lastContextLength: DEFAULT_CONTEXT_LENGTH,
        };
    }

    private async getCachedModelInfo(
        provider: IAIProvider,
        modelName: string
    ): Promise<ModelInfo> {
        const cacheKey = `${provider.url}_${modelName}`;
        const cached = this.modelInfoCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const ollama = this.getClient(
            provider,
            this.settings.useNativeFetch ? fetch : obsidianFetch
        );
        try {
            let config: any = { model: modelName };
            if (provider.type === 'ollama-openwebui') {
                config = { name: modelName };
            }
            const response = await ollama.show(config);
            const modelInfo = this.getDefaultModelInfo();

            const contextLengthEntry = Object.entries(response.model_info).find(
                ([key, value]) =>
                    (key.endsWith('.context_length') || key === 'num_ctx') &&
                    typeof value === 'number' &&
                    value > 0
            );

            if (
                contextLengthEntry &&
                typeof contextLengthEntry[1] === 'number'
            ) {
                modelInfo.contextLength = contextLengthEntry[1];
            }

            this.modelInfoCache.set(cacheKey, modelInfo);
            return modelInfo;
        } catch (error) {
            logger.error('Failed to fetch model info:', error);
            return this.getDefaultModelInfo();
        }
    }

    private setModelInfoLastContextLength(
        provider: IAIProvider,
        modelName: string,
        num_ctx: number | undefined
    ) {
        const cacheKey = `${provider.url}_${modelName}`;
        const modelInfo = this.modelInfoCache.get(cacheKey);
        if (modelInfo) {
            this.modelInfoCache.set(cacheKey, {
                ...modelInfo,
                lastContextLength: num_ctx || modelInfo.lastContextLength,
            });
        }
    }

    async fetchModels({
        provider,
        abortController,
    }: {
        provider: IAIProvider;
        abortController?: AbortController;
    }): Promise<string[]> {
        if (abortController?.signal.aborted) {
            throw new Error('Aborted');
        }
        const operation = async (
            fetchImpl: typeof electronFetch | typeof obsidianFetch
        ) => {
            if (abortController?.signal.aborted) {
                throw new Error('Aborted');
            }
            const ollama = this.getClient(provider, fetchImpl);
            abortController?.signal.addEventListener('abort', () => {
                ollama.abort();
            });
            const models = await ollama.list();
            return models.models.map(model => model.name);
        };
        const result = await this.fetchSelector.request(provider, operation);
        if (abortController?.signal.aborted) {
            throw new Error('Aborted');
        }
        return result;
    }

    private optimizeContext(
        inputLength: number,
        lastContextLength: number,
        defaultContextLength: number,
        limit: number
    ): { num_ctx?: number; shouldUpdate: boolean } {
        const estimatedTokens = Math.ceil(inputLength / SYMBOLS_PER_TOKEN);

        // If current context is smaller than last used,
        // use the last known context size
        if (estimatedTokens <= lastContextLength) {
            return {
                num_ctx:
                    lastContextLength > defaultContextLength
                        ? lastContextLength
                        : undefined,
                shouldUpdate: false,
            };
        }

        // For large inputs, calculate new size with buffer
        const targetLength = Math.min(
            Math.ceil(
                Math.max(estimatedTokens, defaultContextLength) *
                    CONTEXT_BUFFER_MULTIPLIER
            ),
            limit
        );

        // Update only if we need context larger than previous
        const shouldUpdate = targetLength > lastContextLength;
        return {
            num_ctx: targetLength,
            shouldUpdate,
        };
    }

    private prepareChatMessages(params: IAIProvidersExecuteParams): {
        chatMessages: any[];
        extractedImages: string[];
    } {
        const chatMessages: {
            role: string;
            content: string;
            images?: string[];
        }[] = [];
        const extractedImages: string[] = [];

        if ('messages' in params && params.messages) {
            // Process messages with standardized handling for text and images
            params.messages.forEach(msg => {
                if (typeof msg.content === 'string') {
                    // Simple text content
                    chatMessages.push({
                        role: msg.role,
                        content: msg.content,
                    });
                } else {
                    // Extract text content from content blocks
                    const textContent = msg.content
                        .filter(block => block.type === 'text')
                        .map(block => (block.type === 'text' ? block.text : ''))
                        .join('\n');

                    // Extract image URLs from content blocks
                    msg.content
                        .filter(block => block.type === 'image_url')
                        .forEach(block => {
                            if (
                                block.type === 'image_url' &&
                                block.image_url?.url
                            ) {
                                extractedImages.push(block.image_url.url);
                            }
                        });

                    chatMessages.push({
                        role: msg.role,
                        content: textContent,
                    });
                }

                // Add any images from the images property
                if (msg.images?.length) {
                    extractedImages.push(...msg.images);
                }
            });
        } else if ('prompt' in params) {
            // Handle legacy prompt-based API
            if (params.systemPrompt) {
                chatMessages.push({
                    role: 'system',
                    content: params.systemPrompt,
                });
            }

            chatMessages.push({ role: 'user', content: params.prompt });

            // Add any images from params
            if (params.images?.length) {
                extractedImages.push(...params.images);
            }
        } else {
            throw new Error('Either messages or prompt must be provided');
        }

        return { chatMessages, extractedImages };
    }

    private async executeOllamaGeneration(
        params: IAIProvidersExecuteParams,
        ollama: any,
        onProgress?: (chunk: string, accumulatedText: string) => void,
        abortController?: AbortController
    ): Promise<string> {
        const modelInfo = await this.getCachedModelInfo(
            params.provider,
            params.provider.model || ''
        ).catch(error => {
            logger.error('Failed to get model info:', error);
            return null;
        });

        const { chatMessages, extractedImages } =
            this.prepareChatMessages(params);

        // Process images for Ollama format (remove data URL prefix)
        const processedImages =
            extractedImages.length > 0
                ? extractedImages.map(image =>
                      image.replace(/^data:image\/(.*?);base64,/, '')
                  )
                : undefined;

        // Prepare request options
        const requestOptions: Record<string, any> = {};

        // Optimize context for text-based conversations
        if (!processedImages?.length) {
            const inputLength = chatMessages.reduce(
                (acc, msg) => acc + msg.content.length,
                0
            );

            const { num_ctx, shouldUpdate } = this.optimizeContext(
                inputLength,
                modelInfo?.lastContextLength || DEFAULT_CONTEXT_LENGTH,
                DEFAULT_CONTEXT_LENGTH,
                modelInfo?.contextLength || DEFAULT_CONTEXT_LENGTH
            );

            if (num_ctx) {
                requestOptions.num_ctx = num_ctx;
            }

            if (shouldUpdate) {
                this.setModelInfoLastContextLength(
                    params.provider,
                    params.provider.model || '',
                    num_ctx
                );
            }
        }

        // Add any additional options from params
        if (params.options) {
            Object.assign(requestOptions, params.options);
        }

        // Add images to the last user message if present
        if (processedImages?.length) {
            const lastUserMessageIndex = chatMessages
                .map(msg => msg.role)
                .lastIndexOf('user');

            if (lastUserMessageIndex !== -1) {
                chatMessages[lastUserMessageIndex] = {
                    ...chatMessages[lastUserMessageIndex],
                    images: processedImages,
                };
            } else if (chatMessages.length > 0) {
                chatMessages[chatMessages.length - 1] = {
                    ...chatMessages[chatMessages.length - 1],
                    images: processedImages,
                };
            } else {
                chatMessages.push({
                    role: 'user',
                    content: '',
                    images: processedImages,
                });
            }
        }

        logger.debug('Sending chat request to Ollama');

        // Using Ollama chat API instead of generate
        const response = await ollama.chat({
            model: params.provider.model || '',
            messages: chatMessages,
            stream: true,
            options: {
                ...requestOptions,
            },
        });

        let fullText = '';
        for await (const chunk of response) {
            if (abortController?.signal.aborted) {
                throw new Error('Aborted');
            }
            const content = chunk.message?.content;
            if (content) {
                fullText += content;
                onProgress && onProgress(content, fullText);
            }

            // Update context length from response
            if (chunk.done && chunk.total_duration > 0) {
                this.setModelInfoLastContextLength(
                    params.provider,
                    params.provider.model || '',
                    chunk.context?.length
                );
            }
        }
        return fullText;
    }

    async embed(params: IAIProvidersEmbedParams): Promise<number[][]> {
        const inputText = params.input ?? (params as any).text;

        if (!inputText) {
            throw new Error('Either input or text parameter must be provided');
        }

        const abortController: AbortController | undefined = (params as any)
            .abortController;
        if (abortController?.signal.aborted) {
            throw new Error('Aborted');
        }

        const modelInfo = await this.getCachedModelInfo(
            params.provider,
            params.provider.model || ''
        );

        const maxInputLength = Array.isArray(inputText)
            ? Math.max(...inputText.map(text => text.length))
            : inputText.length;

        const { num_ctx, shouldUpdate } = this.optimizeContext(
            maxInputLength,
            modelInfo.lastContextLength || EMBEDDING_CONTEXT_LENGTH,
            EMBEDDING_CONTEXT_LENGTH,
            modelInfo.contextLength
        );

        if (shouldUpdate) {
            this.setModelInfoLastContextLength(
                params.provider,
                params.provider.model || '',
                num_ctx
            );
        }

        const operation = async (
            fetchImpl: typeof electronFetch | typeof obsidianFetch
        ) => {
            const ollama = this.getClient(params.provider, fetchImpl);
            abortController?.signal.addEventListener('abort', () => {
                ollama.abort();
            });

            const inputs = Array.isArray(inputText) ? inputText : [inputText];
            const embeddings: number[][] = [];
            const processedChunks: string[] = [];

            for (const input of inputs) {
                if (abortController?.signal.aborted) {
                    throw new Error('Aborted');
                }
                const response = await ollama.embed({
                    model: params.provider.model || '',
                    input: input,
                    options: { num_ctx },
                });
                embeddings.push(response.embeddings[0]);
                logger.debug('Embed response:', response);

                processedChunks.push(input);
                params.onProgress && params.onProgress([...processedChunks]);

                if (abortController?.signal.aborted) {
                    throw new Error('Aborted');
                }
            }

            return embeddings;
        };

        return this.fetchSelector.request(params.provider, operation);
    }

    async execute(params: IAIProvidersExecuteParams): Promise<string> {
        const unsafe = params as any; // access optional callbacks/abortController
        const externalAbort: AbortController | undefined =
            unsafe.abortController;
        const onProgress = unsafe.onProgress as
            | ((c: string, acc: string) => void)
            | undefined;

        if (externalAbort?.signal.aborted) {
            return Promise.reject(new Error('Aborted'));
        }

        try {
            return await this.fetchSelector.execute(
                params.provider,
                async (
                    fetchImpl: typeof electronFetch | typeof obsidianFetch
                ) => {
                    const ollama = this.getClient(params.provider, fetchImpl);
                    externalAbort?.signal.addEventListener('abort', () => {
                        ollama.abort();
                    });
                    if (externalAbort?.signal.aborted) {
                        throw new Error('Aborted');
                    }

                    return this.executeOllamaGeneration(
                        params,
                        ollama,
                        (chunk, acc) => {
                            onProgress && onProgress(chunk, acc);
                            if (externalAbort?.signal.aborted) {
                                throw new Error('Aborted');
                            }
                        },
                        externalAbort
                    );
                }
            );
        } catch (e) {
            const error = e as Error;
            if (error.message === 'Aborted') {
                return Promise.reject(error);
            }
            throw error;
        }
    }
}
