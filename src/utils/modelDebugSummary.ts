import {
    IAIAssistantToolMessage,
    IAIProvider,
    IChatMessage,
    IContentBlock,
    IAIToolCall,
    IAIToolChoice,
    IAIToolDefinition,
} from '@obsidian-ai-providers/sdk';
import { logger } from './logger';

const CONTENT_PREVIEW_LIMIT = 120;

function truncate(text: string): string {
    return text.length > CONTENT_PREVIEW_LIMIT
        ? `${text.slice(0, CONTENT_PREVIEW_LIMIT)}...`
        : text;
}

function summarizeContent(content: string | IContentBlock[] | null) {
    if (content === null) {
        return { kind: 'null', preview: '' };
    }

    if (typeof content === 'string') {
        return {
            kind: 'text',
            preview: truncate(content),
        };
    }

    const textPreview = content
        .filter((block): block is Extract<IContentBlock, { type: 'text' }> => {
            return block.type === 'text';
        })
        .map(block => block.text)
        .join('\n');
    const imageCount = content.filter(
        (block): block is Extract<IContentBlock, { type: 'image_url' }> => {
            return block.type === 'image_url';
        }
    ).length;

    return {
        kind: 'blocks',
        preview: truncate(textPreview),
        imageCount,
    };
}

function summarizeToolCalls(toolCalls?: IAIToolCall[]) {
    return (
        toolCalls?.map(toolCall => ({
            id: toolCall.id,
            name: toolCall.function.name,
            argumentsPreview: truncate(toolCall.function.arguments),
        })) || []
    );
}

function summarizeMessages(messages: IChatMessage[]) {
    return messages.map(message => ({
        role: message.role,
        name: message.name,
        toolCallId: message.tool_call_id,
        content: summarizeContent(message.content),
        imagesCount: message.images?.length || 0,
        toolCalls: summarizeToolCalls(message.tool_calls),
    }));
}

function summarizeTools(tools: IAIToolDefinition[]) {
    return tools.map(tool => ({
        name: tool.function.name,
        hasDescription: Boolean(tool.function.description),
        hasParameters: Boolean(tool.function.parameters),
        strict: tool.function.strict ?? null,
    }));
}

function summarizeProvider(provider: IAIProvider) {
    return {
        id: provider.id,
        name: provider.name,
        type: provider.type,
        model: provider.model || null,
    };
}

export function logToolsRequest(params: {
    provider: IAIProvider;
    messages: IChatMessage[];
    tools: IAIToolDefinition[];
    toolChoice?: IAIToolChoice;
}) {
    logger.debug('toolsExecute request:', {
        provider: summarizeProvider(params.provider),
        messages: summarizeMessages(params.messages),
        tools: summarizeTools(params.tools),
        toolChoice: params.toolChoice ?? null,
    });
}

export function logToolsResponse(params: {
    provider: IAIProvider;
    assistantMessage: IAIAssistantToolMessage;
}) {
    logger.debug('toolsExecute response:', {
        provider: summarizeProvider(params.provider),
        content: truncate(params.assistantMessage.content || ''),
        toolCalls: summarizeToolCalls(params.assistantMessage.tool_calls),
    });
}
