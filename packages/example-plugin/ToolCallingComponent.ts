import { App, Notice, Setting, TFile } from 'obsidian';
import {
    IAIProvider,
    IAIProvidersService,
    IChatMessage,
    IAIToolCall,
    IAIToolDefinition,
} from '@obsidian-ai-providers/sdk';

const DEFAULT_TOOL_PROMPT =
    'Use tools to tell me how many markdown notes are in the vault and show the first few file names.';
const MAX_TOOL_ROUNDS = 6;
const DEFAULT_NOTE_LIMIT = 5;
const DEFAULT_PREVIEW_LENGTH = 400;

type ToolResult = Record<string, unknown>;

export class ToolCallingComponent {
    private prompt = DEFAULT_TOOL_PROMPT;

    constructor(private app: App) {}

    render(
        containerEl: HTMLElement,
        aiProviders: IAIProvidersService,
        provider: IAIProvider
    ): void {
        containerEl.createEl('h3', { text: '🛠️ Tool Calling Demo' });
        containerEl
            .createEl('p', {
                text: 'Runs a small multi-step tool loop through toolsExecute() and shows the tool transcript.',
            })
            .addClass('mod-muted');

        new Setting(containerEl)
            .setName('Tool prompt')
            .setDesc('Ask something that should use vault-aware tools.')
            .addText(text => {
                text.setValue(this.prompt);
                text.setPlaceholder(DEFAULT_TOOL_PROMPT);
                text.onChange(value => {
                    this.prompt = value;
                });
                text.inputEl.style.width = '100%';
            });

        const resultEl = containerEl.createEl('div');
        resultEl.addClass('tool-demo-results');

        new Setting(containerEl)
            .setName('Run tool loop')
            .setDesc('The demo will execute local tools and feed results back.')
            .addButton(button =>
                button
                    .setButtonText('Run Tool Demo')
                    .setCta()
                    .onClick(() =>
                        this.runToolDemo({
                            aiProviders,
                            provider,
                            resultEl,
                            buttonEl: button.buttonEl,
                        })
                    )
            );
    }

    private getToolDefinitions(): IAIToolDefinition[] {
        return [
            {
                type: 'function',
                function: {
                    name: 'get_current_date',
                    description: 'Returns the current local date and time.',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            {
                type: 'function',
                function: {
                    name: 'list_markdown_notes',
                    description:
                        'Lists markdown notes currently available in the Obsidian vault.',
                    parameters: {
                        type: 'object',
                        properties: {
                            limit: {
                                type: 'number',
                                description:
                                    'Maximum number of file entries to return.',
                            },
                        },
                    },
                },
            },
            {
                type: 'function',
                function: {
                    name: 'read_note_preview',
                    description:
                        'Reads one markdown note and returns a short preview.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Vault path of the markdown file.',
                            },
                            maxChars: {
                                type: 'number',
                                description:
                                    'Maximum number of characters to include in the preview.',
                            },
                        },
                        required: ['path'],
                    },
                },
            },
        ];
    }

    private parseToolArgs(toolCall: IAIToolCall): Record<string, unknown> {
        try {
            const parsed = JSON.parse(toolCall.function.arguments);
            if (
                parsed &&
                typeof parsed === 'object' &&
                !Array.isArray(parsed)
            ) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            return {};
        }

        return {};
    }

    private getNumberArg(
        args: Record<string, unknown>,
        key: string,
        fallback: number
    ): number {
        const value = args[key];
        return typeof value === 'number' && Number.isFinite(value)
            ? value
            : fallback;
    }

    private renderMessageCard({
        containerEl,
        title,
        body,
        className,
    }: {
        containerEl: HTMLElement;
        title: string;
        body: string;
        className: string;
    }): void {
        const card = containerEl.createEl('div');
        card.addClass('tool-demo-card');
        card.addClass(className);
        card.createEl('strong', { text: title });
        card.createEl('pre', { text: body });
    }

    private getToolChoiceForRound({
        provider,
        round,
    }: {
        provider: IAIProvider;
        round: number;
    }): 'required' | 'auto' | undefined {
        if (
            provider.type === 'ollama' ||
            provider.type === 'ollama-openwebui'
        ) {
            return undefined;
        }

        return round === 0 ? 'required' : 'auto';
    }

    private async executeToolCall({
        toolCall,
    }: {
        toolCall: IAIToolCall;
    }): Promise<ToolResult> {
        const args = this.parseToolArgs(toolCall);

        if (toolCall.function.name === 'get_current_date') {
            const now = new Date();
            return {
                isoDate: now.toISOString(),
                localDateTime: now.toLocaleString(),
            };
        }

        if (toolCall.function.name === 'list_markdown_notes') {
            const limit = this.getNumberArg(args, 'limit', DEFAULT_NOTE_LIMIT);
            const files = this.app.vault.getMarkdownFiles();

            return {
                totalFiles: files.length,
                files: files.slice(0, limit).map(file => ({
                    name: file.name,
                    path: file.path,
                })),
            };
        }

        if (toolCall.function.name === 'read_note_preview') {
            const path = typeof args.path === 'string' ? args.path : '';
            const maxChars = this.getNumberArg(
                args,
                'maxChars',
                DEFAULT_PREVIEW_LENGTH
            );
            const file = this.app.vault.getAbstractFileByPath(path);

            if (!(file instanceof TFile)) {
                return { error: `File not found: ${path}` };
            }

            const content = await this.app.vault.read(file);
            return {
                name: file.name,
                path: file.path,
                preview: content.slice(0, maxChars),
                truncated: content.length > maxChars,
            };
        }

        return {
            error: `Unsupported tool: ${toolCall.function.name}`,
        };
    }

    private async runToolDemo({
        aiProviders,
        provider,
        resultEl,
        buttonEl,
    }: {
        aiProviders: IAIProvidersService;
        provider: IAIProvider;
        resultEl: HTMLElement;
        buttonEl: HTMLButtonElement;
    }): Promise<void> {
        const prompt = this.prompt.trim();
        if (!prompt) {
            new Notice('Enter a tool prompt');
            return;
        }

        resultEl.empty();
        buttonEl.disabled = true;

        try {
            const messages: IChatMessage[] = [
                { role: 'user', content: prompt },
            ];
            const tools = this.getToolDefinitions();

            for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
                const assistantMessage = await aiProviders.toolsExecute({
                    provider,
                    messages,
                    tools,
                    tool_choice: this.getToolChoiceForRound({
                        provider,
                        round,
                    }),
                });

                messages.push(assistantMessage);
                this.renderMessageCard({
                    containerEl: resultEl,
                    title: `Assistant round ${round + 1}`,
                    body:
                        assistantMessage.content ||
                        '[tool call requested without text content]',
                    className: 'tool-demo-assistant',
                });

                if (!assistantMessage.tool_calls?.length) {
                    return;
                }

                for (const toolCall of assistantMessage.tool_calls) {
                    this.renderMessageCard({
                        containerEl: resultEl,
                        title: `Tool call: ${toolCall.function.name}`,
                        body: toolCall.function.arguments || '{}',
                        className: 'tool-demo-call',
                    });

                    const toolResult = await this.executeToolCall({ toolCall });
                    const toolResultText = JSON.stringify(toolResult, null, 2);

                    messages.push({
                        role: 'tool',
                        name: toolCall.function.name,
                        tool_call_id: toolCall.id,
                        content: toolResultText,
                    });

                    this.renderMessageCard({
                        containerEl: resultEl,
                        title: `Tool result: ${toolCall.function.name}`,
                        body: toolResultText,
                        className: 'tool-demo-result',
                    });
                }
            }

            throw new Error(`Tool loop exceeded ${MAX_TOOL_ROUNDS} rounds`);
        } catch (error) {
            this.renderMessageCard({
                containerEl: resultEl,
                title: 'Tool demo error',
                body: (error as Error).message,
                className: 'tool-demo-error',
            });
        } finally {
            buttonEl.disabled = false;
        }
    }
}
