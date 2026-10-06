import type {
    AIProviderType,
    IAIProvider,
    IAIProvidersExecuteParams,
} from '@obsidian-ai-providers/sdk';

// Adapter vocabulary only. Saved per-model declarations determine availability;
// neither model names nor this list establish remote model support.
const EFFORT_MODES = [
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
];

/** Wire vocabulary offered by an adapter, independent of model selection. */
export function getAdapterReasoningVocabulary(
    type: AIProviderType | IAIProvider['type']
): string[] {
    switch (type) {
        case 'openai':
        case 'openrouter':
            return EFFORT_MODES;
        case 'zai':
            return ['low', 'high', 'max'];
        case 'ollama':
        case 'ollama-openwebui':
            return ['true', 'false', 'low', 'medium', 'high'];
        default:
            return [];
    }
}

export function getReasoningModes(provider: IAIProvider): string[] {
    if (!provider.model) return [];
    return getAdapterReasoningVocabulary(provider.type);
}

/** Resolve only an explicitly selected, manually declared native mode. */
export function reasoningRequestFields(
    params: Pick<
        IAIProvidersExecuteParams,
        'provider' | 'reasoningMode' | 'options'
    >
): {
    reasoning_effort?: string;
    reasoning?: { effort: string };
    think?: boolean | 'low' | 'medium' | 'high';
} {
    const { provider, reasoningMode, options } = params;
    if (reasoningMode === undefined) return {};
    const declared =
        provider.modelCapabilities?.[provider.model || '']?.reasoningModes;
    if (
        !declared?.includes(reasoningMode) ||
        !getReasoningModes(provider).includes(reasoningMode)
    ) {
        throw new Error(
            'Reasoning mode is not declared or supported for this provider and model'
        );
    }
    if (
        options &&
        ['reasoning_effort', 'reasoning', 'think', 'thinking', 'model'].some(
            key => key in options
        )
    ) {
        throw new Error(
            'Pass reasoningMode or native reasoning options, not both'
        );
    }
    switch (provider.type) {
        case 'openai':
        case 'zai':
            return { reasoning_effort: reasoningMode };
        case 'openrouter':
            return { reasoning: { effort: reasoningMode } };
        default:
            return {
                think:
                    reasoningMode === 'true' ||
                    (reasoningMode !== 'false' &&
                        (reasoningMode as 'low' | 'medium' | 'high')),
            };
    }
}
