import { openDB, IDBPDatabase } from 'idb';

interface EmbeddingsCacheItem {
    providerId: string; // ID of the provider used
    providerModel: string; // Model name used for embeddings
    chunks: {
        content: string;
        embedding: number[];
    }[];
}

export class EmbeddingsCache {
    private static instance: EmbeddingsCache;
    private db: IDBPDatabase | null = null;
    private vaultId = '';
    private dbName = '';

    private constructor() {}

    static getInstance(): EmbeddingsCache {
        if (!EmbeddingsCache.instance) {
            EmbeddingsCache.instance = new EmbeddingsCache();
        }
        return EmbeddingsCache.instance;
    }

    async init(vaultId: string): Promise<void> {
        try {
            // If already initialized with different vault, close and reinitialize
            if (this.db && this.vaultId !== vaultId) {
                await this.close();
            }

            // Skip if already initialized with same vault
            if (this.db && this.vaultId === vaultId) {
                return;
            }

            this.vaultId = vaultId;
            // Use a unique database name with plugin-specific prefix
            // Hash the plugin ID to make it less predictable
            const pluginHash = this.simpleHash('ai-providers-plugin');
            this.dbName = `aiProviders_${pluginHash}_${this.vaultId}`;

            this.db = await openDB(this.dbName, 1, {
                upgrade(db) {
                    db.createObjectStore('embeddings');
                },
            });
        } catch (error) {
            console.error(
                'Failed to initialize embeddings cache database:',
                error
            );
            // Don't throw, allow the app to continue without cache
            this.db = null;
        }
    }

    private simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    async getEmbeddings(key: string): Promise<EmbeddingsCacheItem | undefined> {
        if (!this.db) return undefined;
        try {
            return await this.db.get('embeddings', key);
        } catch (error) {
            console.error('Error getting embeddings from cache:', error);
            return undefined;
        }
    }

    async setEmbeddings(
        key: string,
        value: EmbeddingsCacheItem
    ): Promise<void> {
        if (!this.db) return;
        try {
            await this.db.put('embeddings', value, key);
        } catch (error) {
            console.error('Error setting embeddings in cache:', error);
        }
    }

    async clearEmbeddings(): Promise<void> {
        if (!this.db) return;
        try {
            await this.db.clear('embeddings');
        } catch (error) {
            console.error('Error clearing embeddings cache:', error);
        }
    }

    async clearAll(): Promise<void> {
        if (!this.db) return;
        try {
            await this.db.clear('embeddings');
        } catch (error) {
            console.error('Error clearing all caches:', error);
        }
    }

    async close(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    isInitialized(): boolean {
        return this.db !== null;
    }
}

// Export only for internal use within cache module
const embeddingsCache = EmbeddingsCache.getInstance();
export { embeddingsCache };
