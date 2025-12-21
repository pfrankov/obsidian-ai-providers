import Anthropic from '@anthropic-ai/sdk';
import {
    Base64ImageSource,
    ContentBlockParam,
    MessageParam,
    RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import {
    IAIHandler,
    IAIProvider,
    IAIProvidersEmbedParams,
    IAIProvidersExecuteParams,
    IAIProvidersPluginSettings,
    IContentBlock,
} from '@obsidian-ai-providers/sdk';

import { FetchFunction, FetchSelector } from '../utils/FetchSelector';
import { logger } from '../utils/logger';

const DEFAULT_MAX_TOKENS = 1024;

type AnthropicImageSource = Base64ImageSource;
type AnthropicImageBlock = Extract<ContentBlockParam, { type: 'image' }>;

export class AnthropicHandler implements IAIHandler {
    private fetchSelector: FetchSelector;

    constructor(private settings: IAIProvidersPluginSettings) {
        this.fetchSelector = new FetchSelector(settings);
    }

    private ensureNotAborted(abortController?: AbortController) {
        if (abortController?.signal.aborted) {
            throw new Error('Aborted');
        }
    }

    private isSupportedMediaType(
        type: string
    ): type is AnthropicImageSource['media_type'] {
        return (
            type === 'image/jpeg' ||
            type === 'image/png' ||
            type === 'image/gif' ||
            type === 'image/webp'
        );
    }

    private getClient(
        provider: IAIProvider,
        fetchImpl: FetchFunction
    ): Anthropic {
        return new Anthropic({
            apiKey: provider.apiKey || 'placeholder-key',
            baseURL: provider.url || 'https://api.anthropic.com',
            dangerouslyAllowBrowser: true,
            fetch: fetchImpl as unknown as typeof fetch,
        });
    }

    private mapOptions(options?: Record<string, any>): {
        max_tokens: number;
        temperature?: number;
        top_p?: number;
        stop_sequences?: string[];
    } {
        const mapped: {
            max_tokens: number;
            temperature?: number;
            top_p?: number;
            stop_sequences?: string[];
        } = {
            max_tokens: options?.max_tokens ?? DEFAULT_MAX_TOKENS,
        };

        if (options?.temperature !== undefined) {
            mapped.temperature = options.temperature;
        }
        if (options?.top_p !== undefined) {
            mapped.top_p = options.top_p;
        }
        if (options?.stop?.length) {
            mapped.stop_sequences = options.stop;
        }

        return mapped;
    }

    private convertImage(url: string): AnthropicImageBlock | null {
        const dataUrlMatch = url.match(
            /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
        );
        if (!dataUrlMatch) {
            logger.warn(
                'Anthropic only supports base64-encoded image data URLs. Skipping image.'
            );
            return null;
        }

        const mediaTypeRaw = dataUrlMatch[1];
        if (!this.isSupportedMediaType(mediaTypeRaw)) {
            logger.warn(
                'Anthropic only supports jpeg, png, gif or webp images. Skipping image.'
            );
            return null;
        }
        const mediaType: AnthropicImageSource['media_type'] = mediaTypeRaw;
        const data = dataUrlMatch[2];
        return {
            type: 'image',
            source: {
                type: 'base64',
                media_type: mediaType,
                data,
            },
        };
    }

    private normalizeContent(
        content: string | IContentBlock[],
        images?: string[]
    ): ContentBlockParam[] {
        const blocks: ContentBlockParam[] = [];

        if (typeof content === 'string') {
            blocks.push({ type: 'text', text: content });
        } else {
            content.forEach(block => {
                if (block.type === 'text') {
                    blocks.push({ type: 'text', text: block.text });
                } else if (block.type === 'image_url') {
                    const converted = this.convertImage(block.image_url.url);
                    if (converted) {
                        blocks.push(converted);
                    }
                }
            });
        }

        images?.forEach(image => {
            const converted = this.convertImage(image);
            if (converted) {
                blocks.push(converted);
            }
        });

        return blocks.length ? blocks : [{ type: 'text', text: '' }];
    }

    private toAnthropicContent(
        blocks: ContentBlockParam[]
    ): ContentBlockParam[] | string {
        if (blocks.length === 1 && blocks[0].type === 'text') {
            return blocks[0].text;
        }
        return blocks;
    }

    private buildPayload(params: IAIProvidersExecuteParams): {
        system?: string;
        messages: MessageParam[];
    } {
        const systemMessages: string[] = [];
        const messages: MessageParam[] = [];

        if ('messages' in params && params.messages) {
            params.messages.forEach(msg => {
                const contentBlocks = this.normalizeContent(
                    msg.content as any,
                    msg.images
                );

                if (msg.role === 'system') {
                    const systemText = contentBlocks
                        .filter(block => block.type === 'text')
                        .map(block => (block as any).text)
                        .join('\n')
                        .trim();
                    if (systemText) {
                        systemMessages.push(systemText);
                    }
                    return;
                }

                messages.push({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content: this.toAnthropicContent(contentBlocks),
                });
            });
        } else if ('prompt' in params) {
            const contentBlocks = this.normalizeContent(
                params.prompt || '',
                params.images
            );
            if (params.systemPrompt) {
                systemMessages.push(params.systemPrompt);
            }
            messages.push({
                role: 'user',
                content: this.toAnthropicContent(contentBlocks),
            });
        } else {
            throw new Error('Either messages or prompt must be provided');
        }

        if (!messages.length) {
            throw new Error('At least one message is required for generation');
        }

        return {
            system: systemMessages.length
                ? systemMessages.join('\n\n')
                : undefined,
            messages,
        };
    }

    private extractTextFromEvent(event: RawMessageStreamEvent): string | null {
        if (
            event.type === 'content_block_delta' &&
            'text' in event.delta &&
            (event.delta as any).text
        ) {
            return (event.delta as any).text as string;
        }
        return null;
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
            async (fetchImpl: FetchFunction) => {
                this.ensureNotAborted(abortController);
                const client = this.getClient(provider, fetchImpl);

                const ids: string[] = [];

                for await (const model of client.models.list()) {
                    this.ensureNotAborted(abortController);
                    if (model?.id) {
                        ids.push(model.id);
                    }
                }
                return ids;
            }
        );

        this.ensureNotAborted(abortController);
        return result;
    }

    async embed(_params: IAIProvidersEmbedParams): Promise<number[][]> {
        throw new Error('Embeddings are not supported for Anthropic providers');
    }

    private async executeAnthropicGeneration(
        params: IAIProvidersExecuteParams,
        client: Anthropic,
        onProgress?: (chunk: string, accumulated: string) => void,
        abortController?: AbortController
    ): Promise<string> {
        const { messages, system } = this.buildPayload(params);
        const requestOptions = this.mapOptions(params.options);

        logger.debug('Sending chat request to Anthropic');

        const stream = await client.messages.create(
            {
                ...requestOptions,
                model: params.provider.model || '',
                messages,
                system,
                stream: true,
            },
            { signal: abortController?.signal }
        );

        let fullText = '';

        for await (const event of stream as any as AsyncIterable<RawMessageStreamEvent>) {
            this.ensureNotAborted(abortController);
            const textChunk = this.extractTextFromEvent(event);
            if (textChunk) {
                fullText += textChunk;
                onProgress && onProgress(textChunk, fullText);
            }
        }

        return fullText;
    }

    async execute(params: IAIProvidersExecuteParams): Promise<string> {
        const unsafeParams = params as any;
        const abortController: AbortController | undefined =
            unsafeParams.abortController;
        const onProgress = unsafeParams.onProgress as
            | ((chunk: string, acc: string) => void)
            | undefined;

        this.ensureNotAborted(abortController);

        try {
            return await this.fetchSelector.execute(
                params.provider,
                async (fetchImpl: FetchFunction) => {
                    const client = this.getClient(params.provider, fetchImpl);
                    return this.executeAnthropicGeneration(
                        params,
                        client,
                        (chunk, acc) => {
                            onProgress && onProgress(chunk, acc);
                            this.ensureNotAborted(abortController);
                        },
                        abortController
                    );
                }
            );
        } catch (error) {
            if ((error as Error).message === 'Aborted') {
                return Promise.reject(error);
            }
            throw error;
        }
    }
}
