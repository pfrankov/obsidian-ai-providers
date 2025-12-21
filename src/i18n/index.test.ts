import { I18n } from './index';
import { logger } from '../utils/logger';

describe('I18n', () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.restoreAllMocks();
    });

    it('returns localized strings', () => {
        window.localStorage.setItem('language', 'en');
        expect(I18n.t('settings.save')).toBe('Save');
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

    it('supports interpolation params', () => {
        const result = I18n.t('settings.deleteConfirmation', { name: 'Test' });
        expect(result).toContain('Test');
    });
});
