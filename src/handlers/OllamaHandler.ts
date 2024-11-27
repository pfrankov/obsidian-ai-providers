import { IAIHandler, IAIProvider, IAIProvidersExecuteParams, IChunkHandler, IAIProvidersEmbedParams, IAIProvidersPluginSettings } from '../types';
import { Ollama, GenerateResponse } from 'ollama';
import { electronFetch } from '../utils/electronFetch';
import { obsidianFetch } from '../utils/obsidianFetch';
import { logger } from '../utils/logger';

export class OllamaHandler implements IAIHandler {
    constructor(private settings: IAIProvidersPluginSettings) {}
    private getClient(provider: IAIProvider, fetch: typeof electronFetch | typeof obsidianFetch): Ollama {
        return new Ollama({
            host: provider.url,
            fetch
        });
    }

    async fetchModels(provider: IAIProvider): Promise<string[]> {
        const ollama = this.getClient(provider, this.settings.useNativeFetch ? fetch : obsidianFetch);
        const models = await ollama.list();
        return models.models.map(model => model.name);
    }

    async embed(params: IAIProvidersEmbedParams): Promise<number[][]> {
        const ollama = this.getClient(params.provider, this.settings.useNativeFetch ? fetch : obsidianFetch);
        const response = await ollama.embed({
            model: params.provider.model || "",
            input: params.input
        });
        return response.embeddings;
    }

    async execute(params: IAIProvidersExecuteParams): Promise<IChunkHandler> {
        const controller = new AbortController();
        const ollama = this.getClient(params.provider, this.settings.useNativeFetch ? fetch : electronFetch.bind({
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

            try {
                const images = params.images?.map((image) => image.replace(/^data:image\/(.*?);base64,/, ""));

				response = await ollama.generate({
					model: params.provider.model || "",
					system: params.systemPrompt,
					prompt: params.prompt,
                    images,
					stream: true,
					...params.options
				});

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
                logger.debug('Request aborted');
                controller.abort();
            }
        };
    }
} 
