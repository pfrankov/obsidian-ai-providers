import type { Mock } from 'vitest';
import { EmbeddingsCache, EmbeddingsCacheItem } from './EmbeddingsCache';
import { openDB } from 'idb';

// Mock idb
vi.mock('idb');

describe('EmbeddingsCache', () => {
    let cache: EmbeddingsCache;
    let mockDb: any;
    let mockTransaction: {
        store: { get: Mock; put: Mock };
        done: Promise<void>;
    };

    const additions: EmbeddingsCacheItem = {
        providerId: 'test-provider',
        providerModel: 'test-model',
        chunks: [{ content: 'new', embedding: [0.4, 0.5, 0.6] }],
    };

    beforeEach(() => {
        // Reset singleton instance
        (EmbeddingsCache as any).instance = null;
        cache = EmbeddingsCache.getInstance();

        mockTransaction = {
            store: {
                get: vi.fn().mockResolvedValue(undefined),
                put: vi.fn().mockResolvedValue('test-key'),
            },
            done: Promise.resolve(),
        };

        // Keep direct database operations separate from transaction operations.
        mockDb = {
            transaction: vi.fn(() => mockTransaction),
            get: vi.fn(),
            put: vi.fn(),
            clear: vi.fn(),
            close: vi.fn(),
        };

        (openDB as Mock).mockResolvedValue(mockDb);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should return the same instance', () => {
        const instance1 = EmbeddingsCache.getInstance();
        const instance2 = EmbeddingsCache.getInstance();
        expect(instance1).toBe(instance2);
    });

    it('should initialize database with vault ID', async () => {
        const createObjectStore = vi.fn();
        (openDB as Mock).mockImplementationOnce(
            async (_name, _version, opts) => {
                opts.upgrade({ createObjectStore });
                return mockDb;
            }
        );

        await cache.init('test-vault-id');

        expect(openDB).toHaveBeenCalledWith(
            expect.stringMatching(/^aiProviders_[a-z0-9]+_test-vault-id$/),
            1,
            expect.any(Object)
        );
        expect(createObjectStore).toHaveBeenCalledWith('embeddings');
    });

    it('should skip reinitialization for the same vault', async () => {
        await cache.init('test-vault');
        await cache.init('test-vault');

        expect(openDB).toHaveBeenCalledTimes(1);
    });

    it('should close and reinitialize when vault changes', async () => {
        await cache.init('vault-a');
        await cache.init('vault-b');

        expect(mockDb.close).toHaveBeenCalled();
        expect(openDB).toHaveBeenCalledTimes(2);
    });

    it('handles init failures without throwing', async () => {
        (openDB as Mock).mockRejectedValueOnce(new Error('boom'));
        await cache.init('bad-vault');
        expect(cache.isInitialized()).toBe(false);
    });

    it('should get embeddings', async () => {
        await cache.init('test-vault');

        const mockCacheItem = {
            providerId: 'test-provider',
            providerModel: 'test-model',
            chunks: [{ content: 'test', embedding: [0.1, 0.2, 0.3] }],
        };
        mockDb.get.mockResolvedValue(mockCacheItem);

        const result = await cache.getEmbeddings('test-key');
        expect(mockDb.get).toHaveBeenCalledWith('embeddings', 'test-key');
        expect(result).toEqual(mockCacheItem);
    });

    it('returns undefined when cache is not initialized', async () => {
        const result = await cache.getEmbeddings('test-key');
        expect(result).toBeUndefined();
    });

    it('returns early when clearing embeddings without db', async () => {
        await cache.clearEmbeddings();
        expect(mockDb.clear).not.toHaveBeenCalled();
    });

    it('returns undefined when getEmbeddings fails', async () => {
        await cache.init('test-vault');
        mockDb.get.mockRejectedValueOnce(new Error('read error'));
        const result = await cache.getEmbeddings('test-key');
        expect(result).toBeUndefined();
    });

    it('ignores setEmbeddings when cache is not initialized', async () => {
        await cache.setEmbeddings('test-key', {
            providerId: 'test',
            providerModel: 'model',
            chunks: [],
        });
        expect(mockDb.put).not.toHaveBeenCalled();
        expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    describe('atomic setEmbeddings', () => {
        beforeEach(async () => {
            await cache.init('test-vault');
        });

        it('writes additions when no previous record exists', async () => {
            await cache.setEmbeddings('test-key', additions);

            expect(mockDb.transaction).toHaveBeenCalledExactlyOnceWith(
                'embeddings',
                'readwrite'
            );
            expect(mockTransaction.store.get).toHaveBeenCalledExactlyOnceWith(
                'test-key'
            );
            expect(mockTransaction.store.put).toHaveBeenCalledExactlyOnceWith(
                additions,
                'test-key'
            );
            expect(mockDb.get).not.toHaveBeenCalled();
            expect(mockDb.put).not.toHaveBeenCalled();
        });

        it('merges the latest stored chunks with additions inside one transaction', async () => {
            const stored = {
                ...additions,
                chunks: [{ content: 'existing', embedding: [0.1, 0.2, 0.3] }],
            };
            mockTransaction.store.get.mockResolvedValue(stored);

            await cache.setEmbeddings('test-key', additions);

            expect(mockDb.transaction).toHaveBeenCalledTimes(1);
            expect(mockTransaction.store.put).toHaveBeenCalledExactlyOnceWith(
                {
                    ...additions,
                    chunks: [...stored.chunks, ...additions.chunks],
                },
                'test-key'
            );
            expect(stored.chunks).toEqual([
                { content: 'existing', embedding: [0.1, 0.2, 0.3] },
            ]);
            expect(additions.chunks).toEqual([
                { content: 'new', embedding: [0.4, 0.5, 0.6] },
            ]);
            expect(mockDb.get).not.toHaveBeenCalled();
            expect(mockDb.put).not.toHaveBeenCalled();
        });

        it('keeps one entry per content and lets the latest addition win', async () => {
            mockTransaction.store.get.mockResolvedValue({
                ...additions,
                chunks: [
                    { content: 'duplicate', embedding: [1] },
                    { content: 'duplicate', embedding: [2] },
                    { content: 'untouched', embedding: [3] },
                ],
            });
            const updates = {
                ...additions,
                chunks: [
                    { content: 'duplicate', embedding: [4] },
                    { content: 'new', embedding: [5] },
                    { content: 'duplicate', embedding: [6] },
                ],
            };

            await cache.setEmbeddings('test-key', updates);

            expect(mockTransaction.store.put).toHaveBeenCalledExactlyOnceWith(
                {
                    ...updates,
                    chunks: [
                        { content: 'duplicate', embedding: [6] },
                        { content: 'untouched', embedding: [3] },
                        { content: 'new', embedding: [5] },
                    ],
                },
                'test-key'
            );
        });

        it.each([
            { providerId: 'other-provider', providerModel: 'test-model' },
            { providerId: 'test-provider', providerModel: 'other-model' },
        ])('discards an incompatible stored record: %j', async identity => {
            mockTransaction.store.get.mockResolvedValue({
                ...identity,
                chunks: [{ content: 'incompatible', embedding: [9] }],
            });

            await cache.setEmbeddings('test-key', additions);

            expect(mockTransaction.store.put).toHaveBeenCalledExactlyOnceWith(
                additions,
                'test-key'
            );
        });

        it('fails open if transaction creation throws', async () => {
            const error = new Error('transaction creation failed');
            mockDb.transaction.mockImplementationOnce(() => {
                throw error;
            });
            const log = vi.spyOn(console, 'error').mockImplementation(() => {});

            try {
                await expect(
                    cache.setEmbeddings('test-key', additions)
                ).resolves.toBeUndefined();

                expect(log).toHaveBeenCalledWith(
                    'Error setting embeddings in cache:',
                    error
                );
                expect(mockTransaction.store.get).not.toHaveBeenCalled();
                expect(mockTransaction.store.put).not.toHaveBeenCalled();
            } finally {
                log.mockRestore();
            }
        });

        it.each([
            { operation: 'get', synchronous: true },
            { operation: 'get', synchronous: false },
            { operation: 'put', synchronous: true },
            { operation: 'put', synchronous: false },
        ] as const)(
            'handles $operation failure (synchronous: $synchronous) and transaction rejection',
            async ({ operation, synchronous }) => {
                const requestError = new Error(`${operation} failed`);
                const transactionError = new Error('transaction aborted');
                let abort!: (reason: Error) => void;
                mockTransaction.done = new Promise((_resolve, reject) => {
                    abort = reject;
                });
                mockTransaction.store[operation].mockImplementationOnce(() => {
                    // Reject only when the operation is reached. Leave tx.done
                    // unhandled so Vitest detects a missing production handler.
                    abort(transactionError);
                    if (synchronous) throw requestError;
                    return Promise.reject(requestError);
                });
                const log = vi
                    .spyOn(console, 'error')
                    .mockImplementation(() => {});

                try {
                    await expect(
                        cache.setEmbeddings('test-key', additions)
                    ).resolves.toBeUndefined();
                    await new Promise(resolve => setTimeout(resolve, 0));

                    expect(mockTransaction.store[operation]).toHaveBeenCalled();
                    expect(log).toHaveBeenCalledWith(
                        'Error setting embeddings in cache:',
                        expect.any(Error)
                    );
                    if (operation === 'get') {
                        expect(
                            mockTransaction.store.put
                        ).not.toHaveBeenCalled();
                    }
                } finally {
                    log.mockRestore();
                }
            }
        );

        it('fails open when the commit rejects after a successful put', async () => {
            const error = new Error('commit failed');
            let abort!: (reason: Error) => void;
            mockTransaction.done = new Promise((_resolve, reject) => {
                abort = reject;
            });
            mockTransaction.store.put.mockImplementationOnce(() => {
                abort(error);
                return Promise.resolve('test-key');
            });
            const log = vi.spyOn(console, 'error').mockImplementation(() => {});

            try {
                await expect(
                    cache.setEmbeddings('test-key', additions)
                ).resolves.toBeUndefined();
                await new Promise(resolve => setTimeout(resolve, 0));

                expect(mockTransaction.store.put).toHaveBeenCalled();
                expect(log).toHaveBeenCalledWith(
                    'Error setting embeddings in cache:',
                    error
                );
            } finally {
                log.mockRestore();
            }
        });

        it('waits for the transaction commit after put succeeds', async () => {
            let commit!: () => void;
            mockTransaction.done = new Promise(resolve => {
                commit = resolve;
            });
            let settled = false;
            const write = cache
                .setEmbeddings('test-key', additions)
                .then(() => {
                    settled = true;
                });

            try {
                await new Promise(resolve => setTimeout(resolve, 0));

                expect(
                    mockTransaction.store.put
                ).toHaveBeenCalledExactlyOnceWith(additions, 'test-key');
                expect(settled).toBe(false);
            } finally {
                commit();
                await write;
            }
            expect(settled).toBe(true);
        });
    });

    it('should clear embeddings', async () => {
        await cache.init('test-vault');
        await cache.clearEmbeddings();
        expect(mockDb.clear).toHaveBeenCalledWith('embeddings');
    });

    it('handles clearEmbeddings errors without throwing', async () => {
        await cache.init('test-vault');
        mockDb.clear.mockRejectedValueOnce(new Error('clear error'));

        await cache.clearEmbeddings();
        expect(mockDb.clear).toHaveBeenCalledWith('embeddings');
    });

    it('should close database connection', async () => {
        await cache.init('test-vault');
        await cache.close();
        expect(mockDb.close).toHaveBeenCalled();
        expect(cache.isInitialized()).toBe(false);
    });
});
