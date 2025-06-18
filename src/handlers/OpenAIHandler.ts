import { IAIHandler, IAIProvider, IAIProvidersExecuteParams, IAIProvidersEmbedParams, IChunkHandler, IAIProvidersPluginSettings } from '@obsidian-ai-providers/sdk';
import { electronFetch, nativeFetch } from '../utils/electronFetch';
import OpenAI from 'openai';
import { obsidianFetch } from '../utils/obsidianFetch';
import { logger } from '../utils/logger';

export class OpenAIHandler implements IAIHandler {
    constructor(private settings: IAIProvidersPluginSettings) {}

    private getClient(provider: IAIProvider, fetch: typeof electronFetch | typeof obsidianFetch | typeof nativeFetch): OpenAI {
        return new OpenAI({
            apiKey: provider.apiKey,
            baseURL: provider.url,
            dangerouslyAllowBrowser: true,
            fetch
        });
    }

    async fetchModels(provider: IAIProvider): Promise<string[]> {
        const openai = this.getClient(provider, this.settings.useNativeFetch ? nativeFetch : obsidianFetch);
        const response = await openai.models.list();
        
        return response.data.map(model => model.id);
    }

    async embed(params: IAIProvidersEmbedParams): Promise<number[][]> {
        const openai = this.getClient(params.provider, this.settings.useNativeFetch ? nativeFetch : obsidianFetch);
        
        // Support for both input and text (for backward compatibility)
        // Using type assertion to bypass type checking
        const inputText = params.input ?? (params as any).text;
        
        if (!inputText) {
            throw new Error('Either input or text parameter must be provided');
        }
        
        const response = await openai.embeddings.create({
            model: params.provider.model || "",
            input: inputText
        });
        logger.debug('Embed response:', response);

        return response.data.map(item => item.embedding);
    }

    async execute(params: IAIProvidersExecuteParams): Promise<IChunkHandler> {
        const controller = new AbortController();
        const openai = this.getClient(params.provider, this.settings.useNativeFetch ? nativeFetch : electronFetch.bind({
            controller
        }));
        let isAborted = false;

        let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
        
        if ('messages' in params && params.messages) {
            // Convert messages to OpenAI format
            messages = params.messages.map(msg => {
                // Handle simple text content
                if (typeof msg.content === 'string') {
                    return {
                        role: msg.role as any, // Type as any to avoid role compatibility issues
                        content: msg.content
                    };
                } 
                
                // Handle content blocks (text and images)
                const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
                
                // Process each content block
                msg.content.forEach(block => {
                    if (block.type === 'text') {
                        content.push({ type: 'text', text: block.text });
                    } else if (block.type === 'image_url') {
                        content.push({
                            type: 'image_url',
                            image_url: { url: block.image_url.url }
                        } as OpenAI.Chat.Completions.ChatCompletionContentPartImage);
                    }
                });
                
                return {
                    role: msg.role as any,
                    content
                };
            });
        } else if ('prompt' in params) {
            // Legacy prompt-based API
            if (params.systemPrompt) {
                messages.push({ role: 'system', content: params.systemPrompt });
            }
            
            // Handle prompt with images
            if (params.images?.length) {
                const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
                    { type: "text", text: params.prompt }
                ];
                
                // Add images as content parts
                params.images.forEach(image => {
                    content.push({
                        type: "image_url",
                        image_url: { url: image }
                    } as OpenAI.Chat.Completions.ChatCompletionContentPartImage);
                });
                
                messages.push({ role: 'user', content });
            } else {
                messages.push({ role: 'user', content: params.prompt });
            }
        } else {
            throw new Error('Either messages or prompt must be provided');
        }

        const handlers = {
            data: [] as ((chunk: string, accumulatedText: string) => void)[],
            end: [] as ((fullText: string) => void)[],
            error: [] as ((error: Error) => void)[]
        };

        (async () => {
            if (isAborted) return;
        
            try {
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