import { IAIHandler, IAIProvider, IAIProvidersExecuteParams, IChunkHandler, IAIProvidersEmbedParams, IAIProvidersPluginSettings } from '@obsidian-ai-providers/sdk';
import { electronFetch } from '../utils/electronFetch';
import OpenAI from 'openai';
import { obsidianFetch } from '../utils/obsidianFetch';
import { logger } from '../utils/logger';
import { corsRetryManager, withCorsRetry } from '../utils/corsRetryManager';

export class OpenAIHandler implements IAIHandler {
    constructor(private settings: IAIProvidersPluginSettings) {}

    private getClient(provider: IAIProvider, fetch?: typeof electronFetch | typeof obsidianFetch): OpenAI {
        // Determine which fetch to use based on CORS status and settings
        let actualFetch: typeof electronFetch | typeof obsidianFetch;
        
        if (corsRetryManager.shouldUseFallback(provider)) {
            // Force obsidianFetch for CORS-blocked providers (highest priority)
            actualFetch = obsidianFetch;
            logger.debug('Using obsidianFetch for CORS-blocked provider:', provider.name);
        } else if (fetch) {
            // Use provided fetch function
            actualFetch = fetch;
        } else {
            // Use default based on settings - electronFetch if not using native
            actualFetch = this.settings.useNativeFetch ? globalThis.fetch : electronFetch;
        }
        
        return new OpenAI({
            apiKey: provider.apiKey,
            baseURL: provider.url,
            dangerouslyAllowBrowser: true,
            fetch: actualFetch
        });
    }

    async fetchModels(provider: IAIProvider): Promise<string[]> {
        const operation = async (fetchImpl: typeof electronFetch | typeof obsidianFetch) => {
            const openai = this.getClient(provider, fetchImpl);
            const response = await openai.models.list();
            return response.data.map(model => model.id);
        };

        return withCorsRetry(
            provider,
            operation,
            this.settings.useNativeFetch ? fetch : electronFetch,
            'fetchModels'
        );
    }

    async embed(params: IAIProvidersEmbedParams): Promise<number[][]> {
        // Support for both input and text (for backward compatibility)
        // Using type assertion to bypass type checking
        const inputText = params.input ?? (params as any).text;
        
        if (!inputText) {
            throw new Error('Either input or text parameter must be provided');
        }

        const operation = async (fetchImpl: typeof electronFetch | typeof obsidianFetch) => {
            const openai = this.getClient(params.provider, fetchImpl);
            const response = await openai.embeddings.create({
                model: params.provider.model || "",
                input: inputText
            });
            logger.debug('Embed response:', response);
            return response.data.map(item => item.embedding);
        };
        
        return withCorsRetry(
            params.provider,
            operation,
            this.settings.useNativeFetch ? fetch : electronFetch,
            'embed'
        );
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

        logger.debug('Sending chat request to OpenAI');
        
        const response = await openai.chat.completions.create({
            model: params.provider.model || "",
            messages,
            stream: true,
            ...params.options
        }, { signal: controller.signal });

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
                totalLength: fullText.length
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
            hasImages: !!params.images?.length
        });

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
                const operation = async (fetchImpl: typeof electronFetch | typeof obsidianFetch) => {
                    const openai = this.getClient(
                        params.provider,
                        fetchImpl
                    );
                    await this.executeOpenAIGeneration(params, openai, handlers, () => isAborted, controller);
                };

                await withCorsRetry(
                    params.provider,
                    operation,
                    this.settings.useNativeFetch ? fetch : electronFetch,
                    'execute'
                );
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