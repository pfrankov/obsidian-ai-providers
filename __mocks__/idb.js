// Mock for idb module
export const openDB = jest.fn(async () => {
    const stores = new Map();
    
    return {
        get: jest.fn(async (storeName, key) => {
            const store = stores.get(storeName);
            return store?.get(key);
        }),
        put: jest.fn(async (storeName, value, key) => {
            if (!stores.has(storeName)) {
                stores.set(storeName, new Map());
            }
            stores.get(storeName).set(key, value);
        }),
        clear: jest.fn(async (storeName) => {
            stores.get(storeName)?.clear();
        }),
        close: jest.fn()
    };
});

export const deleteDB = jest.fn(); 