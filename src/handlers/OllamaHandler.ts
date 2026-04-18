import {
    IAIAssistantToolMessage,
    IAIHandler,
    IAIProvider,
    IAIProvidersEmbedParams,
    IAIProvidersExecuteParams,
    IAIProvidersToolsExecuteParams,
    IAIProvidersPluginSettings,
    IContentBlock,
    IAIToolCall,
    IAIToolDefinition,
} from '@obsidian-ai-providers/sdk';
import { Ollama } from 'ollama';
import { electronFetch } from '../utils/electronFetch';
import { obsidianFetch } from '../utils/obsidianFetch';
import { logger } from '../utils/logger';
import { FetchSelector } from '../utils/FetchSelector';
import { logToolsRequest, logToolsResponse } from '../utils/modelDebugSummary';

// Add interface for model cache
interface ModelInfo {
    contextLength: number;
    lastContextLength: number;
}

const SYMBOLS_PER_TOKEN = 2.5;
const DEFAULT_CONTEXT_LENGTH = 2048;
const EMBEDDING_CONTEXT_LENGTH = 2048;
const CONTEXT_BUFFER_MULTIPLIER = 1.2; // 20% buffer
type TextContentBlock = Extract<IContentBlock, { type: 'text' }>;
type ImageContentBlock = Extract<IContentBlock, { type: 'image_url' }>;
type OllamaToolCall = {
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
};
type OllamaToolDefinition = {
    type: string;
    function: {
        name?: string;
        description?: string;
        type?: string;
        parameters?: Record<string, unknown>;
    };
};
type OllamaChatMessage = {
    role: string;
    content: string;
    images?: string[];
    tool_calls?: OllamaToolCall[];
    tool_name?: string;
};
type OllamaStreamChunk = {
    message?: {
        content?: string;
        tool_calls?: OllamaToolCall[];
        tool_name?: string;
    };
    done?: boolean;
    total_duration?: number;
    context?: number[];
};
type OllamaClientConfig = {
    host?: string;
    fetch?: typeof fetch;
    headers?: Record<string, string>;
};

export class OllamaHandler implements IAIHandler {
    private modelInfoCache: Map<string, ModelInfo>;
    private fetchSelector: FetchSelector;

    constructor(private settings: IAIProvidersPluginSettings) {
        this.modelInfoCache = new Map();
        this.fetchSelector = new FetchSelector(settings);
    }

    private ensureNotAborted(abortController?: AbortController) {
        if (abortController?.signal.aborted) {
            throw new Error('Aborted');
        }
    }

    private getClient(
        provider: IAIProvider,
        fetchImpl: typeof electronFetch | typeof obsidianFetch
    ): Ollama {
        const clientConfig: OllamaClientConfig = {
            host: provider.url,
            fetch: fetchImpl as typeof fetch,
        };

        if (provider.apiKey) {
            clientConfig.headers = clientConfig.headers || {};
            clientConfig.headers.Authorization = `Bearer ${provider.apiKey}`;
        }

        return new Ollama(clientConfig);
    }

    private getDefaultModelInfo(): ModelInfo {
        return {
            contextLength: 0,
            lastContextLength: DEFAULT_CONTEXT_LENGTH,
        };
    }

    private async getCachedModelInfo(
        provider: IAIProvider,
        modelName: string
    ): Promise<ModelInfo> {
        const cacheKey = `${provider.url}_${modelName}`;
        const cached = this.modelInfoCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const ollama = this.getClient(
            provider,
            this.settings.useNativeFetch ? fetch : obsidianFetch
        );
        try {
            const config =
                provider.type === 'ollama-openwebui'
                    ? ({ name: modelName } as unknown as Parameters<
                          Ollama['show']
                      >[0])
                    : { model: modelName };
            const response = await ollama.show(config);
            const modelInfo = this.getDefaultModelInfo();

            const contextLengthEntry = Object.entries(response.model_info).find(
                ([key, value]) =>
                    (key.endsWith('.context_length') || key === 'num_ctx') &&
                    typeof value === 'number' &&
                    value > 0
            );

            if (
                contextLengthEntry &&
                typeof contextLengthEntry[1] === 'number'
            ) {
                modelInfo.contextLength = contextLengthEntry[1];
            }

            this.modelInfoCache.set(cacheKey, modelInfo);
            return modelInfo;
        } catch (error) {
            logger.error('Failed to fetch model info:', error);
            return this.getDefaultModelInfo();
        }
    }

    private setModelInfoLastContextLength(
        provider: IAIProvider,
        modelName: string,
        num_ctx: number | undefined
    ) {
        const cacheKey = `${provider.url}_${modelName}`;
        const modelInfo = this.modelInfoCache.get(cacheKey);
        if (modelInfo) {
            this.modelInfoCache.set(cacheKey, {
                ...modelInfo,
                lastContextLength: num_ctx || modelInfo.lastContextLength,
            });
        }
    }

    async fetchModels({
        provider,
        abortController,
    }: {
        provider: IAIProvider;
        abortController?: AbortController;
    }): Promise<string[]> {
        this.ensureNotAborted(abortController);
        const operation = async (
            fetchImpl: typeof electronFetch | typeof obsidianFetch
        ) => {
            this.ensureNotAborted(abortController);
            const ollama = this.getClient(provider, fetchImpl);
            abortController?.signal.addEventListener('abort', () => {
                ollama.abort();
            });
            const models = await ollama.list();
            return models.models.map(model => model.name);
        };
        const result = await this.fetchSelector.request(provider, operation);
        this.ensureNotAborted(abortController);
        return result;
    }

    private optimizeContext({
        inputLength,
        lastContextLength,
        defaultContextLength,
        limit,
    }: {
        inputLength: number;
        lastContextLength: number;
        defaultContextLength: number;
        limit: number;
    }): { num_ctx?: number; shouldUpdate: boolean } {
        const estimatedTokens = Math.ceil(inputLength / SYMBOLS_PER_TOKEN);

        // If current context is smaller than last used,
        // use the last known context size
        if (estimatedTokens <= lastContextLength) {
            return {
                num_ctx:
                    lastContextLength > defaultContextLength
                        ? lastContextLength
                        : undefined,
                shouldUpdate: false,
            };
        }

        // For large inputs, calculate new size with buffer
        const targetLength = Math.min(
            Math.ceil(
                Math.max(estimatedTokens, defaultContextLength) *
                    CONTEXT_BUFFER_MULTIPLIER
            ),
            limit
        );

        // Update only if we need context larger than previous
        const shouldUpdate = targetLength > lastContextLength;
        return {
            num_ctx: targetLength,
            shouldUpdate,
        };
    }

    private applyContextOptimization({
        provider,
        modelName,
        inputLength,
        modelInfo,
        defaultContextLength,
    }: {
        provider: IAIProvider;
        modelName: string;
        inputLength: number;
        modelInfo: ModelInfo;
        defaultContextLength: number;
    }): number | undefined {
        const { num_ctx, shouldUpdate } = this.optimizeContext({
            inputLength,
            lastContextLength:
                modelInfo.lastContextLength || defaultContextLength,
            defaultContextLength,
            limit: modelInfo.contextLength || defaultContextLength,
        });

        if (shouldUpdate) {
            this.setModelInfoLastContextLength(provider, modelName, num_ctx);
        }

        return num_ctx;
    }

    private normalizeImages(images: string[]): string[] {
        return images.map(image =>
            image.replace(/^data:image\/(.*?);base64,/, '')
        );
    }

    private extractTextContent(
        content: string | IContentBlock[] | null
    ): string {
        if (content === null) {
            return '';
        }
        if (typeof content === 'string') {
            return content;
        }
        return content
            .filter((block): block is TextContentBlock => block.type === 'text')
            .map(block => block.text)
            .join('\n');
    }

    private parseToolArguments(toolCall: IAIToolCall): Record<string, unknown> {
        try {
            const parsed = JSON.parse(toolCall.function.arguments);
            if (
                parsed &&
                typeof parsed === 'object' &&
                !Array.isArray(parsed)
            ) {
                return parsed as Record<string, unknown>;
            }
            return { value: parsed };
        } catch {
            return { raw: toolCall.function.arguments };
        }
    }

    private mapToolCallsToOllama(toolCalls: IAIToolCall[]): OllamaToolCall[] {
        return toolCalls.map(toolCall => ({
            function: {
                name: toolCall.function.name,
                arguments: this.parseToolArguments(toolCall),
            },
        }));
    }

    private stringifyToolArguments(argumentsValue: unknown): string {
        if (typeof argumentsValue === 'string') {
            return argumentsValue;
        }
        try {
            return JSON.stringify(argumentsValue ?? {});
        } catch {
            return String(argumentsValue);
        }
    }

    private mapTools(tools: IAIToolDefinition[]): OllamaToolDefinition[] {
        return tools.map(tool => ({
            type: 'function',
            function: {
                name: tool.function.name,
                description: tool.function.description,
                parameters: tool.function.parameters,
            },
        }));
    }

    private normalizeMessageRole(role: string): string {
        if (role === 'developer') {
            return 'system';
        }
        if (
            role === 'assistant' ||
            role === 'system' ||
            role === 'tool' ||
            role === 'user'
        ) {
            return role;
        }
        throw new Error(`Unsupported message role: ${role}`);
    }

    private applyImagesToChatMessages(
        chatMessages: { role: string; content: string; images?: string[] }[],
        images: string[]
    ) {
        if (images.length === 0) {
            return;
        }

        const lastUserMessageIndex = chatMessages
            .map(msg => msg.role)
            .lastIndexOf('user');

        const targetIndex =
            lastUserMessageIndex !== -1
                ? lastUserMessageIndex
                : chatMessages.length - 1;

        if (targetIndex >= 0) {
            chatMessages[targetIndex] = {
                ...chatMessages[targetIndex],
                images,
            };
            return;
        }

        chatMessages.push({
            role: 'user',
            content: '',
            images,
        });
    }

    private async streamOllamaResponse({
        response,
        provider,
        modelName,
        onProgress,
        abortController,
    }: {
        response: AsyncIterable<OllamaStreamChunk>;
        provider: IAIProvider;
        modelName: string;
        onProgress?: (chunk: string, accumulatedText: string) => void;
        abortController?: AbortController;
    }): Promise<IAIAssistantToolMessage> {
        let fullText = '';
        const toolCallsByIndex = new Map<number, IAIToolCall>();

        for await (const chunk of response) {
            this.ensureNotAborted(abortController);
            const content = chunk.message?.content;
            if (content) {
                fullText += content;
                onProgress?.(content, fullText);
            }

            chunk.message?.tool_calls?.forEach((toolCall, index) => {
                const existing = toolCallsByIndex.get(index) || {
                    id: `call_${index + 1}`,
                    type: 'function' as const,
                    function: {
                        name: '',
                        arguments: '',
                    },
                };

                if (typeof toolCall.function.name === 'string') {
                    existing.function.name = toolCall.function.name;
                }

                existing.function.arguments = this.stringifyToolArguments(
                    toolCall.function.arguments
                );
                toolCallsByIndex.set(index, existing);
            });

            if (
                chunk.done &&
                typeof chunk.total_duration === 'number' &&
                chunk.total_duration > 0
            ) {
                this.setModelInfoLastContextLength(
                    provider,
                    modelName,
                    chunk.context?.length
                );
            }
        }

        const assistantMessage: IAIAssistantToolMessage = {
            role: 'assistant',
            content: fullText || null,
        };

        const toolCalls = [...toolCallsByIndex.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, toolCall]) => toolCall);

        if (toolCalls.length > 0) {
            assistantMessage.tool_calls = toolCalls;
        }

        return assistantMessage;
    }

    private prepareChatMessages(params: IAIProvidersExecuteParams): {
        chatMessages: OllamaChatMessage[];
        extractedImages: string[];
    } {
        const chatMessages: OllamaChatMessage[] = [];
        const extractedImages: string[] = [];

        if ('messages' in params && params.messages) {
            // Process messages with standardized handling for text and images
            params.messages.forEach(msg => {
                const textContent = this.extractTextContent(msg.content);

                if (Array.isArray(msg.content)) {
                    // Extract image URLs from content blocks
                    msg.content
                        .filter(
                            (block): block is ImageContentBlock =>
                                block.type === 'image_url'
                        )
                        .forEach(block => {
                            if (block.image_url?.url) {
                                extractedImages.push(block.image_url.url);
                            }
                        });
                }

                const chatMessage: OllamaChatMessage = {
                    role: this.normalizeMessageRole(msg.role),
                    content: textContent,
                };

                if (msg.role === 'assistant' && msg.tool_calls?.length) {
                    chatMessage.tool_calls = this.mapToolCallsToOllama(
                        msg.tool_calls
                    );
                }

                if (msg.role === 'tool' && msg.name) {
                    chatMessage.tool_name = msg.name;
                }

                chatMessages.push(chatMessage);

                // Add any images from the images property
                if (msg.images?.length) {
                    extractedImages.push(...msg.images);
                }
            });
        } else if ('prompt' in params) {
            // Handle legacy prompt-based API
            if (params.systemPrompt) {
                chatMessages.push({
                    role: 'system',
                    content: params.systemPrompt,
                });
            }

            chatMessages.push({ role: 'user', content: params.prompt });

            // Add any images from params
            if (params.images?.length) {
                extractedImages.push(...params.images);
            }
        } else {
            throw new Error('Either messages or prompt must be provided');
        }

        return { chatMessages, extractedImages };
    }

    private buildRequestConfig(params: IAIProvidersExecuteParams): {
        options: Record<string, unknown>;
    } {
        return {
            options: params.options ? { ...params.options } : {},
        };
    }

    private assertNoToolConfigInOptions(
        options: IAIProvidersToolsExecuteParams['options']
    ) {
        if (!options) {
            return;
        }
        if ('tools' in options || 'tool_choice' in options) {
            throw new Error(
                'Pass tools and tool_choice as top-level toolsExecute params'
            );
        }
    }

    private buildToolsRequestConfig(params: IAIProvidersToolsExecuteParams): {
        options: Record<string, unknown>;
        tools?: OllamaToolDefinition[];
    } {
        this.assertNoToolConfigInOptions(params.options);
        if (params.tool_choice !== undefined) {
            throw new Error(
                'tool_choice is not supported for Ollama providers'
            );
        }

        const requestOptions: Record<string, unknown> = params.options
            ? { ...params.options }
            : {};

        return {
            options: requestOptions,
            tools: this.mapTools(params.tools),
        };
    }

    private async executeOllamaGeneration({
        params,
        ollama,
        onProgress,
        abortController,
    }: {
        params: IAIProvidersExecuteParams;
        ollama: Ollama;
        onProgress?: (chunk: string, accumulatedText: string) => void;
        abortController?: AbortController;
    }): Promise<IAIAssistantToolMessage> {
        const modelName = params.provider.model || '';
        const modelInfo = await this.getCachedModelInfo(
            params.provider,
            modelName
        ).catch(error => {
            logger.error('Failed to get model info:', error);
            return null;
        });
        const effectiveModelInfo = modelInfo || this.getDefaultModelInfo();

        const { chatMessages, extractedImages } =
            this.prepareChatMessages(params);
        const processedImages = this.normalizeImages(extractedImages);
        const requestOptions = this.buildRequestConfig(params).options;

        if (processedImages.length === 0) {
            const inputLength = chatMessages.reduce(
                (acc, msg) => acc + msg.content.length,
                0
            );

            const num_ctx = this.applyContextOptimization({
                provider: params.provider,
                modelName,
                inputLength,
                modelInfo: effectiveModelInfo,
                defaultContextLength: DEFAULT_CONTEXT_LENGTH,
            });

            if (num_ctx) {
                requestOptions.num_ctx = num_ctx;
            }
        }

        this.applyImagesToChatMessages(chatMessages, processedImages);

        logger.debug('Sending chat request to Ollama');

        const response = await ollama.chat({
            model: modelName,
            messages: chatMessages,
            stream: true,
            options: requestOptions,
        });

        return this.streamOllamaResponse({
            response,
            provider: params.provider,
            modelName,
            onProgress,
            abortController,
        });
    }

    async embed(params: IAIProvidersEmbedParams): Promise<number[][]> {
        const legacyParams = params as IAIProvidersEmbedParams & {
            text?: string | string[];
        };
        const inputText = params.input ?? legacyParams.text;

        if (!inputText) {
            throw new Error('Either input or text parameter must be provided');
        }

        const abortController = params.abortController;
        this.ensureNotAborted(abortController);

        const modelName = params.provider.model || '';
        const modelInfo = await this.getCachedModelInfo(
            params.provider,
            modelName
        );

        const maxInputLength = Array.isArray(inputText)
            ? Math.max(...inputText.map(text => text.length))
            : inputText.length;

        const num_ctx = this.applyContextOptimization({
            provider: params.provider,
            modelName,
            inputLength: maxInputLength,
            modelInfo,
            defaultContextLength: EMBEDDING_CONTEXT_LENGTH,
        });

        const operation = async (
            fetchImpl: typeof electronFetch | typeof obsidianFetch
        ) => {
            const ollama = this.getClient(params.provider, fetchImpl);
            abortController?.signal.addEventListener('abort', () => {
                ollama.abort();
            });
            if (abortController?.signal.aborted) {
                ollama.abort();
                throw new Error('Aborted');
            }

            const inputs = Array.isArray(inputText) ? inputText : [inputText];
            const embeddings: number[][] = [];
            const processedChunks: string[] = [];

            for (const input of inputs) {
                this.ensureNotAborted(abortController);
                const response = await ollama.embed({
                    model: modelName,
                    input: input,
                    options: { num_ctx },
                });
                embeddings.push(response.embeddings[0]);
                logger.debug('Embed response:', response);

                processedChunks.push(input);
                params.onProgress?.([...processedChunks]);

                this.ensureNotAborted(abortController);
            }

            return embeddings;
        };

        return this.fetchSelector.request(params.provider, operation);
    }

    private async runExecute(
        params: IAIProvidersExecuteParams
    ): Promise<IAIAssistantToolMessage> {
        const { abortController: externalAbort, onProgress } = params;

        this.ensureNotAborted(externalAbort);

        try {
            return await this.fetchSelector.execute(
                params.provider,
                async (
                    fetchImpl: typeof electronFetch | typeof obsidianFetch
                ) => {
                    const ollama = this.getClient(params.provider, fetchImpl);
                    externalAbort?.signal.addEventListener('abort', () => {
                        ollama.abort();
                    });
                    this.ensureNotAborted(externalAbort);

                    return this.executeOllamaGeneration({
                        params,
                        ollama,
                        onProgress: (chunk, acc) => {
                            onProgress?.(chunk, acc);
                            this.ensureNotAborted(externalAbort);
                        },
                        abortController: externalAbort,
                    });
                }
            );
        } catch (error) {
            if ((error as Error).message === 'Aborted') {
                return Promise.reject(error);
            }
            throw error;
        }
    }

    async execute(params: IAIProvidersExecuteParams): Promise<string> {
        const assistantMessage = await this.runExecute(params);
        return assistantMessage.content || '';
    }

    async toolsExecute(
        params: IAIProvidersToolsExecuteParams
    ): Promise<IAIAssistantToolMessage> {
        const { abortController: externalAbort, onProgress } = params;

        this.ensureNotAborted(externalAbort);
        logToolsRequest({
            provider: params.provider,
            messages: params.messages,
            tools: params.tools,
            toolChoice: params.tool_choice,
        });

        try {
            const assistantMessage = await this.fetchSelector.execute(
                params.provider,
                async (
                    fetchImpl: typeof electronFetch | typeof obsidianFetch
                ) => {
                    const ollama = this.getClient(params.provider, fetchImpl);
                    externalAbort?.signal.addEventListener('abort', () => {
                        ollama.abort();
                    });
                    this.ensureNotAborted(externalAbort);

                    const modelName = params.provider.model || '';
                    const modelInfo = await this.getCachedModelInfo(
                        params.provider,
                        modelName
                    ).catch(error => {
                        logger.error('Failed to get model info:', error);
                        return null;
                    });
                    const effectiveModelInfo =
                        modelInfo || this.getDefaultModelInfo();

                    const { chatMessages, extractedImages } =
                        this.prepareChatMessages(
                            params as IAIProvidersExecuteParams
                        );
                    const processedImages =
                        this.normalizeImages(extractedImages);
                    const requestConfig = this.buildToolsRequestConfig(params);
                    const requestOptions = requestConfig.options;

                    if (processedImages.length === 0) {
                        const inputLength = chatMessages.reduce(
                            (acc, msg) => acc + msg.content.length,
                            0
                        );

                        const num_ctx = this.applyContextOptimization({
                            provider: params.provider,
                            modelName,
                            inputLength,
                            modelInfo: effectiveModelInfo,
                            defaultContextLength: DEFAULT_CONTEXT_LENGTH,
                        });

                        if (num_ctx) {
                            requestOptions.num_ctx = num_ctx;
                        }
                    }

                    this.applyImagesToChatMessages(
                        chatMessages,
                        processedImages
                    );

                    const response = await ollama.chat({
                        model: modelName,
                        messages: chatMessages,
                        tools: requestConfig.tools,
                        stream: true,
                        options: requestOptions,
                    });

                    return this.streamOllamaResponse({
                        response,
                        provider: params.provider,
                        modelName,
                        onProgress: (chunk, acc) => {
                            onProgress?.(chunk, acc);
                            this.ensureNotAborted(externalAbort);
                        },
                        abortController: externalAbort,
                    });
                }
            );
            logToolsResponse({
                provider: params.provider,
                assistantMessage,
            });
            return assistantMessage;
        } catch (error) {
            if ((error as Error).message === 'Aborted') {
                return Promise.reject(error);
            }
            throw error;
        }
    }
}
