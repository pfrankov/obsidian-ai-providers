import { webcrypto } from 'node:crypto';
import { App } from 'obsidian';
import { AIProvidersService } from '../AIProvidersService';
import type AIProvidersPlugin from '../main';
import type { IAIProvider } from '@obsidian-ai-providers/sdk';
import { OpenCodeGoHandler } from './OpenCodeGoHandler';
import { OpenAIHandler } from './OpenAIHandler';
import { obsidianFetch } from '../utils/obsidianFetch';
import { electronFetch } from '../utils/electronFetch';
import { version } from '../../manifest.json';

vi.mock('../utils/obsidianFetch', () => ({ obsidianFetch: vi.fn() }));
vi.mock('../utils/electronFetch', () => ({ electronFetch: vi.fn() }));

const provider: IAIProvider = {
    id: 'private-provider-id',
    name: 'OpenCode Go',
    type: 'opencode-go',
    url: 'https://opencode.ai/zen/go/v1',
    apiKey: 'test-key',
    model: 'glm-5.2',
};
const session = '8bcb81e7-37fc-4b09-bc22-4df28d26b101';
const uuid =
    /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const stream = () =>
    new Response(
        'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } }
    );

const headers = (fetch: ReturnType<typeof vi.fn>, index = 0) =>
    new Headers(fetch.mock.calls[index][1].headers);

const params = () => ({
    provider,
    prompt: 'Review this code.',
    abortController: new AbortController(),
});

beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
    vi.mocked(obsidianFetch).mockReset();
    vi.mocked(electronFetch).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('OpenCode Go Chat Completions adapter', () => {
    it('uses host transport even when native fetch is enabled, preserving User-Agent', async () => {
        const browserFetch = vi.fn().mockImplementation(async () => stream());
        vi.stubGlobal('fetch', browserFetch);
        vi.mocked(electronFetch).mockImplementation(async () => stream());
        const handler = new OpenCodeGoHandler({
            _version: 1,
            useNativeFetch: true,
        });
        await handler.execute(params());
        expect(browserFetch).not.toHaveBeenCalled();
        expect(electronFetch).toHaveBeenCalledTimes(1);
        expect(
            new Headers(vi.mocked(electronFetch).mock.calls[0][1]?.headers).get(
                'user-agent'
            )
        ).toBe(`obsidian-ai-providers/${version}`);
    });

    it('uses its own user agent and a fresh opaque session for each call', async () => {
        const fetch = vi
            .mocked(electronFetch)
            .mockImplementation(async () => stream());
        const handler = new OpenCodeGoHandler({
            _version: 1,
            useNativeFetch: true,
        });
        expect(await handler.execute(params())).toBe('OK');
        expect(await handler.execute(params())).toBe('OK');
        expect(fetch.mock.calls[0][0]).toBe(`${provider.url}/chat/completions`);
        expect(headers(fetch).get('user-agent')).toBe(
            `obsidian-ai-providers/${version}`
        );
        expect(headers(fetch).get('authorization')).toBe('Bearer test-key');
        const first = headers(fetch).get('x-opencode-session');
        expect(first).toMatch(uuid);
        expect(first).not.toBe(provider.id);
        expect(headers(fetch, 1).get('x-opencode-session')).not.toBe(first);
        const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
        expect(body.model).toBe('glm-5.2');
        expect(body).not.toHaveProperty('conversationId');
    });

    it('keeps an explicit conversation UUID across execute and toolsExecute calls', async () => {
        const fetch = vi
            .mocked(electronFetch)
            .mockImplementation(async () => stream());
        const handler = new OpenCodeGoHandler({
            _version: 1,
            useNativeFetch: true,
        });
        await handler.execute({ ...params(), conversationId: session });
        await handler.toolsExecute({
            provider,
            conversationId: session,
            messages: [{ role: 'user', content: 'Review this code.' }],
            tools: [],
        });
        expect(headers(fetch).get('x-opencode-session')).toBe(session);
        expect(headers(fetch, 1).get('x-opencode-session')).toBe(session);
        expect(headers(fetch, 1).get('user-agent')).toBe(
            `obsidian-ai-providers/${version}`
        );
    });

    it.each(['', 'notes/private.md', 'a\r\nx-injected: value'])(
        'rejects non-UUID conversation IDs before transport: %j',
        async conversationId => {
            const fetch = vi.mocked(electronFetch);
            const handler = new OpenCodeGoHandler({
                _version: 1,
                useNativeFetch: true,
            });
            await expect(
                handler.execute({ ...params(), conversationId })
            ).rejects.toThrow('conversationId must be a random UUID');
            expect(fetch).not.toHaveBeenCalled();
        }
    );

    it('keeps the generated session stable during OpenAI SDK retries', async () => {
        const fetch = vi
            .mocked(electronFetch)
            .mockResolvedValueOnce(
                new Response('{}', {
                    status: 429,
                    headers: { 'retry-after': '0' },
                })
            )
            .mockImplementation(async () => stream());
        const handler = new OpenCodeGoHandler({
            _version: 1,
            useNativeFetch: true,
        });
        await handler.execute(params());
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(headers(fetch, 1).get('x-opencode-session')).toBe(
            headers(fetch).get('x-opencode-session')
        );
    });

    it('keeps the generated session through SDK retries and transport fallback', async () => {
        const fetch = vi
            .mocked(electronFetch)
            .mockRejectedValue(new TypeError('Failed to fetch'));
        vi.mocked(obsidianFetch).mockImplementation(async () => stream());
        const handler = new OpenCodeGoHandler({
            _version: 1,
            useNativeFetch: true,
        });
        expect(await handler.execute(params())).toBe('OK');
        expect(fetch).toHaveBeenCalledTimes(3);
        const first = headers(fetch).get('x-opencode-session');
        expect(headers(fetch, 2).get('x-opencode-session')).toBe(first);
        expect(
            new Headers(vi.mocked(obsidianFetch).mock.calls[0][1]?.headers).get(
                'x-opencode-session'
            )
        ).toBe(first);
    }, 10000);

    it('uses the Go endpoint when URL is omitted and preserves service model overrides', async () => {
        const fetch = vi
            .mocked(electronFetch)
            .mockImplementation(async () => stream());
        const service = new AIProvidersService(new App(), {
            settings: { _version: 1, useNativeFetch: true },
            manifest: { version },
        } as AIProvidersPlugin);
        await service.execute({
            ...params(),
            provider: { ...provider, url: undefined },
            model: 'kimi-k2.6',
            conversationId: session,
        });
        await service.toolsExecute({
            provider,
            model: 'kimi-k2.6',
            conversationId: session,
            messages: [],
            tools: [],
        });
        expect(fetch.mock.calls[0][0]).toBe(
            'https://opencode.ai/zen/go/v1/chat/completions'
        );
        expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).model).toBe(
            'kimi-k2.6'
        );
        expect(JSON.parse(fetch.mock.calls[1][1]!.body as string).model).toBe(
            'kimi-k2.6'
        );
        expect(headers(fetch).get('x-opencode-session')).toBe(session);
        expect(headers(fetch, 1).get('x-opencode-session')).toBe(session);
        expect(provider.model).toBe('glm-5.2');
    });

    it('does not share sessions between concurrent calls', async () => {
        const fetch = vi
            .mocked(electronFetch)
            .mockImplementation(async () => stream());
        const handler = new OpenCodeGoHandler({
            _version: 1,
            useNativeFetch: true,
        });
        await Promise.all([
            handler.execute(params()),
            handler.toolsExecute({ provider, messages: [], tools: [] }),
        ]);
        expect(headers(fetch).get('x-opencode-session')).not.toBe(
            headers(fetch, 1).get('x-opencode-session')
        );
    });

    it('generates a fresh session for toolsExecute without a conversation ID', async () => {
        const fetch = vi
            .mocked(electronFetch)
            .mockImplementation(async () => stream());
        const handler = new OpenCodeGoHandler({
            _version: 1,
            useNativeFetch: true,
        });
        await handler.toolsExecute({ provider, messages: [], tools: [] });
        expect(headers(fetch).get('x-opencode-session')).toMatch(uuid);
    });

    it('rejects embeddings and untyped model discovery locally', async () => {
        const fetch = vi.mocked(electronFetch);
        const handler = new OpenCodeGoHandler({
            _version: 1,
            useNativeFetch: true,
        });
        await expect(
            handler.embed({ provider, input: 'test' })
        ).rejects.toThrow('does not support embeddings');
        await expect(handler.fetchModels({ provider })).rejects.toThrow(
            'Enter a Chat Completions model ID'
        );
        expect(fetch).not.toHaveBeenCalled();
        expect(obsidianFetch).not.toHaveBeenCalled();
    });

    it('does not add OpenCode headers or validate conversation IDs for other providers', async () => {
        const fetch = vi.fn().mockImplementation(stream);
        vi.stubGlobal('fetch', fetch);
        const handler = new OpenAIHandler({
            _version: 1,
            useNativeFetch: true,
        });
        await handler.execute({
            ...params(),
            provider: { ...provider, type: 'openai' },
            conversationId: 'ignored',
        });
        expect(headers(fetch).has('x-opencode-session')).toBe(false);
        expect(headers(fetch).get('user-agent')).not.toContain(
            'obsidian-ai-providers'
        );
    });
});
