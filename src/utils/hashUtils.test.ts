import {
    createSecureHash,
    createDatabaseHash,
    createCacheKeyHash,
} from './hashUtils';

// Mock crypto globally for these tests
const mockCrypto = {
    subtle: {
        digest: jest.fn(),
    },
};

Object.defineProperty(global, 'crypto', {
    value: mockCrypto,
    writable: true,
});

describe('hashUtils', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default mock - fill buffer with 42
        mockCrypto.subtle.digest.mockImplementation(() => {
            const buffer = new ArrayBuffer(32);
            const view = new Uint8Array(buffer);
            view.fill(42);
            return Promise.resolve(buffer);
        });
    });

    it('should generate consistent hashes for same input', async () => {
        const hash1 = await createSecureHash('test-input');
        const hash2 = await createSecureHash('test-input');

        expect(hash1).toBe(hash2);
        expect(hash1).toBe('2a2a2a2a2a2a2a2a'); // 42 in hex
        expect(hash1).toHaveLength(16);
    });

    it('should support custom length', async () => {
        const hash8 = await createSecureHash('test', 8);
        const hash20 = await createSecureHash('test', 20);

        expect(hash8).toHaveLength(8);
        expect(hash20).toHaveLength(20);
    });

    it('should generate different hashes for different inputs', async () => {
        const buffer1 = new ArrayBuffer(32);
        const buffer2 = new ArrayBuffer(32);
        new Uint8Array(buffer1).fill(1);
        new Uint8Array(buffer2).fill(2);

        mockCrypto.subtle.digest
            .mockResolvedValueOnce(buffer1)
            .mockResolvedValueOnce(buffer2);

        const hash1 = await createSecureHash('input1');
        const hash2 = await createSecureHash('input2');

        expect(hash1).not.toBe(hash2);
    });

    it('should return correct lengths for convenience functions', async () => {
        const dbHash = await createDatabaseHash('test');
        const cacheHash = await createCacheKeyHash('test');

        expect(dbHash).toHaveLength(16);
        expect(cacheHash).toHaveLength(20);
    });
});
