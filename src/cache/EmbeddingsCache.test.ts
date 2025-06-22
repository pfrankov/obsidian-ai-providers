import { EmbeddingsCache } from './EmbeddingsCache';
import { openDB } from 'idb';

// Mock idb
jest.mock('idb');

describe('EmbeddingsCache', () => {
    let cache: EmbeddingsCache;
    let mockDb: any;

    beforeEach(() => {
        // Reset singleton instance
        (EmbeddingsCache as any).instance = null;
        cache = EmbeddingsCache.getInstance();

        // Mock database
        mockDb = {
            get: jest.fn(),
            put: jest.fn(),
            clear: jest.fn(),
            close: jest.fn(),
        };

        (openDB as jest.Mock).mockResolvedValue(mockDb);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('getInstance', () => {
        it('should return the same instance', () => {
            const instance1 = EmbeddingsCache.getInstance();
            const instance2 = EmbeddingsCache.getInstance();
            expect(instance1).toBe(instance2);
        });
    });

    describe('init', () => {
        it('should initialize database with vault ID', async () => {
            await cache.init('test-vault-id');

            expect(openDB).toHaveBeenCalledWith(
                expect.stringMatching(/^aiProviders_[a-z0-9]+_test-vault-id$/),
                1,
                expect.any(Object)
            );
        });
    });

    describe('embeddings operations', () => {
        beforeEach(async () => {
            await cache.init('test-vault');
        });

        it('should get embeddings from cache', async () => {
            const mockEmbeddings = {
                providerId: 'test-provider',
                providerModel: 'test-model',
                chunks: [{ content: 'test', embedding: [0.1, 0.2, 0.3] }],
            };
            mockDb.get.mockResolvedValue(mockEmbeddings);

            const result = await cache.getEmbeddings('test-key');

            expect(mockDb.get).toHaveBeenCalledWith('embeddings', 'test-key');
            expect(result).toEqual(mockEmbeddings);
        });

        it('should set embeddings in cache', async () => {
            const embeddings = {
                providerId: 'test-provider',
                providerModel: 'test-model',
                chunks: [{ content: 'test', embedding: [0.1, 0.2, 0.3] }],
            };

            await cache.setEmbeddings('test-key', embeddings);

            expect(mockDb.put).toHaveBeenCalledWith(
                'embeddings',
                embeddings,
                'test-key'
            );
        });

        it('should return undefined if database not initialized', async () => {
            (cache as any).db = null;

            const result = await cache.getEmbeddings('test-key');
            expect(result).toBeUndefined();
        });
    });

    describe('clear operations', () => {
        beforeEach(async () => {
            await cache.init('test-vault');
        });

        it('should clear embeddings', async () => {
            await cache.clearEmbeddings();

            expect(mockDb.clear).toHaveBeenCalledWith('embeddings');
        });

        it('should clear all caches', async () => {
            await cache.clearAll();

            expect(mockDb.clear).toHaveBeenCalledWith('embeddings');
        });
    });

    describe('close', () => {
        it('should close database connection', async () => {
            await cache.init('test-vault');
            await cache.close();

            expect(mockDb.close).toHaveBeenCalled();
            expect(cache.isInitialized()).toBe(false);
        });
    });

    describe('isInitialized', () => {
        it('should return false when not initialized', () => {
            expect(cache.isInitialized()).toBe(false);
        });

        it('should return true when initialized', async () => {
            await cache.init('test-vault');
            expect(cache.isInitialized()).toBe(true);
        });
    });
});
