import type { Mock } from 'vitest';
import { EmbeddingsCache } from './EmbeddingsCache';
import { openDB } from 'idb';

// Mock idb
vi.mock('idb');

describe('EmbeddingsCache', () => {
    let cache: EmbeddingsCache;
    let mockDb: any;

    beforeEach(() => {
        // Reset singleton instance
        (EmbeddingsCache as any).instance = null;
        cache = EmbeddingsCache.getInstance();

        // Mock database
        mockDb = {
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

    it('should get and set embeddings', async () => {
        await cache.init('test-vault');

        const mockCacheItem = {
            providerId: 'test-provider',
            providerModel: 'test-model',
            chunks: [{ content: 'test', embedding: [0.1, 0.2, 0.3] }],
        };
        mockDb.get.mockResolvedValue(mockCacheItem);

        // Test set
        await cache.setEmbeddings('test-key', mockCacheItem);
        expect(mockDb.put).toHaveBeenCalledWith(
            'embeddings',
            mockCacheItem,
            'test-key'
        );

        // Test get
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
    });

    it('handles setEmbeddings errors without throwing', async () => {
        await cache.init('test-vault');
        mockDb.put.mockRejectedValueOnce(new Error('write error'));
        await cache.setEmbeddings('test-key', {
            providerId: 'test',
            providerModel: 'model',
            chunks: [],
        });
        expect(mockDb.put).toHaveBeenCalled();
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
