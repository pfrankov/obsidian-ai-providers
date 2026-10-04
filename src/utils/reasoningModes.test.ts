import { getReasoningModes, reasoningRequestFields } from './reasoningModes';
import type { IAIProvider } from '@obsidian-ai-providers/sdk';

const zai: IAIProvider = {
    id: 'synthetic',
    name: 'Synthetic',
    type: 'zai',
    model: 'glm-5.3-flash',
    modelCapabilities: {
        'glm-5.3-flash': {
            text: true,
            tools: true,
            vision: false,
            embedding: false,
            reasoningModes: ['low', 'high', 'max'],
        },
    },
};

describe('native reasoning declarations', () => {
    it.each([
        [
            'openai',
            ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
        ],
        [
            'openrouter',
            ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
        ],
        ['zai', ['low', 'high', 'max']],
        ['ollama', ['true', 'false', 'low', 'medium', 'high']],
        ['ollama-openwebui', ['true', 'false', 'low', 'medium', 'high']],
        ['anthropic', []],
    ] as const)(
        'offers only the %s transport vocabulary regardless of model name',
        (type, modes) => {
            for (const model of [
                'arbitrary-alpha',
                'arbitrary-beta',
                'glm-5.3-flash',
                'gpt-oss:20b',
                'gpt-6-astra',
                'openrouter/auto',
                'openrouter/free',
            ]) {
                expect(getReasoningModes({ ...zai, type, model })).toEqual(
                    modes
                );
                for (const mode of modes) {
                    const provider: IAIProvider = {
                        ...zai,
                        type,
                        model,
                        modelCapabilities: {
                            [model]: {
                                ...zai.modelCapabilities!['glm-5.3-flash'],
                                reasoningModes: [mode],
                            },
                        },
                    };
                    const wire = reasoningRequestFields({
                        provider,
                        reasoningMode: mode,
                    });
                    const renamed = {
                        ...provider,
                        model: 'another-name',
                        modelCapabilities: {
                            'another-name': provider.modelCapabilities![model],
                        },
                    };
                    expect(
                        reasoningRequestFields({
                            provider: renamed,
                            reasoningMode: mode,
                        })
                    ).toEqual(wire);
                    expect(() =>
                        reasoningRequestFields({
                            provider: {
                                ...provider,
                                modelCapabilities: undefined,
                            },
                            reasoningMode: mode,
                        })
                    ).toThrow('not declared or supported');
                }
            }
        }
    );

    it('offers no modes without a selected model', () => {
        expect(getReasoningModes({ ...zai, model: undefined })).toEqual([]);
    });

    it('omits settings for existing consumers, even with native options', () => {
        expect(
            reasoningRequestFields({
                provider: zai,
                options: { reasoning_effort: 'high' },
            })
        ).toEqual({});
    });
    it.each(['low', 'high', 'max'])(
        'encodes Z.AI %s at the top level',
        reasoningMode => {
            expect(
                reasoningRequestFields({
                    provider: zai,
                    reasoningMode,
                    options: { temperature: 0.2 },
                })
            ).toEqual({ reasoning_effort: reasoningMode });
        }
    );
    it.each([
        ['openai', 'gpt-5.2', 'none', { reasoning_effort: 'none' }],
        [
            'openrouter',
            'openai/gpt-5.4',
            'xhigh',
            { reasoning: { effort: 'xhigh' } },
        ],
        ['ollama', 'gpt-oss:20b', 'low', { think: 'low' }],
        ['ollama', 'qwen3:8b', 'true', { think: true }],
        ['ollama-openwebui', 'qwen3:8b', 'false', { think: false }],
        [
            'openrouter',
            'openai/gpt-5.2',
            'high',
            { reasoning: { effort: 'high' } },
        ],
    ])('serializes %s / %s / %s', (type, model, reasoningMode, expected) => {
        const provider: IAIProvider = {
            ...zai,
            type: type as IAIProvider['type'],
            model,
            modelCapabilities: {
                [model]: {
                    ...zai.modelCapabilities!['glm-5.3-flash'],
                    reasoningModes: [reasoningMode],
                },
            },
        };
        expect(reasoningRequestFields({ provider, reasoningMode })).toEqual(
            expected
        );
    });
    it.each(['none', 'medium', 'off', 'invalid'])(
        'rejects invalid or undeclared mode %s',
        reasoningMode => {
            expect(() =>
                reasoningRequestFields({ provider: zai, reasoningMode })
            ).toThrow('not declared or supported');
        }
    );
    it.each([
        { ...zai, modelCapabilities: undefined },
        { ...zai, model: undefined },
        { ...zai, model: 'other' },
        { ...zai, type: 'anthropic' as const },
        {
            ...zai,
            modelCapabilities: {
                'glm-5.3-flash': {
                    ...zai.modelCapabilities!['glm-5.3-flash'],
                    reasoningModes: undefined,
                },
            },
        },
    ])('rejects stale declarations after a provider/model change', provider => {
        expect(() =>
            reasoningRequestFields({ provider, reasoningMode: 'low' })
        ).toThrow('not declared or supported');
    });
    it.each(['reasoning_effort', 'reasoning', 'think', 'thinking', 'model'])(
        'rejects conflicting %s options',
        key => {
            expect(() =>
                reasoningRequestFields({
                    provider: zai,
                    reasoningMode: 'low',
                    options: { [key]: 'synthetic' },
                })
            ).toThrow('not both');
        }
    );
});
