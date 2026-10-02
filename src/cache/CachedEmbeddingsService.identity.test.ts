import { webcrypto } from 'node:crypto';
import type { Mock } from 'vitest';
import type {
    IAIProvider,
    IAIProvidersEmbedParams,
} from '@obsidian-ai-providers/sdk';
import { CachedEmbeddingsService } from './CachedEmbeddingsService';
import { embeddingsCache, type EmbeddingsCacheItem } from './EmbeddingsCache';
import { logger } from '../utils/logger';

vi.mock('./EmbeddingsCache');
vi.mock('../utils/logger');

describe('embedding cache identity', () => {
    let provider: IAIProvider;
    let records: Map<string, EmbeddingsCacheItem>;
    let embed: Mock;
    let service: CachedEmbeddingsService;

    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubGlobal('crypto', webcrypto);
        provider = {
            id: 'provider',
            name: 'Synthetic provider',
            type: 'openai',
            url: 'https://example.invalid/v1?route=one',
            apiKey: 'synthetic-token-one',
            model: 'model',
        };
        records = new Map();
        (embeddingsCache.getEmbeddings as Mock).mockImplementation(async key =>
            structuredClone(records.get(key))
        );
        (embeddingsCache.setEmbeddings as Mock).mockImplementation(
            async (key, value) => {
                records.set(key, structuredClone(value));
            }
        );
        embed = vi.fn(async (params: IAIProvidersEmbedParams) =>
            (params.input as string[]).map(() => [embed.mock.calls.length, 0])
        );
        service = new CachedEmbeddingsService(embed);
    });

    afterEach(() => vi.unstubAllGlobals());

    async function request(selected = provider, chunks = ['text']) {
        return service.embedWithCache({
            provider: selected,
            input: chunks,
            chunks,
        });
    }

    it.each([
        ['id', 'other-provider'],
        ['type', 'ollama'],
        ['model', 'other-model'],
        ['url', 'https://other.invalid/v1?route=one'],
        ['url', 'https://example.invalid/v2?route=one'],
        ['url', 'https://example.invalid/v1?route=two'],
        ['url', 'https://example.invalid/v1?route=one#other'],
        ['url', 'https://example.invalid/v1/?route=one'],
    ])('misses when %s changes to %s', async (field, value) => {
        expect(await request()).toEqual([[1, 0]]);
        const changed = { ...provider, [field]: value } as IAIProvider;
        expect(await request(changed)).toEqual([[2, 0]]);
        expect(embed).toHaveBeenCalledTimes(2);
        expect(await request()).toEqual([[1, 0]]);
        expect(records.size).toBe(2);
    });

    it('preserves hits across renaming and API-key rotation', async () => {
        await request();
        expect(
            await request({
                ...provider,
                name: 'Renamed',
                apiKey: 'synthetic-token-two',
            })
        ).toEqual([[1, 0]]);
        expect(embed).toHaveBeenCalledTimes(1);
    });

    it('shares missing and empty URL fallback but keeps explicit URLs separate', async () => {
        const withoutURL = { ...provider };
        delete withoutURL.url;
        await request(withoutURL);
        expect(await request({ ...provider, url: '' })).toEqual([[1, 0]]);
        expect(await request()).toEqual([[2, 0]]);
        expect(embed).toHaveBeenCalledTimes(2);
    });

    it('uses an unambiguous tuple and hashes the entire endpoint without persisting credentials', async () => {
        provider.url =
            'https://synthetic-user:synthetic-password@example.invalid/v1?token=synthetic-query';
        await request({ ...provider, id: 'a:b', model: 'c' });
        await request({ ...provider, id: 'a', model: 'b:c' });
        const keys = [...records.keys()];
        expect(keys).toHaveLength(2);
        expect(keys[0]).not.toBe(keys[1]);
        keys.forEach(key => expect(key).toMatch(/^embed:v2:[a-f0-9]{64}$/));
        const persisted = JSON.stringify([...records]);
        expect(persisted).not.toContain(provider.url);
        expect(persisted).not.toContain(provider.apiKey);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('ignores and retains legacy records instead of assigning them current provenance', async () => {
        const legacyKey = `embed:${provider.id}:${provider.model}`;
        const legacy = {
            providerId: provider.id,
            providerModel: provider.model!,
            chunks: [{ content: 'text', embedding: [-1, 0] }],
        };
        records.set(legacyKey, legacy);
        expect(await request()).toEqual([[1, 0]]);
        expect(records.get(legacyKey)).toEqual(legacy);
        expect(records.size).toBe(2);
        expect(await request()).toEqual([[1, 0]]);
    });

    it.each(['hash', 'read', 'provider'])(
        'snapshots provider before mutation during %s',
        async stage => {
            const original = { ...provider };
            const mutate = () => {
                Object.assign(provider, {
                    id: 'changed',
                    type: 'ollama',
                    url: 'https://changed.invalid',
                    model: 'changed-model',
                    apiKey: 'changed-token',
                });
            };
            if (stage === 'hash') {
                vi.stubGlobal('crypto', {
                    subtle: {
                        digest: async (
                            ...args: Parameters<typeof webcrypto.subtle.digest>
                        ) => {
                            mutate();
                            return webcrypto.subtle.digest(...args);
                        },
                    },
                });
            } else if (stage === 'read') {
                (embeddingsCache.getEmbeddings as Mock).mockImplementationOnce(
                    async () => {
                        mutate();
                        return undefined;
                    }
                );
            } else {
                embed.mockImplementationOnce(async () => {
                    mutate();
                    return [[1, 0]];
                });
            }
            expect(await request()).toEqual([[1, 0]]);
            expect(embed.mock.calls[0][0].provider).toEqual(original);
            expect([...records.values()][0]).toMatchObject({
                providerId: original.id,
                providerModel: original.model,
            });
            vi.stubGlobal('crypto', webcrypto);
            expect(await request(original)).toEqual([[1, 0]]);
            expect(embed).toHaveBeenCalledTimes(1);
            expect(await request(provider)).toEqual([[2, 0]]);
        }
    );

    it('submits only new additions so a stale hit cannot replace a newer cached value', async () => {
        await request(provider, ['cached']);
        const [key, original] = [...records][0];
        embed.mockImplementationOnce(async () => {
            records.set(key, {
                ...original,
                chunks: [{ content: 'cached', embedding: [9, 9] }],
            });
            return [[2, 0]];
        });
        (embeddingsCache.setEmbeddings as Mock).mockImplementation(
            async (cacheKey, value) => {
                const latest = new Map(
                    records
                        .get(cacheKey)!
                        .chunks.map(chunk => [chunk.content, chunk])
                );
                value.chunks.forEach(
                    (chunk: EmbeddingsCacheItem['chunks'][number]) =>
                        latest.set(chunk.content, chunk)
                );
                records.set(cacheKey, {
                    ...value,
                    chunks: [...latest.values()],
                });
            }
        );
        expect(await request(provider, ['cached', 'new'])).toEqual([
            [1, 0],
            [2, 0],
        ]);
        expect(
            (embeddingsCache.setEmbeddings as Mock).mock.lastCall![1].chunks
        ).toEqual([{ content: 'new', embedding: [2, 0] }]);
        expect(await request(provider, ['cached', 'new'])).toEqual([
            [9, 9],
            [2, 0],
        ]);
    });

    it.each(['reject', 'absent'])(
        'keeps deduplication and progress with %s crypto and skips all cache work',
        async failure => {
            vi.stubGlobal(
                'crypto',
                failure === 'absent'
                    ? undefined
                    : {
                          subtle: {
                              digest: vi
                                  .fn()
                                  .mockRejectedValue(new Error('hash failed')),
                          },
                      }
            );
            const chunks = ['first', 'later', 'first'];
            const onProgress = vi.fn();
            embed.mockImplementationOnce(
                async (params: IAIProvidersEmbedParams) => {
                    params.onProgress?.(['later']);
                    return [
                        [1, 0],
                        [0, 1],
                    ];
                }
            );
            expect(
                await service.embedWithCache({
                    provider,
                    input: chunks,
                    chunks,
                    onProgress,
                })
            ).toEqual([
                [1, 0],
                [0, 1],
                [1, 0],
            ]);
            expect(embed.mock.calls[0][0].input).toEqual(['first', 'later']);
            expect(onProgress.mock.calls).toEqual([[['later']], [chunks]]);
            expect(embeddingsCache.getEmbeddings).not.toHaveBeenCalled();
            expect(embeddingsCache.setEmbeddings).not.toHaveBeenCalled();
        }
    );

    it.each(['hash', 'provider', 'progress'])(
        'keeps cancellation during %s when hashing fails',
        async stage => {
            const abortController = new AbortController();
            const onProgress = vi.fn(() => {
                if (stage === 'progress') abortController.abort();
            });
            vi.stubGlobal('crypto', {
                subtle: {
                    digest: async () => {
                        if (stage === 'hash') abortController.abort();
                        throw new Error('hash failed');
                    },
                },
            });
            embed.mockImplementationOnce(async () => {
                if (stage === 'provider') abortController.abort();
                return [[1, 0]];
            });
            await expect(
                service.embedWithCache({
                    provider,
                    input: ['text'],
                    chunks: ['text'],
                    abortController,
                    onProgress,
                })
            ).rejects.toThrow('Aborted');
            expect(embeddingsCache.getEmbeddings).not.toHaveBeenCalled();
            expect(embeddingsCache.setEmbeddings).not.toHaveBeenCalled();
            expect(onProgress).toHaveBeenCalledTimes(
                stage === 'progress' ? 1 : 0
            );
            expect(embed).toHaveBeenCalledTimes(stage === 'hash' ? 0 : 1);
        }
    );
});
