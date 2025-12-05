import { App, Plugin, EventRef } from "obsidian";

export type ObsidianEvents = {
    'ai-providers-ready': () => void;
};

export type AIProviderType = 'openai' | 'ollama' | 'ollama-openwebui' | 'gemini' | 'openrouter' | 'lmstudio' | 'groq' | 'ai302' | 'anthropic';
export interface IAIProvider {
    id: string;
    name: string;
    apiKey?: string;
    url?: string;
    type: AIProviderType;
    model?: string;
    availableModels?: string[];
}

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
     * If caller supplies onProgress or abortController (stream-style usage) -> Promise<string>.
     * If neither onProgress nor abortController provided (legacy usage) -> Promise<IChunkHandler>.
     */
    execute(
        params: IAIProvidersExecuteParams &
            ({ onProgress?: (chunk: string, accumulatedText: string) => void } | { abortController?: AbortController })
    ): Promise<string>;
    execute(
        params: IAIProvidersExecuteParams & { onProgress?: undefined; abortController?: undefined }
    ): Promise<IChunkHandler>;
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

export interface IChatMessage {
    role: string;
    content: string | IContentBlock[];
    images?: string[];
}

export interface IAIProvidersExecuteParamsBase {
    provider: IAIProvider;
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
    onProgress?: (chunk: string, accumulatedText: string) => void;
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
}

export interface IAIProvidersPluginSettings {
    providers?: IAIProvider[];
    _version: number;
    debugLogging?: boolean;
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
