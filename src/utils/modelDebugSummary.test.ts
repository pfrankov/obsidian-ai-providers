import { logToolsRequest, logToolsResponse } from './modelDebugSummary';
import { logger } from './logger';

describe('modelDebugSummary', () => {
    beforeEach(() => {
        logger.setEnabled(true);
        vi.restoreAllMocks();
    });

    it('logs summarized tools request payload', () => {
        const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});

        logToolsRequest({
            provider: {
                id: 'provider-id',
                name: 'Provider',
                type: 'openai',
                model: 'gpt-4.1',
            },
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Describe image' },
                        {
                            type: 'image_url',
                            image_url: { url: 'data:image/png;base64,abc' },
                        },
                    ],
                },
                {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                        {
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'lookup',
                                arguments: '{"q":"hello"}',
                            },
                        },
                    ],
                },
                {
                    role: 'user',
                    content: 'secondary message',
                    images: ['data:image/png;base64,abc'],
                },
            ],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'lookup',
                        parameters: { type: 'object', properties: {} },
                    },
                },
            ],
            toolChoice: 'required',
        });

        expect(debugSpy).toHaveBeenCalledWith(
            'toolsExecute request:',
            expect.objectContaining({
                provider: expect.objectContaining({ model: 'gpt-4.1' }),
                messages: expect.arrayContaining([
                    expect.objectContaining({
                        role: 'user',
                        content: expect.objectContaining({
                            kind: 'blocks',
                            imageCount: 1,
                        }),
                    }),
                    expect.objectContaining({
                        role: 'user',
                        imagesCount: 1,
                    }),
                ]),
                tools: expect.arrayContaining([
                    expect.objectContaining({
                        name: 'lookup',
                        hasParameters: true,
                    }),
                ]),
                toolChoice: 'required',
            })
        );
    });

    it('logs summarized tools response payload', () => {
        const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});

        logToolsResponse({
            provider: {
                id: 'provider-id',
                name: 'Provider',
                type: 'openai',
                model: 'gpt-4.1',
            },
            assistantMessage: {
                role: 'assistant',
                content: 'Here is the result',
                tool_calls: [
                    {
                        id: 'call_1',
                        type: 'function',
                        function: {
                            name: 'lookup',
                            arguments: '{"q":"hello"}',
                        },
                    },
                ],
            },
        });

        expect(debugSpy).toHaveBeenCalledWith(
            'toolsExecute response:',
            expect.objectContaining({
                content: 'Here is the result',
                toolCalls: [
                    expect.objectContaining({
                        name: 'lookup',
                        argumentsPreview: '{"q":"hello"}',
                    }),
                ],
            })
        );
    });
});
