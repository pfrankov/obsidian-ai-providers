import {
    IAIHandler,
    IAIProvider,
    IAIProvidersExecuteParams,
    IChunkHandler,
    IAIProvidersEmbedParams,
    IAIProvidersPluginSettings,
} from '@obsidian-ai-providers/sdk';
import { electronFetch } from '../utils/electronFetch';
import OpenAI from 'openai';
import { obsidianFetch } from '../utils/obsidianFetch';
import { logger } from '../utils/logger';
import { FetchSelector } from '../utils/FetchSelector';

export class OpenAIHandler implements IAIHandler {
    private fetchSelector: FetchSelector;

    constructor(private settings: IAIProvidersPluginSettings) {
        this.fetchSelector = new FetchSelector(settings);
    }

    private getClient(
        provider: IAIProvider,
        fetch?: typeof electronFetch | typeof obsidianFetch
    ): OpenAI {
        // Determine which fetch to use based on CORS status and settings
        let actualFetch: typeof electronFetch | typeof obsidianFetch;

        if (fetch) {
            // Use provided fetch function
            actualFetch = fetch;
        } else {
            // Use FetchSelector to determine the appropriate fetch function
            actualFetch = this.fetchSelector.getFetchFunction(provider);
        }

        const openai = new OpenAI({
            baseURL:
                provider.url ||
                (provider.type === 'openai'
                    ? undefined
                    : 'http://localhost:1234/v1'),
            apiKey: provider.apiKey || 'placeholder-key',
            dangerouslyAllowBrowser: true,
            fetch: actualFetch as any,
            defaultHeaders: {
                'x-stainless-arch': null,
                'x-stainless-lang': null,
                'x-stainless-os': null,
                'x-stainless-package-version': null,
                'x-stainless-retry-count': null,
                'x-stainless-runtime': null,
                'x-stainless-runtime-version': null,
                'x-stainless-timeout': null,
            },
        });

        return openai;
    }

    async fetchModels(provider: IAIProvider): Promise<string[]> {
        const operation = async (
            fetchImpl: typeof electronFetch | typeof obsidianFetch
        ) => {
            const openai = this.getClient(provider, fetchImpl);
            const response = await openai.models.list();
            return response.data.map(model => model.id);
        };

        return this.fetchSelector.request(provider, operation);
    }

    async embed(params: IAIProvidersEmbedParams): Promise<number[][]> {
        // Support for both input and text (for backward compatibility)
        // Using type assertion to bypass type checking
        const inputText = params.input ?? (params as any).text;

        if (!inputText) {
            throw new Error('Either input or text parameter must be provided');
        }

        const inputs = Array.isArray(inputText) ? inputText : [inputText];
        const embeddings: number[][] = [];

        // OpenAI has a limit of 2048 inputs per request
        const CHUNK_SIZE = 2048;
        const chunks = [];

        for (let i = 0; i < inputs.length; i += CHUNK_SIZE) {
            chunks.push(inputs.slice(i, i + CHUNK_SIZE));
        }

        const processedChunks: string[] = [];

        for (const chunk of chunks) {
            const operation = async (
                fetchImpl: typeof electronFetch | typeof obsidianFetch
            ) => {
                const openai = this.getClient(params.provider, fetchImpl);
                const response = await openai.embeddings.create({
                    model: params.provider.model || '',
                    input: chunk,
                });
                logger.debug('Embed response:', response);
                return response.data.map(item => item.embedding);
            };

            const chunkEmbeddings = await this.fetchSelector.request(
                params.provider,
                operation
            );
            embeddings.push(...chunkEmbeddings);

            processedChunks.push(...chunk);
            params.onProgress && params.onProgress([...processedChunks]);
        }

        return embeddings;
    }

    private async executeOpenAIGeneration(
        params: IAIProvidersExecuteParams,
        openai: OpenAI,
        handlers: {
            data: ((chunk: string, accumulatedText: string) => void)[];
            end: ((fullText: string) => void)[];
            error: ((error: Error) => void)[];
        },
        isAborted: () => boolean,
        controller: AbortController
    ): Promise<void> {
        let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

        if ('messages' in params && params.messages) {
            // Convert messages to OpenAI format
            messages = params.messages.map(msg => {
                // Handle simple text content
                if (typeof msg.content === 'string') {
                    return {
                        role: msg.role as any, // Type as any to avoid role compatibility issues
                        content: msg.content,
                    };
                }

                // Handle content blocks (text and images)
                const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] =
                    [];

                // Process each content block
                msg.content.forEach(block => {
                    if (block.type === 'text') {
                        content.push({ type: 'text', text: block.text });
                    } else if (block.type === 'image_url') {
                        content.push({
                            type: 'image_url',
                            image_url: { url: block.image_url.url },
                        } as OpenAI.Chat.Completions.ChatCompletionContentPartImage);
                    }
                });

                return {
                    role: msg.role as any,
                    content,
                };
            });
        } else if ('prompt' in params) {
            // Legacy prompt-based API
            if (params.systemPrompt) {
                messages.push({ role: 'system', content: params.systemPrompt });
            }

            // Handle prompt with images
            if (params.images?.length) {
                const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] =
                    [{ type: 'text', text: params.prompt }];

                // Add images as content parts
                params.images.forEach(image => {
                    content.push({
                        type: 'image_url',
                        image_url: { url: image },
                    } as OpenAI.Chat.Completions.ChatCompletionContentPartImage);
                });

                messages.push({ role: 'user', content });
            } else {
                messages.push({ role: 'user', content: params.prompt });
            }
        } else {
            throw new Error('Either messages or prompt must be provided');
        }

        logger.debug('Sending chat request to OpenAI');

        const response = await openai.chat.completions.create(
            {
                model: params.provider.model || '',
                messages,
                stream: true,
                ...params.options,
            },
            { signal: controller.signal }
        );

        let fullText = '';
        for await (const chunk of response) {
            if (isAborted()) {
                logger.debug('Generation aborted');
                break;
            }

            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                fullText += content;
                handlers.data.forEach(handler => handler(content, fullText));
            }
        }

        if (!isAborted()) {
            logger.debug('Generation completed successfully:', {
                totalLength: fullText.length,
            });
            handlers.end.forEach(handler => handler(fullText));
        }
    }

    async execute(params: IAIProvidersExecuteParams): Promise<IChunkHandler> {
        logger.debug('Starting execute process with params:', {
            model: params.provider.model,
            messagesCount: params.messages?.length || 0,
            promptLength: params.prompt?.length || 0,
            systemPromptLength: params.systemPrompt?.length || 0,
            hasImages: !!params.images?.length,
        });

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
                    const openai = this.getClient(params.provider, fetchImpl);
                    await this.executeOpenAIGeneration(
                        params,
                        openai,
                        handlers,
                        () => isAborted,
                        controller
                    );
                };

                await this.fetchSelector.execute(params.provider, operation);
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
                logger.debug('Request aborted');
                isAborted = true;
                controller.abort();
            },
        };
    }
}
