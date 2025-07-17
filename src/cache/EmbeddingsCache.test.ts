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

    it('should return the same instance', () => {
        const instance1 = EmbeddingsCache.getInstance();
        const instance2 = EmbeddingsCache.getInstance();
        expect(instance1).toBe(instance2);
    });

    it('should initialize database with vault ID', async () => {
        await cache.init('test-vault-id');

        expect(openDB).toHaveBeenCalledWith(
            expect.stringMatching(/^aiProviders_[a-z0-9]+_test-vault-id$/),
            1,
            expect.any(Object)
        );
    });

    it('should get and set embeddings', async () => {
        await cache.init('test-vault');

        const mockEmbeddings = {
            providerId: 'test-provider',
            providerModel: 'test-model',
            chunks: [{ content: 'test', embedding: [0.1, 0.2, 0.3] }],
        };
        mockDb.get.mockResolvedValue(mockEmbeddings);

        // Test set
        await cache.setEmbeddings('test-key', mockEmbeddings);
        expect(mockDb.put).toHaveBeenCalledWith(
            'embeddings',
            mockEmbeddings,
            'test-key'
        );

        // Test get
        const result = await cache.getEmbeddings('test-key');
        expect(mockDb.get).toHaveBeenCalledWith('embeddings', 'test-key');
        expect(result).toEqual(mockEmbeddings);
    });

    it('should clear embeddings', async () => {
        await cache.init('test-vault');
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
