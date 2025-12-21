import { vi } from 'vitest';

// Mock for idb module
export const openDB = vi.fn(async () => {
    const stores = new Map();
    
    return {
        get: vi.fn(async (storeName, key) => {
            const store = stores.get(storeName);
            return store?.get(key);
        }),
        put: vi.fn(async (storeName, value, key) => {
            if (!stores.has(storeName)) {
                stores.set(storeName, new Map());
            }
            stores.get(storeName).set(key, value);
        }),
        clear: vi.fn(async (storeName) => {
            stores.get(storeName)?.clear();
        }),
        close: vi.fn()
    };
});

export const deleteDB = vi.fn(); 
