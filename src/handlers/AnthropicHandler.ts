import Anthropic from '@anthropic-ai/sdk';
import {
    Base64ImageSource,
    ContentBlockParam,
    MessageParam,
    RawMessageStreamEvent,
    ToolChoice,
    ToolUnion,
} from '@anthropic-ai/sdk/resources/messages';
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

import { FetchFunction, FetchSelector } from '../utils/FetchSelector';
import { logger } from '../utils/logger';
import { logToolsRequest, logToolsResponse } from '../utils/modelDebugSummary';

const DEFAULT_MAX_TOKENS = 1024;

type AnthropicImageSource = Base64ImageSource;
type AnthropicImageBlock = Extract<ContentBlockParam, { type: 'image' }>;
type AnthropicRequestOptions = {
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    stop?: string[];
};

type AnthropicPayload = {
    system?: string;
    messages: MessageParam[];
};

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
            fetch: fetchImpl,
        });
    }

    private mapOptions(options?: AnthropicRequestOptions): {
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
        content: string | IContentBlock[] | null,
        images?: string[]
    ): ContentBlockParam[] {
        const blocks: ContentBlockParam[] = [];

        if (typeof content === 'string') {
            blocks.push({ type: 'text', text: content });
        } else if (Array.isArray(content)) {
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

    private extractText(content: string | IContentBlock[] | null): string {
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

    private toAnthropicContent(
        blocks: ContentBlockParam[]
    ): ContentBlockParam[] | string {
        if (blocks.length === 1 && blocks[0].type === 'text') {
            return blocks[0].text;
        }
        return blocks;
    }

    private parseToolArguments(argumentsText: string): unknown {
        try {
            return JSON.parse(argumentsText);
        } catch {
            return argumentsText;
        }
    }

    private mapAssistantToolCalls(
        toolCalls: IAIToolCall[]
    ): ContentBlockParam[] {
        return toolCalls.map(toolCall => ({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input: this.parseToolArguments(toolCall.function.arguments),
        })) as ContentBlockParam[];
    }

    private buildAssistantContent(
        message: IChatMessage
    ): ContentBlockParam[] | string {
        const contentBlocks: ContentBlockParam[] = [];
        const text = this.extractText(message.content);
        if (text !== '') {
            contentBlocks.push({ type: 'text', text });
        }
        if (message.tool_calls?.length) {
            contentBlocks.push(
                ...this.mapAssistantToolCalls(message.tool_calls)
            );
        }

        const normalizedContent: ContentBlockParam[] =
            contentBlocks.length > 0
                ? contentBlocks
                : ([{ type: 'text', text: '' }] as ContentBlockParam[]);
        return this.toAnthropicContent(normalizedContent);
    }

    private buildToolResultMessage(message: IChatMessage): MessageParam {
        if (!message.tool_call_id) {
            throw new Error('Tool message requires tool_call_id');
        }

        const content = this.extractText(message.content);

        return {
            role: 'user',
            content: [
                {
                    type: 'tool_result',
                    tool_use_id: message.tool_call_id,
                    content,
                },
            ],
        };
    }

    private mapMessageToAnthropicMessage(
        message: IChatMessage,
        systemMessages: string[]
    ): MessageParam | null {
        if (message.role === 'system' || message.role === 'developer') {
            const systemText = this.extractText(message.content).trim();
            if (systemText) {
                systemMessages.push(systemText);
            }
            return null;
        }

        if (message.role === 'assistant') {
            return {
                role: 'assistant',
                content: this.buildAssistantContent(message),
            };
        }

        if (message.role === 'tool') {
            return this.buildToolResultMessage(message);
        }

        if (message.role !== 'user') {
            throw new Error(`Unsupported message role: ${message.role}`);
        }

        const contentBlocks = this.normalizeContent(
            message.content,
            message.images
        );
        return {
            role: 'user',
            content: this.toAnthropicContent(contentBlocks),
        };
    }

    private mapTools(tools: IAIToolDefinition[]): ToolUnion[] {
        return tools.map(tool => ({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters || {
                type: 'object',
                properties: {},
            },
            strict: tool.function.strict ?? undefined,
        })) as ToolUnion[];
    }

    private mapToolChoice(toolChoice: IAIToolChoice): ToolChoice {
        if (toolChoice === 'auto') {
            return { type: 'auto' };
        }
        if (toolChoice === 'required') {
            return { type: 'any' };
        }
        if (toolChoice === 'none') {
            return { type: 'none' };
        }

        return {
            type: 'tool',
            name: toolChoice.function.name,
        };
    }

    private buildPayload(params: IAIProvidersExecuteParams): AnthropicPayload {
        const systemMessages: string[] = [];
        const messages: MessageParam[] = [];

        if ('messages' in params && params.messages) {
            params.messages.forEach(msg => {
                const anthropicMessage = this.mapMessageToAnthropicMessage(
                    msg,
                    systemMessages
                );
                if (anthropicMessage) {
                    messages.push(anthropicMessage);
                }
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

    private buildToolsPayload(
        params: IAIProvidersToolsExecuteParams
    ): AnthropicPayload {
        const systemMessages: string[] = [];
        const messages = params.messages
            .map((message: IChatMessage) =>
                this.mapMessageToAnthropicMessage(message, systemMessages)
            )
            .filter(
                (message: MessageParam | null): message is MessageParam =>
                    message !== null
            );

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

    private toToolArgumentsString(input: unknown): string {
        if (typeof input === 'string') {
            return input;
        }
        if (input === undefined) {
            return '';
        }

        try {
            return JSON.stringify(input);
        } catch {
            return String(input);
        }
    }

    private appendToolUseStart(
        toolCallsByIndex: Map<number, IAIToolCall>,
        event: Extract<RawMessageStreamEvent, { type: 'content_block_start' }>
    ) {
        const contentBlock = event.content_block as unknown as {
            [key: string]: unknown;
        };
        if (contentBlock.type !== 'tool_use') {
            return;
        }

        toolCallsByIndex.set(event.index, {
            id:
                typeof contentBlock.id === 'string'
                    ? contentBlock.id
                    : `call_${event.index + 1}`,
            type: 'function',
            function: {
                name:
                    typeof contentBlock.name === 'string'
                        ? contentBlock.name
                        : '',
                arguments: this.toToolArgumentsString(contentBlock.input),
            },
        });
    }

    private appendToolUseDelta(
        toolCallsByIndex: Map<number, IAIToolCall>,
        event: Extract<RawMessageStreamEvent, { type: 'content_block_delta' }>
    ) {
        const delta = event.delta as { type?: string; partial_json?: string };
        if (delta.type !== 'input_json_delta') {
            return;
        }

        const existing = toolCallsByIndex.get(event.index) || {
            id: `call_${event.index + 1}`,
            type: 'function' as const,
            function: {
                name: '',
                arguments: '',
            },
        };

        if (existing.function.arguments === '{}') {
            existing.function.arguments = '';
        }

        existing.function.arguments += delta.partial_json || '';
        toolCallsByIndex.set(event.index, existing);
    }

    private toSortedToolCalls(
        toolCallsByIndex: Map<number, IAIToolCall>
    ): IAIToolCall[] {
        return [...toolCallsByIndex.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, toolCall]) => toolCall);
    }

    private extractTextFromEvent(event: RawMessageStreamEvent): string | null {
        if (event.type !== 'content_block_delta') {
            return null;
        }

        const delta = event.delta as { type?: string; text?: string };
        const hasTextChunk =
            typeof delta.text === 'string' &&
            (delta.type === undefined || delta.type === 'text_delta');
        if (hasTextChunk) {
            return delta.text as string;
        }

        return null;
    }

    private processStreamEvent({
        event,
        toolCallsByIndex,
    }: {
        event: RawMessageStreamEvent;
        toolCallsByIndex: Map<number, IAIToolCall>;
    }): string | null {
        if (event.type === 'content_block_start') {
            this.appendToolUseStart(toolCallsByIndex, event);
        }

        if (event.type === 'content_block_delta') {
            this.appendToolUseDelta(toolCallsByIndex, event);
        }

        return this.extractTextFromEvent(event);
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

    private buildRequestOptions(
        options?: AnthropicRequestOptions
    ): ReturnType<AnthropicHandler['mapOptions']> {
        return this.mapOptions(options);
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

    private buildToolsRequestOptions(params: IAIProvidersToolsExecuteParams): {
        options: ReturnType<AnthropicHandler['mapOptions']>;
        tools?: ToolUnion[];
        toolChoice?: ToolChoice;
    } {
        this.assertNoToolConfigInOptions(params.options);

        return {
            options: this.mapOptions(params.options),
            tools: this.mapTools(params.tools),
            toolChoice:
                params.tool_choice !== undefined
                    ? this.mapToolChoice(params.tool_choice)
                    : undefined,
        };
    }

    private async executeAnthropicGeneration({
        params,
        client,
        onProgress,
        abortController,
    }: {
        params: IAIProvidersExecuteParams;
        client: Anthropic;
        onProgress?: (chunk: string, accumulated: string) => void;
        abortController?: AbortController;
    }): Promise<IAIAssistantToolMessage> {
        const { messages, system } = this.buildPayload(params);
        const options = this.buildRequestOptions(params.options);

        logger.debug('Sending chat request to Anthropic');

        const stream = await client.messages.create(
            {
                ...options,
                model: params.provider.model || '',
                messages,
                system,
                stream: true,
            },
            { signal: abortController?.signal }
        );

        let fullText = '';
        const toolCallsByIndex = new Map<number, IAIToolCall>();

        const iterable =
            stream as unknown as AsyncIterable<RawMessageStreamEvent>;
        for await (const event of iterable) {
            this.ensureNotAborted(abortController);
            const textChunk = this.processStreamEvent({
                event,
                toolCallsByIndex,
            });
            if (!textChunk) continue;
            fullText += textChunk;
            if (onProgress) {
                onProgress(textChunk, fullText);
            }
        }

        const assistantMessage: IAIAssistantToolMessage = {
            role: 'assistant',
            content: fullText || null,
        };

        const toolCalls = this.toSortedToolCalls(toolCallsByIndex);
        if (toolCalls.length > 0) {
            assistantMessage.tool_calls = toolCalls;
        }

        return assistantMessage;
    }

    private async executeAnthropicToolsGeneration({
        params,
        client,
        onProgress,
        abortController,
    }: {
        params: IAIProvidersToolsExecuteParams;
        client: Anthropic;
        onProgress?: (chunk: string, accumulated: string) => void;
        abortController?: AbortController;
    }): Promise<IAIAssistantToolMessage> {
        const { messages, system } = this.buildToolsPayload(params);
        const { options, tools, toolChoice } =
            this.buildToolsRequestOptions(params);

        logToolsRequest({
            provider: params.provider,
            messages: params.messages,
            tools: params.tools,
            toolChoice: params.tool_choice,
        });
        logger.debug('Sending tools chat request to Anthropic');

        const stream = await client.messages.create(
            {
                ...options,
                model: params.provider.model || '',
                messages,
                system,
                tools,
                tool_choice: toolChoice,
                stream: true,
            },
            { signal: abortController?.signal }
        );

        let fullText = '';
        const toolCallsByIndex = new Map<number, IAIToolCall>();
        const iterable =
            stream as unknown as AsyncIterable<RawMessageStreamEvent>;

        for await (const event of iterable) {
            this.ensureNotAborted(abortController);
            const textChunk = this.processStreamEvent({
                event,
                toolCallsByIndex,
            });
            if (!textChunk) {
                continue;
            }
            fullText += textChunk;
            onProgress?.(textChunk, fullText);
        }

        const assistantMessage: IAIAssistantToolMessage = {
            role: 'assistant',
            content: fullText || null,
        };
        const toolCalls = this.toSortedToolCalls(toolCallsByIndex);
        if (toolCalls.length > 0) {
            assistantMessage.tool_calls = toolCalls;
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
        const { abortController, onProgress } = params;

        this.ensureNotAborted(abortController);

        try {
            return await this.fetchSelector.execute(
                params.provider,
                async (fetchImpl: FetchFunction) => {
                    const client = this.getClient(params.provider, fetchImpl);
                    return this.executeAnthropicGeneration({
                        params,
                        client,
                        onProgress: (chunk, acc) => {
                            if (onProgress) {
                                onProgress(chunk, acc);
                            }
                            this.ensureNotAborted(abortController);
                        },
                        abortController,
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
        const { abortController, onProgress } = params;

        this.ensureNotAborted(abortController);

        try {
            return await this.fetchSelector.execute(
                params.provider,
                async (fetchImpl: FetchFunction) => {
                    const client = this.getClient(params.provider, fetchImpl);
                    return this.executeAnthropicToolsGeneration({
                        params,
                        client,
                        onProgress: (chunk, acc) => {
                            onProgress?.(chunk, acc);
                            this.ensureNotAborted(abortController);
                        },
                        abortController,
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
