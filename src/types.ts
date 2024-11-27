export interface IAIProvider {
    id: string;
    name: string;
    apiKey: string;
    url: string;
    type: 'openai' | 'ollama';
    model?: {
        id: string;
    };
    availableModels?: string[];
}

export interface IChunkHandler {
    onData(callback: (chunk: string, accumulatedText: string) => void): void;
    onEnd(callback: (fullText: string) => void): void;
    onError(callback: (error: Error) => void): void;
    abort(): void;
}

export interface IAIProvidersService {
    providers: IAIProvider[];
    fetchModels: (provider: IAIProvider) => Promise<string[]>;
    execute: (params: IAIProvidersExecuteParams) => Promise<IChunkHandler>;
}

export interface IAIProvidersExecuteParams {
    prompt: string;
    systemPrompt?: string;
    provider: IAIProvider;
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

export interface IAIHandler {
    fetchModels(provider: IAIProvider): Promise<string[]>;
    execute(params: IAIProvidersExecuteParams): Promise<IChunkHandler>;
} 