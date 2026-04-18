import {
    IAIAssistantToolMessage,
    IAIHandler,
    IAIProvider,
    IAIProvidersEmbedParams,
    IAIProvidersExecuteParams,
    IAIProvidersToolsExecuteParams,
    IAIProvidersPluginSettings,
    IChatMessage,
    IContentBlock,
    IAIToolCall,
    IAIToolChoice,
    IAIToolDefinition,
} from '@obsidian-ai-providers/sdk';
import OpenAI from 'openai';
import { logger } from '../utils/logger';
import { FetchFunction, FetchSelector } from '../utils/FetchSelector';
import { logToolsRequest, logToolsResponse } from '../utils/modelDebugSummary';

type ChatCompletionDelta =
    OpenAI.Chat.Completions.ChatCompletionChunk['choices'][number]['delta'] & {
        reasoning?: string;
    };
type ChatCompletionToolDelta = NonNullable<
    ChatCompletionDelta['tool_calls']
>[number];

type StreamedOpenAIResult = {
    text: string;
    toolCalls: IAIToolCall[];
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

    private buildTextContentParts(
        blocks: IContentBlock[]
    ): OpenAI.Chat.Completions.ChatCompletionContentPartText[] {
        return blocks
            .filter(
                (block): block is Extract<IContentBlock, { type: 'text' }> => {
                    return block.type === 'text';
                }
            )
            .map(block => ({
                type: 'text',
                text: block.text,
            }));
    }

    private extractTextFromContent(
        content: string | IContentBlock[] | null
    ): string {
        if (content === null) {
            return '';
        }
        if (typeof content === 'string') {
            return content;
        }
        return content
            .filter(
                (block): block is Extract<IContentBlock, { type: 'text' }> => {
                    return block.type === 'text';
                }
            )
            .map(block => block.text)
            .join('\n');
    }

    private mapToolCallsToOpenAI(
        toolCalls?: IAIToolCall[]
    ): OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined {
        if (!toolCalls?.length) {
            return undefined;
        }

        return toolCalls.map(toolCall => ({
            id: toolCall.id,
            type: 'function',
            function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
            },
        }));
    }

    private buildUserMessageContent(
        message: IChatMessage
    ): string | OpenAI.Chat.Completions.ChatCompletionContentPart[] {
        if (Array.isArray(message.content)) {
            const contentParts = [...this.buildContentParts(message.content)];
            message.images?.forEach(image => {
                contentParts.push({
                    type: 'image_url',
                    image_url: { url: image },
                } as OpenAI.Chat.Completions.ChatCompletionContentPartImage);
            });
            return contentParts;
        }

        const textContent = this.extractTextFromContent(message.content);
        if (!message.images?.length) {
            return textContent;
        }

        return this.buildPromptContentParts(textContent, message.images);
    }

    private mapAssistantMessage(
        message: IChatMessage
    ): OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam {
        const content =
            typeof message.content === 'string' || message.content === null
                ? message.content
                : this.buildTextContentParts(message.content);
        return {
            role: 'assistant',
            content,
            name: message.name,
            tool_calls: this.mapToolCallsToOpenAI(message.tool_calls),
        };
    }

    private mapToolMessage(
        message: IChatMessage
    ): OpenAI.Chat.Completions.ChatCompletionToolMessageParam {
        if (!message.tool_call_id) {
            throw new Error('Tool message requires tool_call_id');
        }
        const content =
            typeof message.content === 'string'
                ? message.content
                : this.buildTextContentParts(message.content || []);
        return {
            role: 'tool',
            content,
            tool_call_id: message.tool_call_id,
        };
    }

    private mapSystemOrDeveloperMessage(
        message: IChatMessage
    ):
        | OpenAI.Chat.Completions.ChatCompletionSystemMessageParam
        | OpenAI.Chat.Completions.ChatCompletionDeveloperMessageParam {
        const content =
            typeof message.content === 'string'
                ? message.content
                : this.buildTextContentParts(message.content || []);
        return {
            role: message.role,
            content,
            name: message.name,
        } as
            | OpenAI.Chat.Completions.ChatCompletionSystemMessageParam
            | OpenAI.Chat.Completions.ChatCompletionDeveloperMessageParam;
    }

    private unsupportedRole(role: string): never {
        throw new Error(`Unsupported message role: ${role}`);
    }

    private mapMessageToOpenAIMessage(
        message: IChatMessage
    ): OpenAI.Chat.Completions.ChatCompletionMessageParam {
        if (message.role === 'assistant')
            return this.mapAssistantMessage(message);
        if (message.role === 'tool') return this.mapToolMessage(message);
        if (message.role === 'system' || message.role === 'developer') {
            return this.mapSystemOrDeveloperMessage(message);
        }
        if (message.role !== 'user') {
            return this.unsupportedRole(message.role);
        }

        return {
            role: 'user',
            content: this.buildUserMessageContent(message),
            name: message.name,
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

    private buildStreamingAppend(
        delta: ChatCompletionDelta | undefined,
        isInThinkBlock: boolean
    ): { appendText: string; isInThinkBlock: boolean } {
        let content = '';
        let reasoning = '';

        if (typeof delta?.content === 'string') {
            content = delta.content;
        }

        if (typeof delta?.reasoning === 'string') {
            reasoning = delta.reasoning;
        }

        let appendText = '';

        if (reasoning !== '') {
            if (!isInThinkBlock) {
                appendText += '<think>';
                isInThinkBlock = true;
            }
            appendText += reasoning;
        }

        if (content !== '') {
            if (isInThinkBlock) {
                appendText += '</think>';
                isInThinkBlock = false;
            }
            appendText += content;
        }

        return { appendText, isInThinkBlock };
    }

    private appendToolCallDelta(
        toolCallsByIndex: Map<number, IAIToolCall>,
        toolCallDeltas?: ChatCompletionToolDelta[]
    ) {
        if (!toolCallDeltas?.length) {
            return;
        }

        toolCallDeltas.forEach(toolCallDelta => {
            const index = toolCallDelta.index;
            const existing = toolCallsByIndex.get(index) || {
                id: `call_${index + 1}`,
                type: 'function' as const,
                function: {
                    name: '',
                    arguments: '',
                },
            };

            if (toolCallDelta.id) {
                existing.id = toolCallDelta.id;
            }
            if (toolCallDelta.function?.name) {
                existing.function.name = toolCallDelta.function.name;
            }
            if (toolCallDelta.function?.arguments) {
                existing.function.arguments += toolCallDelta.function.arguments;
            }

            toolCallsByIndex.set(index, existing);
        });
    }

    private toSortedToolCalls(
        toolCallsByIndex: Map<number, IAIToolCall>
    ): IAIToolCall[] {
        return [...toolCallsByIndex.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, toolCall]) => toolCall);
    }

    private async streamChatResponse(
        response: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
        abortController?: AbortController,
        onProgress?: (chunk: string, accumulatedText: string) => void
    ): Promise<StreamedOpenAIResult> {
        let fullText = '';
        let isInThinkBlock = false;
        const toolCallsByIndex = new Map<number, IAIToolCall>();

        for await (const chunk of response) {
            this.ensureNotAborted(abortController);
            const delta = chunk.choices[0]?.delta as
                | ChatCompletionDelta
                | undefined;
            const result = this.buildStreamingAppend(delta, isInThinkBlock);
            isInThinkBlock = result.isInThinkBlock;

            if (result.appendText.length > 0) {
                fullText += result.appendText;
                onProgress?.(result.appendText, fullText);
            }

            this.appendToolCallDelta(toolCallsByIndex, delta?.tool_calls);
        }

        if (isInThinkBlock) {
            fullText += '</think>';
            onProgress?.('</think>', fullText);
        }

        return {
            text: fullText,
            toolCalls: this.toSortedToolCalls(toolCallsByIndex),
        };
    }

    private mapTools(
        tools: IAIToolDefinition[]
    ): OpenAI.Chat.Completions.ChatCompletionTool[] {
        return tools.map(tool => ({
            type: 'function',
            function: {
                name: tool.function.name,
                description: tool.function.description,
                parameters: tool.function.parameters,
                strict: tool.function.strict,
            },
        }));
    }

    private mapToolChoice(
        toolChoice: IAIToolChoice
    ): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption {
        if (typeof toolChoice === 'string') {
            return toolChoice;
        }

        return {
            type: 'function',
            function: {
                name: toolChoice.function.name,
            },
        };
    }

    private buildRequestOptions(
        params: IAIProvidersExecuteParams
    ): Record<string, unknown> {
        return params.options ? { ...params.options } : {};
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

    private buildToolsRequestOptions(
        params: IAIProvidersToolsExecuteParams
    ): Record<string, unknown> {
        this.assertNoToolConfigInOptions(params.options);
        const requestOptions = params.options ? { ...params.options } : {};

        requestOptions.tools = this.mapTools(params.tools);
        if (params.tool_choice !== undefined) {
            requestOptions.tool_choice = this.mapToolChoice(params.tool_choice);
        }

        return requestOptions;
    }

    private getClient(provider: IAIProvider, fetchImpl: FetchFunction): OpenAI {
        const openai = new OpenAI({
            baseURL:
                provider.url ||
                (provider.type === 'openai'
                    ? undefined
                    : 'http://localhost:1234/v1'),
            apiKey: provider.apiKey || 'placeholder-key',
            dangerouslyAllowBrowser: true,
            fetch: fetchImpl,
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
            async (fetchImpl: FetchFunction) => {
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
        const legacyParams = params as IAIProvidersEmbedParams & {
            text?: string | string[];
        };
        const inputText = params.input ?? legacyParams.text;

        if (!inputText) {
            throw new Error('Either input or text parameter must be provided');
        }

        // Access optional abortController directly for consistency
        const abortController = params.abortController;
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
            const operation = async (fetchImpl: FetchFunction) => {
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
    }): Promise<IAIAssistantToolMessage> {
        const messages = this.buildOpenAIMessages(params);
        const requestOptions = this.buildRequestOptions(params);

        logger.debug('Sending chat request to OpenAI');

        const response = await openai.chat.completions.create(
            {
                model: params.provider.model || '',
                messages,
                stream: true,
                ...requestOptions,
            },
            { signal: abortController?.signal }
        );

        const streamedResult = await this.streamChatResponse(
            response,
            abortController,
            onProgress
        );

        const assistantMessage: IAIAssistantToolMessage = {
            role: 'assistant',
            content: streamedResult.text || null,
        };

        if (streamedResult.toolCalls.length > 0) {
            assistantMessage.tool_calls = streamedResult.toolCalls;
        }

        return assistantMessage;
    }

    private async executeOpenAIToolsGeneration({
        params,
        openai,
        onProgress,
        abortController,
    }: {
        params: IAIProvidersToolsExecuteParams;
        openai: OpenAI;
        onProgress?: (chunk: string, accumulatedText: string) => void;
        abortController?: AbortController;
    }): Promise<IAIAssistantToolMessage> {
        const messages = params.messages.map((message: IChatMessage) =>
            this.mapMessageToOpenAIMessage(message)
        );
        const requestOptions = this.buildToolsRequestOptions(params);

        logToolsRequest({
            provider: params.provider,
            messages: params.messages,
            tools: params.tools,
            toolChoice: params.tool_choice,
        });
        logger.debug('Sending tools chat request to OpenAI');

        const response = await openai.chat.completions.create(
            {
                model: params.provider.model || '',
                messages,
                stream: true,
                ...requestOptions,
            },
            { signal: abortController?.signal }
        );

        const streamedResult = await this.streamChatResponse(
            response,
            abortController,
            onProgress
        );

        const assistantMessage: IAIAssistantToolMessage = {
            role: 'assistant',
            content: streamedResult.text || null,
        };

        if (streamedResult.toolCalls.length > 0) {
            assistantMessage.tool_calls = streamedResult.toolCalls;
        }

        logToolsResponse({
            provider: params.provider,
            assistantMessage,
        });
        return assistantMessage;
    }

    private async runExecute(
        params: IAIProvidersExecuteParams
    ): Promise<IAIAssistantToolMessage> {
        logger.debug('Starting execute process with params:', {
            model: params.provider.model,
            messagesCount: params.messages?.length || 0,
            promptLength: params.prompt?.length || 0,
            systemPromptLength: params.systemPrompt?.length || 0,
            hasImages: !!params.images?.length,
        });
        const { abortController: externalAbort, onProgress } = params;

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

    async execute(params: IAIProvidersExecuteParams): Promise<string> {
        const assistantMessage = await this.runExecute(params);
        return assistantMessage.content || '';
    }

    async toolsExecute(
        params: IAIProvidersToolsExecuteParams
    ): Promise<IAIAssistantToolMessage> {
        const { abortController: externalAbort, onProgress } = params;

        this.ensureNotAborted(externalAbort);

        try {
            return await this.fetchSelector.execute(
                params.provider,
                async fetchImpl => {
                    const openai = this.getClient(params.provider, fetchImpl);
                    return this.executeOpenAIToolsGeneration({
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
        } catch (error) {
            if ((error as Error).message === 'Aborted') {
                return Promise.reject(error);
            }
            throw error;
        }
    }
}
