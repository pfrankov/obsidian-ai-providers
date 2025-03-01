import { IAIHandler, IAIProvider, IAIProvidersExecuteParams, IChunkHandler, IAIProvidersEmbedParams, IAIProvidersPluginSettings } from '@obsidian-ai-providers/sdk';
import { electronFetch } from '../utils/electronFetch';
import { obsidianFetch } from '../utils/obsidianFetch';
import { logger } from '../utils/logger';

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string | Array<{ type: 'text' | 'image'; text?: string; source?: { type: 'base64'; media_type: string; data: string; } }>;
}

export class AnthropicHandler implements IAIHandler {
    private baseURL = 'https://api.anthropic.com/v1';

    constructor(private settings: IAIProvidersPluginSettings) {}

    private getHeaders(provider: IAIProvider): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            'x-api-key': provider.apiKey || '',
            'anthropic-dangerous-direct-browser-access': 'true',
            'anthropic-version': '2023-06-01',
        };
    }

    async fetchModels(provider: IAIProvider): Promise<string[]> {
        try {
            const fetch = this.settings.useNativeFetch ? globalThis.fetch : obsidianFetch;
            const response = await fetch(`${this.baseURL}/models`, {
                method: 'GET',
                headers: this.getHeaders(provider),
            });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: response.statusText }));
                throw new Error(error.error || 'Request failed');
            }
            
            const data = await response.json();
            return data.models
                .filter((model: any) => model.capabilities.completion)
                .map((model: any) => model.id);
        } catch (error) {
            logger.error('Failed to fetch Anthropic models:', error);
            throw error;
        }
    }

    async embed(params: IAIProvidersEmbedParams): Promise<number[][]> {
        throw new Error('Embeddings are not supported by Anthropic API');
    }

    async execute(params: IAIProvidersExecuteParams): Promise<IChunkHandler> {
        const controller = new AbortController();
        let isAborted = false;

        const handlers = {
            data: [] as ((chunk: string, accumulatedText: string) => void)[],
            end: [] as ((fullText: string) => void)[],
            error: [] as ((error: Error) => void)[]
        };

        (async () => {
            if (isAborted) return;

            try {
                const messages: AnthropicMessage[] = [];
                
                if (params.systemPrompt) {
                    messages.push({ role: 'user', content: params.systemPrompt });
                    messages.push({ role: 'assistant', content: 'I understand.' });
                }

                if (params.images?.length) {
                    messages.push({
                        role: 'user',
                        content: [
                            { type: 'text' as const, text: params.prompt },
                            ...params.images.map(image => ({
                                type: 'image' as const,
                                source: {
                                    type: 'base64' as const,
                                    media_type: 'image/jpeg',
                                    data: image.replace(/^data:image\/(.*?);base64,/, '')
                                }
                            }))
                        ]
                    });
                } else {
                    messages.push({ role: 'user', content: params.prompt });
                }

                const fetch = this.settings.useNativeFetch ? globalThis.fetch : electronFetch.bind({ controller });
                const response = await fetch(`${this.baseURL}/messages`, {
                    method: 'POST',
                    headers: this.getHeaders(params.provider),
                    body: JSON.stringify({
                        model: params.provider.model,
                        messages,
                        stream: true,
                        max_tokens: params.options?.max_tokens,
                        temperature: params.options?.temperature,
                        top_p: params.options?.top_p,
                        stop_sequences: params.options?.stop,
                    }),
                    signal: controller.signal,
                });

                if (!response.ok) {
                    const error = await response.json().catch(() => ({ error: response.statusText }));
                    throw new Error(error.error || 'Request failed');
                }

                const reader = response.body?.getReader();
                if (!reader) {
                    throw new Error('Stream not available');
                }

                const decoder = new TextDecoder();
                let fullText = '';

                try {
                    while (!isAborted) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        const chunk = decoder.decode(value);
                        const lines = chunk.split('\n').filter(line => line.trim());

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const data = JSON.parse(line.slice(6));
                                if (data.type === 'content_block_delta') {
                                    const content = data.delta?.text || '';
                                    if (content) {
                                        fullText += content;
                                        handlers.data.forEach(handler => handler(content, fullText));
                                    }
                                }
                            }
                        }
                    }
                } finally {
                    reader.releaseLock();
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
                logger.debug('Request aborted');
                isAborted = true;
                controller.abort();
            }
        };
    }
} 