export interface IAIProvider {
    id: string;
    name: string;
    apiKey?: string;
    url?: string;
    type: 'openai' | 'ollama';
    model?: string;
    availableModels?: string[];
}

export interface IChunkHandler {
    onData(callback: (chunk: string, accumulatedText: string) => void): void;
    onEnd(callback: (fullText: string) => void): void;
    onError(callback: (error: Error) => void): void;
    abort(): void;
}

export interface IAIProvidersService {
    version: number;
    providers: IAIProvider[];
    fetchModels: (provider: IAIProvider) => Promise<string[]>;
    embed: (params: IAIProvidersEmbedParams) => Promise<number[][]>;
    execute: (params: IAIProvidersExecuteParams) => Promise<IChunkHandler>;
    checkCompatibility: (requiredVersion: number) => void;
}

export interface IAIProvidersExecuteParams {
    prompt: string;
    systemPrompt?: string;
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
}

export interface IAIProvidersEmbedParams {
    input: string | string[];
    provider: IAIProvider;
}

export interface IAIHandler {
    fetchModels(provider: IAIProvider): Promise<string[]>;
    embed(params: IAIProvidersEmbedParams): Promise<number[][]>;
    execute(params: IAIProvidersExecuteParams): Promise<IChunkHandler>;
}

export interface IAIProvidersPluginSettings {
    providers?: IAIProvider[];
    _version: number;
    debugLogging?: boolean;
    useNativeFetch?: boolean;
} 
