import { IAIHandler, IAIProvider, IAIProvidersExecuteParams, IChunkHandler } from '../types';
import { electronFetch } from '../utils/electronFetch';
import OpenAI from 'openai';
import { obsidianFetch } from '../utils/obsidianFetch';
export class OpenAIHandler implements IAIHandler {
    private getClient(provider: IAIProvider, fetch: typeof electronFetch | typeof obsidianFetch): OpenAI {
        return new OpenAI({
            apiKey: provider.apiKey,
            baseURL: provider.url,
            dangerouslyAllowBrowser: true,
            fetch
        });
    }

    async fetchModels(provider: IAIProvider): Promise<string[]> {
        const openai = this.getClient(provider, obsidianFetch);
        const response = await openai.models.list();
        
        return response.data.map(model => model.id);
    }

    async execute(params: IAIProvidersExecuteParams): Promise<IChunkHandler> {
        const controller = new AbortController();
        const openai = this.getClient(params.provider, electronFetch.bind({
            controller
        }));
        let isAborted = false;

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
        
        if (params.systemPrompt) {
            messages.push({ role: 'system', content: params.systemPrompt });
        }
        messages.push({ role: 'user', content: params.prompt });

        const handlers = {
            data: [] as ((chunk: string, accumulatedText: string) => void)[],
            end: [] as ((fullText: string) => void)[],
            error: [] as ((error: Error) => void)[]
        };

        (async () => {
            if (isAborted) return;

            console.time('create');
            const response = await openai.chat.completions.create({
                model: params.provider.model?.id || "",
                messages,
                stream: true,
                ...params.options
            }, { signal: controller.signal });
            console.timeEnd('create');

            let fullText = '';
        
            try {
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
                if (!isAborted) {
                    handlers.error.forEach(handler => handler(error as Error));
                }
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
                console.log('aborted');
                isAborted = true;
                controller.abort();
            }
        };
    }
} 