import { IAIHandler, IAIProvider, IAIProvidersExecuteParams, IChunkHandler } from '../types';
import { Ollama, GenerateResponse } from 'ollama';
import { electronFetch } from '../utils/electronFetch';
import { obsidianFetch } from '../utils/obsidianFetch';

export class OllamaHandler implements IAIHandler {
    private getClient(provider: IAIProvider, fetch: typeof electronFetch | typeof obsidianFetch): Ollama {
        return new Ollama({
            host: provider.url,
            fetch
        });
    }

    async fetchModels(provider: IAIProvider): Promise<string[]> {
        const ollama = this.getClient(provider, obsidianFetch);
        const models = await ollama.list();
        return models.models.map(model => model.name);
    }

    async execute(params: IAIProvidersExecuteParams): Promise<IChunkHandler> {
        const controller = new AbortController();
        const ollama = this.getClient(params.provider, electronFetch.bind({
            controller
        }));
        let isAborted = false;
        let response: AsyncIterable<GenerateResponse> | null = null;
        
        const handlers = {
            data: [] as ((chunk: string, accumulatedText: string) => void)[],
            end: [] as ((fullText: string) => void)[],
            error: [] as ((error: Error) => void)[]
        };

        (async () => {
            if (isAborted) return;
            
            let fullText = '';
    
            console.time('generate');
            response = await ollama.generate({
                model: params.provider.model?.id || "",
                system: params.systemPrompt,
                prompt: params.prompt,
                stream: true,
                ...params.options
            });
            console.timeEnd('generate');

            console.time('stream');
            try {
                for await (const part of response) {
                    if (isAborted) break;
                    if (part.response) {
                        fullText += part.response;
                        handlers.data.forEach(handler => handler(part.response, fullText));
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
            console.timeEnd('stream');
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
                console.log('abort');
                controller.abort();
            }
        };
    }
} 