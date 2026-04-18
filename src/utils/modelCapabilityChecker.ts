import {
    IAIModelCapabilities,
    IAIProvider,
    IAIProvidersService,
} from '@obsidian-ai-providers/sdk';

// 4x4 red pixel RGB PNG – avoids "zlib: invalid checksum" errors seen with
// minimal 1x1 grayscale+alpha PNGs on some Ollama vision models.
const CAPABILITY_CHECK_IMAGE =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR42mP4z8AARwzEcQCukw/xOF6MEQAAAABJRU5ErkJggg==';

const TOOL_DEFINITION = {
    type: 'function' as const,
    function: {
        name: 'capability_probe',
        description: 'A minimal probe tool for capability checks.',
        parameters: {
            type: 'object',
            properties: {},
        },
    },
};

async function checkTextCapability(
    aiProviders: IAIProvidersService,
    provider: IAIProvider,
    abortController: AbortController
): Promise<boolean> {
    try {
        await aiProviders.execute({
            provider,
            abortController,
            messages: [
                {
                    role: 'user',
                    content: 'Reply with OK.',
                },
            ],
        });
        return true;
    } catch {
        return false;
    }
}

async function checkEmbeddingCapability(
    aiProviders: IAIProvidersService,
    provider: IAIProvider,
    abortController: AbortController
): Promise<boolean> {
    try {
        await aiProviders.embed({
            provider,
            abortController,
            input: 'capability check',
        });
        return true;
    } catch {
        return false;
    }
}

async function checkToolsCapability(
    aiProviders: IAIProvidersService,
    provider: IAIProvider,
    abortController: AbortController
): Promise<boolean> {
    try {
        const toolChoice =
            provider.type === 'ollama' || provider.type === 'ollama-openwebui'
                ? undefined
                : 'required';
        const result = await aiProviders.toolsExecute({
            provider,
            abortController,
            messages: [
                {
                    role: 'user',
                    content: 'Call the capability_probe tool.',
                },
            ],
            tools: [TOOL_DEFINITION],
            tool_choice: toolChoice,
        });

        return Boolean(
            result.tool_calls?.some(
                toolCall => toolCall.function.name === 'capability_probe'
            )
        );
    } catch {
        return false;
    }
}

async function checkVisionCapability(
    aiProviders: IAIProvidersService,
    provider: IAIProvider,
    abortController: AbortController
): Promise<boolean> {
    try {
        await aiProviders.execute({
            provider,
            abortController,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Reply with OK if you can process the image.',
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: CAPABILITY_CHECK_IMAGE,
                            },
                        },
                    ],
                },
            ],
        });
        return true;
    } catch {
        return false;
    }
}

export async function probeModelCapabilities({
    aiProviders,
    provider,
}: {
    aiProviders: IAIProvidersService;
    provider: IAIProvider;
}): Promise<IAIModelCapabilities> {
    const abortController = new AbortController();

    const [text, embedding, tools, vision] = await Promise.all([
        checkTextCapability(aiProviders, provider, abortController),
        checkEmbeddingCapability(aiProviders, provider, abortController),
        checkToolsCapability(aiProviders, provider, abortController),
        checkVisionCapability(aiProviders, provider, abortController),
    ]);

    return {
        embedding,
        text,
        tools,
        vision,
    };
}
