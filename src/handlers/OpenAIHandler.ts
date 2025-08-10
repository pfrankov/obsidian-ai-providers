import {
    IAIHandler,
    IAIProvider,
    IAIProvidersEmbedParams,
    IAIProvidersExecuteParams,
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
        const result = await this.fetchSelector.request(
            provider,
            async (fetchImpl: typeof electronFetch | typeof obsidianFetch) => {
                if (abortController?.signal.aborted) {
                    throw new Error('Aborted');
                }
                const openai = this.getClient(provider, fetchImpl);
                const response = await openai.models.list();
                return response.data.map(model => model.id);
            }
        );
        if (abortController?.signal.aborted) {
            throw new Error('Aborted');
        }
        return result;
    }

    async embed(params: IAIProvidersEmbedParams): Promise<number[][]> {
        // Support for both input and text (for backward compatibility)
        // Using type assertion to bypass type checking
        const inputText = params.input ?? (params as any).text;

        if (!inputText) {
            throw new Error('Either input or text parameter must be provided');
        }

        // Access optional abortController directly for consistency
        const abortController: AbortController | undefined = (params as any)
            .abortController;
        if (abortController?.signal.aborted) {
            throw new Error('Aborted');
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
            if (abortController?.signal.aborted) {
                throw new Error('Aborted');
            }
            const operation = async (
                fetchImpl: typeof electronFetch | typeof obsidianFetch
            ) => {
                const openai = this.getClient(params.provider, fetchImpl);
                const response = await openai.embeddings.create(
                    {
                        model: params.provider.model || '',
                        input: chunk,
                    },
                    { signal: abortController?.signal }
                );
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

            if (abortController?.signal.aborted) {
                throw new Error('Aborted');
            }
        }

        return embeddings;
    }

    private async executeOpenAIGeneration(
        params: IAIProvidersExecuteParams,
        openai: OpenAI,
        onProgress?: (chunk: string, accumulatedText: string) => void,
        abortController?: AbortController
    ): Promise<string> {
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
            { signal: abortController?.signal }
        );

        let fullText = '';
        for await (const chunk of response) {
            if (abortController?.signal.aborted) {
                throw new Error('Aborted');
            }
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                fullText += content;
                onProgress && onProgress(content, fullText);
            }
        }
        return fullText;
    }

    async execute(params: IAIProvidersExecuteParams): Promise<string> {
        logger.debug('Starting execute process with params:', {
            model: params.provider.model,
            messagesCount: params.messages?.length || 0,
            promptLength: params.prompt?.length || 0,
            systemPromptLength: params.systemPrompt?.length || 0,
            hasImages: !!params.images?.length,
        });
        const unsafe = params as any;
        const externalAbort: AbortController = unsafe.abortController;

        const onProgress = unsafe.onProgress as
            | ((c: string, a: string) => void)
            | undefined;

        if (externalAbort?.signal.aborted) {
            return Promise.reject(new Error('Aborted'));
        }

        try {
            return await this.fetchSelector.execute(
                params.provider,
                async fetchImpl => {
                    const openai = this.getClient(params.provider, fetchImpl);
                    return this.executeOpenAIGeneration(
                        params,
                        openai,
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
