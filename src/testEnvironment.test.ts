import type {} from 'vitest/jsdom';

describe('browser storage test environment', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('exposes the original jsdom Storage through both globals', () => {
        expect(window.localStorage).toBe(jsdom.window.localStorage);
        expect(globalThis.localStorage).toBe(jsdom.window.localStorage);
        expect(window.localStorage).toBeInstanceOf(Storage);
    });

    it('supports browser storage reads, writes and deletion', () => {
        const storage = window.localStorage;
        expect(storage.getItem('language')).toBeNull();
        storage.setItem('language', 'ru');
        expect(storage.getItem('language')).toBe('ru');
        expect(storage.length).toBe(1);
        expect(storage.key(0)).toBe('language');
        storage.removeItem('language');
        expect(storage.getItem('language')).toBeNull();
        storage.setItem('language', 'en');
        storage.clear();
        expect(storage.length).toBe(0);
    });

    it('restores browser storage after global mock cleanup', () => {
        const storage = window.localStorage;
        vi.stubGlobal('localStorage', undefined);
        expect(window.localStorage).toBeUndefined();
        vi.unstubAllGlobals();
        expect(window.localStorage).toBe(storage);
        storage.setItem('language', 'ru');
        expect(window.localStorage.getItem('language')).toBe('ru');
    });

    it.each([1, 2])('isolates persisted values between tests (%i)', () => {
        expect(window.localStorage.length).toBe(0);
        window.localStorage.setItem('language', 'ru');
    });
});
