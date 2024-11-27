import { IAIHandler, IAIProvider, IAIProvidersExecuteParams, IChunkHandler, IAIProvidersEmbedParams, IAIProvidersPluginSettings } from '../types';
import { electronFetch } from '../utils/electronFetch';
import OpenAI from 'openai';
import { obsidianFetch } from '../utils/obsidianFetch';
import { logger } from '../utils/logger';

export class OpenAIHandler implements IAIHandler {
    constructor(private settings: IAIProvidersPluginSettings) {}

    private getClient(provider: IAIProvider, fetch: typeof electronFetch | typeof obsidianFetch): OpenAI {
        return new OpenAI({
            apiKey: provider.apiKey,
            baseURL: provider.url,
            dangerouslyAllowBrowser: true,
            fetch
        });
    }

    async fetchModels(provider: IAIProvider): Promise<string[]> {
        const openai = this.getClient(provider, this.settings.useNativeFetch ? fetch : obsidianFetch);
        const response = await openai.models.list();
        
        return response.data.map(model => model.id);
    }

    async embed(params: IAIProvidersEmbedParams): Promise<number[][]> {
        const openai = this.getClient(params.provider, this.settings.useNativeFetch ? fetch : obsidianFetch);
        const response = await openai.embeddings.create({
            model: params.provider.model || "",
            input: params.input
        });
        logger.debug('Embed response:', response);

        return response.data.map(item => item.embedding);
    }

    async execute(params: IAIProvidersExecuteParams): Promise<IChunkHandler> {
        const controller = new AbortController();
        const openai = this.getClient(params.provider, this.settings.useNativeFetch ? fetch : electronFetch.bind({
            controller
        }));
        let isAborted = false;

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
        
        if (params.systemPrompt) {
            messages.push({ role: 'system', content: params.systemPrompt });
        }
        if (params.images?.length) {
            messages.push({ role: 'user', content: [
                {
                    type: "text",
                    text: params.prompt,
                },
                ...params.images.map((image) => ({
                    type: "image_url",
                    image_url: {
                        url: image,
                    },
                } as OpenAI.Chat.Completions.ChatCompletionContentPartImage))
            ] });
        } else {
            messages.push({ role: 'user', content: params.prompt });
        }

        const handlers = {
            data: [] as ((chunk: string, accumulatedText: string) => void)[],
            end: [] as ((fullText: string) => void)[],
            error: [] as ((error: Error) => void)[]
        };

        (async () => {
            if (isAborted) return;
        
            try {
                console.log('openai.chat.completions.create', controller.signal.aborted);
                const response = await openai.chat.completions.create({
                    model: params.provider.model || "",
                    messages,
                    stream: true,
                    ...params.options
                }, { signal: controller.signal });
    
                let fullText = '';

                for await (const chunk of response) {
                    if (isAborted) break;
                    const content = chunk.choices[0]?.delta?.content;
                    if (content) {
                        fullText += content;
                        handlers.data.forEach(handler => handler(content, fullText));
                    }
                }
                if (!isAborted) {
                    handlers.end.forEach(handler => handler(fullText));
                }
            } catch (error) {
                console.log('openai.chat.completions.create error', error);
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
                console.log('aborted?', controller.signal.aborted);
            }
        };
    }
} 