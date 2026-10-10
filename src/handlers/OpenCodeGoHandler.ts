import type {
    IAIProvidersEmbedParams,
    IAIProvider,
    IAIProvidersPluginSettings,
} from '@obsidian-ai-providers/sdk';
import { version } from '../../manifest.json';
import { OpenAIHandler } from './OpenAIHandler';

/** OpenCode Go's Chat Completions endpoint only; no Responses/Messages routing. */
export class OpenCodeGoHandler extends OpenAIHandler {
    protected defaultBaseURL = 'https://opencode.ai/zen/go/v1';

    constructor(settings: IAIProvidersPluginSettings) {
        // Chromium fetch drops User-Agent; use the existing host transports.
        super({ ...settings, useNativeFetch: false });
    }

    protected getRequestHeaders({
        conversationId,
    }: {
        conversationId?: string;
    }): Record<string, string> {
        if (
            conversationId !== undefined &&
            !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
                conversationId
            )
        ) {
            throw new Error(
                'OpenCode Go conversationId must be a random UUID (crypto.randomUUID())'
            );
        }
        // Called once per logical operation, before SDK retries or transport fallback.
        return {
            'User-Agent': `obsidian-ai-providers/${version}`,
            'x-opencode-session': conversationId ?? crypto.randomUUID(),
        };
    }

    async fetchModels(_params: {
        provider: IAIProvider;
        abortController?: AbortController;
    }): Promise<string[]> {
        // /models mixes protocols without identifying each model's API type.
        throw new Error(
            'Enter a Chat Completions model ID from https://opencode.ai/docs/go/#endpoints'
        );
    }

    async embed(_params: IAIProvidersEmbedParams): Promise<number[][]> {
        throw new Error('OpenCode Go does not support embeddings');
    }
}
