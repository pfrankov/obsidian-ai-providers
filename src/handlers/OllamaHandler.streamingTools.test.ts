import type {
    IAIProvider,
    IAIProvidersToolsExecuteParams,
} from '@obsidian-ai-providers/sdk';
import { OllamaHandler } from './OllamaHandler';

const provider: IAIProvider = {
    id: 'ollama-stream-test',
    name: 'Ollama stream test',
    type: 'ollama',
    url: 'http://localhost:11434',
    model: 'test-model',
};
const params: IAIProvidersToolsExecuteParams = {
    provider,
    messages: [{ role: 'user', content: 'Look up the weather' }],
    tools: [
        {
            type: 'function',
            function: {
                name: 'lookup',
                parameters: { type: 'object', properties: {} },
            },
        },
    ],
};

function callFor(city: string) {
    return { function: { name: 'lookup', arguments: { city } } };
}

function expectedCalls(cities: string[]) {
    return cities.map((city, index) => ({
        id: `call_${index + 1}`,
        type: 'function',
        function: { name: 'lookup', arguments: JSON.stringify({ city }) },
    }));
}

// Use the installed Ollama SDK and real Web Streams. Only fetch is replaced,
// so no provider is contacted and NDJSON parsing stays part of the regression.
function createStreamTest(chunks: Record<string, unknown>[], byteSize = 17) {
    const bytes = new TextEncoder().encode(
        [...chunks, { done: true }]
            .map(chunk => JSON.stringify(chunk))
            .join('\n') + '\n'
    );
    const response = new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                for (
                    let offset = 0;
                    offset < bytes.length;
                    offset += byteSize
                ) {
                    controller.enqueue(bytes.slice(offset, offset + byteSize));
                }
                controller.close();
            },
        }),
        { headers: { 'content-type': 'application/x-ndjson' } }
    );
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async input => {
        if (input === `${provider.url}/api/show`) {
            return new Response(
                JSON.stringify({ model_info: { num_ctx: 4096 } })
            );
        }
        if (input === `${provider.url}/api/chat`) {
            return response;
        }
        throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const handler = new OllamaHandler({ _version: 1, useNativeFetch: true });
    return { handler, fetchMock };
}

describe('Ollama streamed tool calls', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each([
        {
            name: 'one call per chunk, including repeated function names',
            batches: [['London'], ['Paris']],
        },
        {
            name: 'different batch sizes without overwriting or reordering',
            batches: [['London', 'Paris'], ['Berlin'], ['Tokyo', 'Madrid']],
        },
        {
            name: 'identical calls within and across chunks',
            batches: [['London', 'London'], ['London']],
        },
    ])('preserves $name', async ({ batches }) => {
        const { handler } = createStreamTest(
            batches.map(cities => ({
                message: { tool_calls: cities.map(callFor) },
            }))
        );

        const message = await handler.toolsExecute(params);

        expect(message).toEqual({
            role: 'assistant',
            content: null,
            tool_calls: expectedCalls(batches.flat()),
        });
    });

    it('uses arrival order and fresh local IDs even when wire IDs or indexes repeat', async () => {
        const { handler } = createStreamTest([
            {
                message: {
                    tool_calls: [
                        {
                            id: 'wire-id',
                            function: {
                                ...callFor('London').function,
                                index: 9,
                            },
                        },
                        callFor('Paris'),
                    ],
                },
            },
            {
                message: {
                    tool_calls: [
                        {
                            id: 'wire-id',
                            function: {
                                ...callFor('Berlin').function,
                                index: 0,
                            },
                        },
                        {
                            id: 'another-id',
                            function: {
                                ...callFor('Tokyo').function,
                                index: 0,
                            },
                        },
                    ],
                },
            },
        ]);

        const message = await handler.toolsExecute(params);

        expect(message.tool_calls).toEqual(
            expectedCalls(['London', 'Paris', 'Berlin', 'Tokyo'])
        );
    });

    it.each([1, 7, 65536])(
        'preserves interleaved content and calls with %i-byte transport chunks',
        async byteSize => {
            const { handler, fetchMock } = createStreamTest(
                [
                    {},
                    { message: { thinking: 'Internal reasoning' } },
                    { message: { content: 'Checking ', tool_calls: [] } },
                    { message: { tool_calls: [callFor('São Paulo')] } },
                    { message: {} },
                    {
                        message: {
                            content: 'weather ☀',
                            tool_calls: [callFor('Paris'), callFor('Berlin')],
                        },
                        done: true,
                    },
                ],
                byteSize
            );
            const onProgress = vi.fn();
            const options = { temperature: 0.2, num_ctx: 1024 };

            const message = await handler.toolsExecute({
                ...params,
                options,
                onProgress,
            });

            expect(message).toEqual({
                role: 'assistant',
                content: 'Checking weather ☀',
                tool_calls: expectedCalls(['São Paulo', 'Paris', 'Berlin']),
            });
            expect(onProgress.mock.calls).toEqual([
                ['Checking ', 'Checking '],
                ['weather ☀', 'Checking weather ☀'],
            ]);
            expect(fetchMock).toHaveBeenCalledTimes(2);
            const request = JSON.parse(
                fetchMock.mock.calls[1][1]!.body as string
            );
            expect(request).toMatchObject({
                model: provider.model,
                tools: params.tools,
                stream: true,
                options,
            });
            expect(options).toEqual({ temperature: 0.2, num_ctx: 1024 });
        }
    );

    it.each([
        { content: 'Text only', expected: 'Text only' },
        { content: '', expected: null },
    ])(
        'omits tool_calls when there are none ($expected)',
        async ({ content, expected }) => {
            const { handler } = createStreamTest([
                {},
                { message: {} },
                { message: { content, tool_calls: [] } },
            ]);

            expect(await handler.toolsExecute(params)).toEqual({
                role: 'assistant',
                content: expected,
            });
        }
    );

    it('normalizes each complete call independently without carrying over a previous name', async () => {
        const { handler } = createStreamTest([
            { message: { tool_calls: [callFor('London')] } },
            { message: { tool_calls: [{ function: { arguments: 'raw' } }] } },
            { message: { tool_calls: [{ function: { name: 42 } }] } },
        ]);

        const message = await handler.toolsExecute(params);

        expect(message.tool_calls).toEqual([
            ...expectedCalls(['London']),
            {
                id: 'call_2',
                type: 'function',
                function: { name: '', arguments: 'raw' },
            },
            {
                id: 'call_3',
                type: 'function',
                function: { name: '', arguments: '{}' },
            },
        ]);
    });

    it('rejects a stream error after a complete call instead of returning partial calls', async () => {
        const { handler } = createStreamTest([
            { message: { tool_calls: [callFor('London')] } },
            { error: 'Generation failed' },
        ]);

        await expect(handler.toolsExecute(params)).rejects.toThrow(
            'Generation failed'
        );
    });

    it('honors cancellation from progress after a tool call', async () => {
        const { handler, fetchMock } = createStreamTest([
            { message: { tool_calls: [callFor('London')] } },
            { message: { content: 'Partial' } },
            { message: { tool_calls: [callFor('Paris')] } },
        ]);
        const abortController = new AbortController();

        await expect(
            handler.toolsExecute({
                ...params,
                abortController,
                onProgress: () => abortController.abort(),
            })
        ).rejects.toThrow('Aborted');
        expect(fetchMock.mock.calls[1][1]!.signal!.aborted).toBe(true);
    });
});
