import { probeModelCapabilities } from './modelCapabilityChecker';

describe('probeModelCapabilities', () => {
    it('checks all modalities and omits tool_choice for Ollama', async () => {
        const execute = vi
            .fn()
            .mockResolvedValueOnce('OK')
            .mockResolvedValueOnce('OK');
        const embed = vi.fn().mockResolvedValue([[0.1, 0.2]]);
        const toolsExecute = vi.fn().mockResolvedValue({
            role: 'assistant',
            content: null,
            tool_calls: [
                {
                    id: 'call_1',
                    type: 'function',
                    function: {
                        name: 'capability_probe',
                        arguments: '{}',
                    },
                },
            ],
        });

        const result = await probeModelCapabilities({
            aiProviders: {
                execute,
                embed,
                toolsExecute,
            } as any,
            provider: {
                id: 'ollama-id',
                name: 'Ollama',
                type: 'ollama',
                model: 'gemma',
            },
        });

        expect(result).toEqual({
            embedding: true,
            text: true,
            tools: true,
            vision: true,
        });
        expect(toolsExecute).toHaveBeenCalledWith(
            expect.objectContaining({
                tool_choice: undefined,
            })
        );
    });

    it('passes abortController to all checks', async () => {
        const execute = vi.fn().mockResolvedValue('OK');
        const embed = vi.fn().mockResolvedValue([[0.1, 0.2]]);
        const toolsExecute = vi.fn().mockResolvedValue({
            role: 'assistant',
            content: null,
            tool_calls: [
                {
                    id: 'call_1',
                    type: 'function',
                    function: {
                        name: 'capability_probe',
                        arguments: '{}',
                    },
                },
            ],
        });

        await probeModelCapabilities({
            aiProviders: {
                execute,
                embed,
                toolsExecute,
            } as any,
            provider: {
                id: 'test-id',
                name: 'Test',
                type: 'openai',
                model: 'gpt',
            },
        });

        // All calls should receive the same AbortController
        const textAbort = execute.mock.calls[0][0].abortController;
        const visionAbort = execute.mock.calls[1][0].abortController;
        const embedAbort = embed.mock.calls[0][0].abortController;
        const toolsAbort = toolsExecute.mock.calls[0][0].abortController;

        expect(textAbort).toBeInstanceOf(AbortController);
        expect(textAbort).toBe(visionAbort);
        expect(textAbort).toBe(embedAbort);
        expect(textAbort).toBe(toolsAbort);
    });

    it('marks capabilities as unsupported when requests fail or return no tool call', async () => {
        const execute = vi
            .fn()
            .mockRejectedValueOnce(new Error('text failed'))
            .mockRejectedValueOnce(new Error('vision failed'));
        const embed = vi.fn().mockRejectedValue(new Error('embed failed'));
        const toolsExecute = vi.fn().mockResolvedValue({
            role: 'assistant',
            content: 'No tools',
            tool_calls: [],
        });

        const result = await probeModelCapabilities({
            aiProviders: {
                execute,
                embed,
                toolsExecute,
            } as any,
            provider: {
                id: 'openai-id',
                name: 'OpenAI',
                type: 'openai',
                model: 'gpt',
            },
        });

        expect(result).toEqual({
            embedding: false,
            text: false,
            tools: false,
            vision: false,
        });
        expect(toolsExecute).toHaveBeenCalledWith(
            expect.objectContaining({
                tool_choice: 'required',
            })
        );
    });

    it('marks tools as unsupported when toolsExecute throws', async () => {
        const execute = vi
            .fn()
            .mockResolvedValueOnce('OK')
            .mockResolvedValueOnce('OK');
        const embed = vi.fn().mockResolvedValue([[0.1, 0.2]]);
        const toolsExecute = vi
            .fn()
            .mockRejectedValue(new Error('tool failed'));

        const result = await probeModelCapabilities({
            aiProviders: {
                execute,
                embed,
                toolsExecute,
            } as any,
            provider: {
                id: 'openai-id',
                name: 'OpenAI',
                type: 'openai',
                model: 'gpt',
            },
        });

        expect(result.tools).toBe(false);
    });
});
