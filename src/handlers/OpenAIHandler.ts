import {
    IAIHandler,
    IAIProvider,
    IAIProvidersEmbedParams,
    IAIProvidersExecuteParams,
    IAIProvidersPluginSettings,
    IContentBlock,
} from '@obsidian-ai-providers/sdk';
import { electronFetch } from '../utils/electronFetch';
import OpenAI from 'openai';
import { obsidianFetch } from '../utils/obsidianFetch';
import { logger } from '../utils/logger';
import { FetchSelector } from '../utils/FetchSelector';

type ChatMessage = {
    role: string;
    content: string | IContentBlock[];
    images?: string[];
};

export class OpenAIHandler implements IAIHandler {
    private fetchSelector: FetchSelector;

    constructor(private settings: IAIProvidersPluginSettings) {
        this.fetchSelector = new FetchSelector(settings);
    }

    private ensureNotAborted(abortController?: AbortController) {
        if (abortController?.signal.aborted) {
            throw new Error('Aborted');
        }
    }

    private buildContentParts(
        blocks: IContentBlock[]
    ): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
        return blocks.map(block => {
            if (block.type === 'text') {
                return { type: 'text', text: block.text };
            }
            return {
                type: 'image_url',
                image_url: { url: block.image_url.url },
            } as OpenAI.Chat.Completions.ChatCompletionContentPartImage;
        });
    }

    private mapMessageToOpenAIMessage(
        message: ChatMessage
    ): OpenAI.Chat.Completions.ChatCompletionMessageParam {
        if (typeof message.content === 'string') {
            return {
                role: message.role as any,
                content: message.content,
            };
        }

        return {
            role: message.role as any,
            content: this.buildContentParts(message.content),
        };
    }

    private buildPromptContentParts(
        prompt: string,
        images?: string[]
    ): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
        const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
            { type: 'text', text: prompt },
        ];

        images?.forEach(image => {
            content.push({
                type: 'image_url',
                image_url: { url: image },
            } as OpenAI.Chat.Completions.ChatCompletionContentPartImage);
        });

        return content;
    }

    private buildOpenAIMessages(
        params: IAIProvidersExecuteParams
    ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
        if ('messages' in params && params.messages) {
            return params.messages.map(message =>
                this.mapMessageToOpenAIMessage(message)
            );
        }

        if ('prompt' in params) {
            const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
                [];

            if (params.systemPrompt) {
                messages.push({
                    role: 'system',
                    content: params.systemPrompt,
                });
            }

            const userContent = params.images?.length
                ? this.buildPromptContentParts(params.prompt, params.images)
                : params.prompt;

            messages.push({ role: 'user', content: userContent });
            return messages;
        }

        throw new Error('Either messages or prompt must be provided');
    }

    private async streamChatResponse(
        response: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
        abortController?: AbortController,
        onProgress?: (chunk: string, accumulatedText: string) => void
    ): Promise<string> {
        let fullText = '';

        for await (const chunk of response) {
            this.ensureNotAborted(abortController);
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                fullText += content;
                onProgress?.(content, fullText);
            }
        }

        return fullText;
    }

    private getClient(
        provider: IAIProvider,
        fetch: typeof electronFetch | typeof obsidianFetch
    ): OpenAI {
        const openai = new OpenAI({
            baseURL:
                provider.url ||
                (provider.type === 'openai'
                    ? undefined
                    : 'http://localhost:1234/v1'),
            apiKey: provider.apiKey || 'placeholder-key',
            dangerouslyAllowBrowser: true,
            fetch: fetch as any,
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
        this.ensureNotAborted(abortController);
        const result = await this.fetchSelector.request(
            provider,
            async (fetchImpl: typeof electronFetch | typeof obsidianFetch) => {
                this.ensureNotAborted(abortController);
                const openai = this.getClient(provider, fetchImpl);
                const response = await openai.models.list();
                return response.data.map(model => model.id);
            }
        );
        this.ensureNotAborted(abortController);
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
            this.ensureNotAborted(abortController);
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
            params.onProgress?.([...processedChunks]);

            this.ensureNotAborted(abortController);
        }

        return embeddings;
    }

    private async executeOpenAIGeneration({
        params,
        openai,
        onProgress,
        abortController,
    }: {
        params: IAIProvidersExecuteParams;
        openai: OpenAI;
        onProgress?: (chunk: string, accumulatedText: string) => void;
        abortController?: AbortController;
    }): Promise<string> {
        const messages = this.buildOpenAIMessages(params);

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

        return this.streamChatResponse(response, abortController, onProgress);
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

        this.ensureNotAborted(externalAbort);

        try {
            return await this.fetchSelector.execute(
                params.provider,
                async fetchImpl => {
                    const openai = this.getClient(params.provider, fetchImpl);
                    return this.executeOpenAIGeneration({
                        params,
                        openai,
                        onProgress: (chunk, acc) => {
                            onProgress?.(chunk, acc);
                            this.ensureNotAborted(externalAbort);
                        },
                        abortController: externalAbort,
                    });
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
