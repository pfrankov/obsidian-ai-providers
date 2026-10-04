import type { IAIProvider } from '@obsidian-ai-providers/sdk';
import { OpenAIHandler } from './OpenAIHandler';
import { OllamaHandler } from './OllamaHandler';

// Keep the installed provider SDKs and parsers real; replace only HTTP.
describe('reasoning wire contract', () => {
    afterEach(() => vi.unstubAllGlobals());

    it.each(
        (
            [
                [
                    'openai',
                    'arbitrary-alpha',
                    'none',
                    { reasoning_effort: 'none' },
                ],
                [
                    'openai',
                    'arbitrary-beta',
                    'none',
                    { reasoning_effort: 'none' },
                ],
                ['openai', 'gpt-6-astra', 'high', { reasoning_effort: 'high' }],
                ['zai', 'arbitrary-alpha', 'max', { reasoning_effort: 'max' }],
                ['zai', 'arbitrary-beta', 'max', { reasoning_effort: 'max' }],
                ['openai', 'gpt-5.2', 'xhigh', { reasoning_effort: 'xhigh' }],
                ['openai', 'gpt-5', 'minimal', { reasoning_effort: 'minimal' }],
                ['openai', 'gpt-5.6-sol', 'max', { reasoning_effort: 'max' }],
                [
                    'openai',
                    'manual-deployment',
                    'medium',
                    { reasoning_effort: 'medium' },
                ],
                ['openai', 'gpt-5.2', undefined, {}],
                [
                    'openrouter',
                    'manual/model',
                    'max',
                    { reasoning: { effort: 'max' } },
                ],
                ['zai', 'glm-5.3-flash', 'low', { reasoning_effort: 'low' }],
                ['zai', 'glm-5.3-flash', undefined, {}],
                [
                    'openrouter',
                    'openai/gpt-5.2',
                    'high',
                    { reasoning: { effort: 'high' } },
                ],
                ['ollama', 'gpt-oss:20b', 'low', { think: 'low' }],
                ['ollama', 'qwen3:8b', 'false', { think: false }],
                ['ollama', 'qwen3:8b', undefined, {}],
            ] as const
        ).flatMap(row =>
            [undefined, 0, 0.2].map(
                temperature => [...row, temperature] as const
            )
        )
    )(
        'sends %s / %s / %s (%j), temperature %s for generation and tools',
        async (type, model, mode, expected, temperature) => {
            const bodies: Record<string, any>[] = [];
            const provider: IAIProvider = {
                id: 'wire-fixture',
                name: 'Synthetic',
                type,
                model,
                url: 'http://fixture.invalid',
                apiKey: 'synthetic',
                modelCapabilities: {
                    [model]: {
                        text: true,
                        tools: true,
                        vision: false,
                        embedding: false,
                        reasoningModes: mode ? [mode] : [],
                    },
                },
            };
            const fetchMock = vi
                .fn<typeof fetch>()
                .mockImplementation(async (input, init) => {
                    const url = String(input);
                    if (url.endsWith('/api/show'))
                        return new Response(
                            JSON.stringify({ model_info: { num_ctx: 4096 } })
                        );
                    bodies.push(JSON.parse(init!.body as string));
                    return type === 'ollama'
                        ? new Response(
                              JSON.stringify({
                                  model,
                                  message: {
                                      role: 'assistant',
                                      content: 'Synthetic answer',
                                  },
                                  done: true,
                              }) + '\n',
                              {
                                  headers: {
                                      'content-type': 'application/x-ndjson',
                                  },
                              }
                          )
                        : new Response(
                              'data: ' +
                                  JSON.stringify({
                                      id: 'synthetic',
                                      choices: [
                                          {
                                              index: 0,
                                              delta: {
                                                  content: 'Synthetic answer',
                                              },
                                              finish_reason: null,
                                          },
                                      ],
                                  }) +
                                  '\n\ndata: [DONE]\n\n',
                              {
                                  headers: {
                                      'content-type': 'text/event-stream',
                                  },
                              }
                          );
                });
            vi.stubGlobal('fetch', fetchMock);
            const settings = { _version: 1, useNativeFetch: true };
            const handler =
                type === 'ollama'
                    ? new OllamaHandler(settings)
                    : new OpenAIHandler(settings);
            const onProgress = vi.fn();
            const params = {
                provider,
                reasoningMode: mode,
                options: {
                    ...(temperature === undefined ? {} : { temperature }),
                    top_p: 0.8,
                    logprobs: true,
                    top_logprobs: 2,
                },
                abortController: new AbortController(),
                onProgress,
            };
            expect(
                await handler.execute({ ...params, prompt: 'Synthetic prompt' })
            ).toBe('Synthetic answer');
            expect(
                (
                    await handler.toolsExecute({
                        ...params,
                        messages: [
                            { role: 'user', content: 'Synthetic prompt' },
                        ],
                        tools: [
                            {
                                type: 'function' as const,
                                function: {
                                    name: 'synthetic',
                                    parameters: {
                                        type: 'object',
                                        properties: {},
                                    },
                                },
                            },
                        ],
                    })
                ).content
            ).toBe('Synthetic answer');
            expect(bodies).toHaveLength(2);
            for (const body of bodies) {
                expect(body).toMatchObject({
                    model,
                    stream: true,
                    ...expected,
                });
                expect(body).not.toHaveProperty('reasoningMode');
                if (!mode) {
                    expect(body).not.toHaveProperty('reasoning_effort');
                    expect(body).not.toHaveProperty('reasoning');
                    expect(body).not.toHaveProperty('think');
                }
                expect(type === 'ollama' ? body.options : body).toMatchObject(
                    params.options
                );
                expect(params.options).toEqual({
                    ...(temperature === undefined ? {} : { temperature }),
                    top_p: 0.8,
                    logprobs: true,
                    top_logprobs: 2,
                });
                expect(
                    Object.prototype.hasOwnProperty.call(
                        type === 'ollama' ? body.options : body,
                        'temperature'
                    )
                ).toBe(temperature !== undefined);
                expect(body.options || {}).not.toHaveProperty('think');
            }
            expect(onProgress).toHaveBeenCalledWith(
                'Synthetic answer',
                'Synthetic answer'
            );
        }
    );
    it.each(['execute', 'toolsExecute'] as const)(
        'surfaces endpoint sampling conflicts from %s without rewriting or retrying',
        async method => {
            const bodies: Record<string, unknown>[] = [];
            const fetchMock = vi
                .fn<typeof fetch>()
                .mockImplementation(async (_input, init) => {
                    bodies.push(JSON.parse(init!.body as string));
                    return new Response(
                        JSON.stringify({
                            error: {
                                message:
                                    'temperature is not supported with this reasoning mode',
                                type: 'invalid_request_error',
                            },
                        }),
                        {
                            status: 400,
                            headers: { 'content-type': 'application/json' },
                        }
                    );
                });
            vi.stubGlobal('fetch', fetchMock);
            const provider: IAIProvider = {
                id: 'conflict',
                name: 'Synthetic',
                type: 'openai',
                model: 'arbitrary-model',
                url: 'http://fixture.invalid',
                modelCapabilities: {
                    'arbitrary-model': {
                        text: true,
                        tools: true,
                        vision: false,
                        embedding: false,
                        reasoningModes: ['high'],
                    },
                },
            };
            const handler = new OpenAIHandler({
                _version: 1,
                useNativeFetch: true,
            });
            const params = {
                provider,
                reasoningMode: 'high',
                options: { temperature: 0.2 },
                messages: [{ role: 'user' as const, content: 'Synthetic' }],
                tools: [],
            };
            await expect(handler[method](params)).rejects.toThrow(
                'temperature is not supported'
            );
            expect(fetchMock).toHaveBeenCalledOnce();
            expect(bodies[0]).toMatchObject({
                model: 'arbitrary-model',
                temperature: 0.2,
                reasoning_effort: 'high',
            });
        }
    );
});
