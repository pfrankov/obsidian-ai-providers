import { I18n } from './index';
import ru from './ru.json';
import { logger } from '../utils/logger';

describe('I18n', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('returns localized strings', () => {
        window.localStorage.setItem('language', 'en');
        expect(I18n.t('settings.save')).toBe('Save');
    });

    it('reads the selected language on every call', () => {
        window.localStorage.setItem('language', 'ru');
        expect(I18n.t('settings.save')).toBe(ru.settings.save);
        expect(window.localStorage.getItem('language')).toBe('ru');

        window.localStorage.setItem('language', 'en');
        expect(I18n.t('settings.save')).toBe('Save');
    });

    it('uses English when no language is saved', () => {
        expect(I18n.t('settings.save')).toBe('Save');
    });

    it('uses English for an empty language preference', () => {
        window.localStorage.setItem('language', '');
        expect(I18n.t('settings.save')).toBe('Save');
    });

    it('uses English when localStorage is unavailable', () => {
        vi.stubGlobal('localStorage', undefined);
        expect(I18n.t('settings.save')).toBe('Save');
    });

    it('uses English when accessing localStorage throws', () => {
        vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
            throw new DOMException('Storage access denied', 'SecurityError');
        });
        expect(I18n.t('settings.save')).toBe('Save');
    });

    it('recovers after reading the language temporarily fails', () => {
        window.localStorage.setItem('language', 'ru');
        const getItemSpy = vi
            .spyOn(Storage.prototype, 'getItem')
            .mockImplementation(() => {
                throw new DOMException('Storage read denied', 'SecurityError');
            });

        expect(I18n.t('settings.save')).toBe('Save');
        expect(
            I18n.t('settings.deleteConfirmation', { name: 'Test' })
        ).toContain('Test');

        getItemSpy.mockRestore();
        expect(window.localStorage.getItem('language')).toBe('ru');
        expect(I18n.t('settings.save')).toBe(ru.settings.save);
    });

    it('falls back to English for unknown locales', () => {
        window.localStorage.setItem('language', 'xx');
        expect(I18n.t('settings.save')).toBe('Save');
    });

    it('warns and returns key for missing translations', () => {
        const warnSpy = vi.spyOn(logger, 'warn');
        expect(I18n.t('missing.key')).toBe('missing.key');
        expect(warnSpy).toHaveBeenCalledWith(
            'Translation missing: missing.key'
        );
    });

    it('warns when nested key targets a string value', () => {
        const warnSpy = vi.spyOn(logger, 'warn');
        expect(I18n.t('settings.save.extra')).toBe('settings.save.extra');
        expect(warnSpy).toHaveBeenCalledWith(
            'Translation missing: settings.save.extra'
        );
    });

    it('warns when translation resolves to an object', () => {
        const warnSpy = vi.spyOn(logger, 'warn');
        expect(I18n.t('settings')).toBe('settings');
        expect(warnSpy).toHaveBeenCalledWith('Translation missing: settings');
    });

    it('supports interpolation params', () => {
        const result = I18n.t('settings.deleteConfirmation', { name: 'Test' });
        expect(result).toContain('Test');
    });
});
