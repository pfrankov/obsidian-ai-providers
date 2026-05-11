import { App, Plugin, EventRef } from "obsidian";

export type ObsidianEvents = {
    'ai-providers-ready': () => void;
};

export type AIProviderType =
    | 'openai'
    | 'ollama'
    | 'ollama-openwebui'
    | 'gemini'
    | 'openrouter'
    | 'lmstudio'
    | 'groq'
    | 'ai302'
    | 'anthropic'
    | 'mistral'
    | 'together'
    | 'fireworks'
    | 'perplexity'
    | 'deepseek'
    | 'xai'
    | 'novita'
    | 'deepinfra'
    | 'sambanova'
    | 'cerebras'
    | 'zai';
export interface IAIProvider {
    id: string;
    name: string;
    apiKey?: string;
    url?: string;
    type: AIProviderType;
    model?: string;
    availableModels?: string[];
    modelCapabilities?: Record<string, IAIModelCapabilities>;
}

export interface IAIModelCapabilities {
    embedding: boolean;
    text: boolean;
    tools: boolean;
    vision: boolean;
}

export type IAIProvidersTextProgressCallback = (
    chunk: string,
    accumulatedText: string
) => void;

/**
 * @deprecated Use execute({... onProgress ...}) without relying on the returned handler.
 * The execute method now accepts streaming callbacks directly via params; this object remains only for backward compatibility.
 */
export interface IChunkHandler {
    onData(callback: (chunk: string, accumulatedText: string) => void): void;
    onEnd(callback: (fullText: string) => void): void;
    onError(callback: (error: Error) => void): void;
    abort(): void;
}

export interface IAIProvidersService {
    version: number;
    providers: IAIProvider[];
    /** @deprecated Pass an object: { provider, abortController? } */
    fetchModels(provider: IAIProvider): Promise<string[]>;
    fetchModels(params: { provider: IAIProvider; abortController?: AbortController }): Promise<string[]>;
    embed: (params: IAIProvidersEmbedParams) => Promise<number[][]>;
    /**
     * Execute text generation.
     * If caller supplies a real onProgress callback or AbortController -> Promise<string>.
     * If neither onProgress nor abortController provided (legacy usage) -> Promise<IChunkHandler>.
     */
    execute(
        params: IAIProvidersExecuteParams & {
            onProgress: IAIProvidersTextProgressCallback;
            abortController?: AbortController;
        }
    ): Promise<string>;
    execute(
        params: IAIProvidersExecuteParams & {
            abortController: AbortController;
            onProgress?: IAIProvidersTextProgressCallback;
        }
    ): Promise<string>;
    execute(
        params: IAIProvidersExecuteParams & {
            onProgress?: undefined;
            abortController?: undefined;
        }
    ): Promise<IChunkHandler>;
    execute(params: IAIProvidersExecuteParams): Promise<string | IChunkHandler>;
    toolsExecute: (params: IAIProvidersToolsExecuteParams) => Promise<IAIAssistantToolMessage>;
    getModelCapabilities: (params: {
        provider: IAIProvider;
        model?: string;
    }) => IAIModelCapabilities | null;
    getModels: (params: {
        provider: IAIProvider;
    }) => Record<string, IAIModelCapabilities | null>;
    checkModelCapabilities: (params: {
        provider: IAIProvider;
        model?: string;
    }) => Promise<IAIModelCapabilities>;
    checkCompatibility: (requiredVersion: number) => void;
    migrateProvider: (provider: IAIProvider) => Promise<IAIProvider | false>;
    retrieve: (params: IAIProvidersRetrievalParams) => Promise<IAIProvidersRetrievalResult[]>;
}

export interface IContentBlockText {
    type: 'text';
    text: string;
}

export interface IContentBlockImageUrl {
    type: 'image_url';
    image_url: {
        url: string;
    };
}

export type IContentBlock = IContentBlockText | IContentBlockImageUrl;

export interface IAIToolFunctionDefinition {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean | null;
}

export interface IAIToolDefinition {
    type: 'function';
    function: IAIToolFunctionDefinition;
}

export interface IAIToolChoiceNamed {
    type: 'function';
    function: {
        name: string;
    };
}

export type IAIToolChoice = 'none' | 'auto' | 'required' | IAIToolChoiceNamed;

export interface IAIToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface IAIAssistantToolMessage {
    role: 'assistant';
    content: string | null;
    tool_calls?: IAIToolCall[];
    name?: string;
}

export type IChatMessageRole =
    | 'assistant'
    | 'developer'
    | 'system'
    | 'tool'
    | 'user';

export interface IChatMessage {
    role: IChatMessageRole;
    content: string | IContentBlock[] | null;
    images?: string[];
    name?: string;
    tool_call_id?: string;
    tool_calls?: IAIToolCall[];
}

export interface IAIProvidersExecuteParamsBase {
    provider: IAIProvider;
    /** Optional model override. When set, this model is used instead of the provider's default. */
    model?: string;
    images?: string[];
    options?: {
        temperature?: number;
        max_tokens?: number;
        top_p?: number;
        frequency_penalty?: number;
        presence_penalty?: number;
        stop?: string[];
        [key: string]: any;
    };
    /** Optional AbortController to cancel execution (stream) */
    abortController?: AbortController;
    /** Optional streaming progress callback for partial chunks. The promise resolves with the final text or rejects on error/abort. */
    onProgress?: IAIProvidersTextProgressCallback;
}

export type IAIProvidersExecuteParamsWithPrompt = IAIProvidersExecuteParamsBase & {
    messages?: never;
    prompt: string;
    systemPrompt?: string;
};

export type IAIProvidersExecuteParamsWithMessages = IAIProvidersExecuteParamsBase & {
    messages: IChatMessage[];
    prompt?: never;
    systemPrompt?: never;
};

export type IAIProvidersExecuteParams = IAIProvidersExecuteParamsWithPrompt | IAIProvidersExecuteParamsWithMessages;

export type IAIProvidersToolsExecuteParams = {
    provider: IAIProvider;
    /** Optional model override. When set, this model is used instead of the provider's default. */
    model?: string;
    messages: IChatMessage[];
    tools: IAIToolDefinition[];
    tool_choice?: IAIToolChoice;
    options?: IAIProvidersExecuteParamsBase['options'];
    abortController?: AbortController;
    onProgress?: IAIProvidersTextProgressCallback;
};

export type IAIProcessingType = 'embedding';

export interface IAIProvidersEmbedParams {
    input?: string | string[];
    provider: IAIProvider;
    onProgress?: (processedEmbeddings: string[]) => void;
    abortController?: AbortController;
}

export interface IAIDocument {
    content: string;
    meta?: Record<string, any>;
}

export interface IAIProvidersRetrievalChunk {
    content: string;
    document: IAIDocument; // Reference to original document
}

export interface IAIProvidersRetrievalProgressInfo {
    totalDocuments: number;
    totalChunks: number;
    processedDocuments: IAIDocument[]; // References to processed documents
    processedChunks: IAIProvidersRetrievalChunk[]; // References to processed chunks
    processingType: IAIProcessingType;
}

export interface IAIProvidersRetrievalParams {
    query: string;
    documents: IAIDocument[];
    embeddingProvider: IAIProvider;
    onProgress?: (progress: IAIProvidersRetrievalProgressInfo) => void;
    abortController?: AbortController;
}

export interface IAIProvidersRetrievalResult {
    content: string; // Text chunk that matches the query
    score: number;   // Relevance score of the chunk
    document: IAIDocument; // Reference to original document (not a copy!)
}

export interface IAIHandler {
    fetchModels(params: { provider: IAIProvider; abortController?: AbortController }): Promise<string[]>;
    embed(params: IAIProvidersEmbedParams): Promise<number[][]>;
    execute(params: IAIProvidersExecuteParams): Promise<string>;
    toolsExecute(params: IAIProvidersToolsExecuteParams): Promise<IAIAssistantToolMessage>;
}

export interface IAIProvidersPluginSettings {
    providers?: IAIProvider[];
    _version: number;
    debugLogging?: boolean;
    debugChunkLogging?: boolean;
    useNativeFetch?: boolean;
}

export interface ExtendedApp extends App {
    aiProviders?: IAIProvidersService;
    plugins?: {
        enablePlugin: (id: string) => Promise<void>;
        disablePlugin: (id: string) => Promise<void>;
    };
    workspace: App['workspace'] & {
        on: <K extends keyof ObsidianEvents>(event: K, callback: ObsidianEvents[K]) => EventRef;
        off: <K extends keyof ObsidianEvents>(event: K, callback: ObsidianEvents[K]) => void;
    };
}

export declare function waitForAIProviders(app: ExtendedApp, plugin: Plugin): Promise<{
    promise: Promise<IAIProvidersService>;
    cancel: () => void;
}>;

export declare function initAI(app: ExtendedApp, plugin: Plugin, onDone: () => Promise<void>): Promise<void>;

export declare function waitForAI(): Promise<{
    promise: Promise<IAIProvidersService>;
    cancel: () => void;
}>;
