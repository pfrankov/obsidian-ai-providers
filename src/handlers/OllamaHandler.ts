import {
    IAIHandler,
    IAIProvider,
    IAIProvidersExecuteParams,
    IChunkHandler,
    IAIProvidersEmbedParams,
    IAIProvidersPluginSettings,
} from '@obsidian-ai-providers/sdk';
import { Ollama } from 'ollama';
import { electronFetch } from '../utils/electronFetch';
import { obsidianFetch } from '../utils/obsidianFetch';
import { logger } from '../utils/logger';
import { corsRetryManager, withCorsRetry } from '../utils/corsRetryManager';

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

    constructor(private settings: IAIProvidersPluginSettings) {
        this.modelInfoCache = new Map();
    }

    dispose() {
        this.modelInfoCache.clear();
    }

    private getClient(
        provider: IAIProvider,
        fetch?: typeof electronFetch | typeof obsidianFetch
    ): Ollama {
        // Determine which fetch to use based on CORS status and settings
        let actualFetch: typeof electronFetch | typeof obsidianFetch;

        if (corsRetryManager.shouldUseFallback(provider)) {
            // Force obsidianFetch for CORS-blocked providers (highest priority)
            actualFetch = obsidianFetch;
            logger.debug(
                'Using obsidianFetch for CORS-blocked provider:',
                provider.name
            );
        } else if (fetch) {
            // Use provided fetch function
            actualFetch = fetch;
        } else {
            // Use default based on settings - electronFetch if not using native
            actualFetch = this.settings.useNativeFetch
                ? globalThis.fetch
                : electronFetch;
        }

        const client = new Ollama({
            host: provider.url,
            fetch: actualFetch as any,
        });

        return client;
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
            const response = await ollama.show({ model: modelName });
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

    async fetchModels(provider: IAIProvider): Promise<string[]> {
        const operation = async (
            fetchImpl: typeof electronFetch | typeof obsidianFetch
        ) => {
            const ollama = this.getClient(provider, fetchImpl);
            const models = await ollama.list();
            return models.models.map(model => model.name);
        };

        return withCorsRetry(
            provider,
            operation,
            this.settings.useNativeFetch ? fetch : obsidianFetch,
            'fetchModels'
        );
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
        handlers: {
            data: ((chunk: string, accumulatedText: string) => void)[];
            end: ((fullText: string) => void)[];
            error: ((error: Error) => void)[];
        },
        isAborted: () => boolean
    ): Promise<void> {
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
                ...params.options,
            },
        });

        let fullText = '';
        for await (const chunk of response) {
            if (isAborted()) {
                break;
            }

            const content = chunk.message?.content;
            if (content) {
                fullText += content;
                handlers.data.forEach(handler => handler(content, fullText));
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

        if (!isAborted()) {
            handlers.end.forEach(handler => handler(fullText));
        }
    }

    async embed(params: IAIProvidersEmbedParams): Promise<number[][]> {
        const inputText = params.input ?? (params as any).text;

        if (!inputText) {
            throw new Error('Either input or text parameter must be provided');
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

            const inputs = Array.isArray(inputText) ? inputText : [inputText];
            const embeddings: number[][] = [];

            for (const input of inputs) {
                const response = await ollama.embed({
                    model: params.provider.model || '',
                    input: input,
                    options: { num_ctx },
                });
                embeddings.push(response.embeddings[0]);
            }

            return embeddings;
        };

        return withCorsRetry(
            params.provider,
            operation,
            this.settings.useNativeFetch ? fetch : obsidianFetch,
            'embed'
        );
    }

    async execute(params: IAIProvidersExecuteParams): Promise<IChunkHandler> {
        const controller = new AbortController();
        let isAborted = false;

        const handlers = {
            data: [] as ((chunk: string, accumulatedText: string) => void)[],
            end: [] as ((fullText: string) => void)[],
            error: [] as ((error: Error) => void)[],
        };

        (async () => {
            if (isAborted) return;

            try {
                const operation = async (
                    fetchImpl: typeof electronFetch | typeof obsidianFetch
                ) => {
                    const ollama = this.getClient(params.provider, fetchImpl);
                    await this.executeOllamaGeneration(
                        params,
                        ollama,
                        handlers,
                        () => isAborted
                    );
                };

                await withCorsRetry(
                    params.provider,
                    operation,
                    this.settings.useNativeFetch ? fetch : electronFetch,
                    'execute'
                );
            } catch (error) {
                handlers.error.forEach(handler => handler(error as Error));
            }
        })();

        return {
            onData(callback: (chunk: string, accumulatedText: string) => void) {
                handlers.data.push(callback);
            },
            onEnd(callback: (fullText: string) => void) {
                handlers.end.push(callback);
            },
            onError(callback: (error: Error) => void) {
                handlers.error.push(callback);
            },
            abort() {
                isAborted = true;
                controller.abort();
            },
        };
    }
}
