import de from './de.json';
import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import it from './it.json';
import ja from './ja.json';
import ko from './ko.json';
import nl from './nl.json';
import pt from './pt.json';
import ru from './ru.json';
import zh from './zh.json';
import { logger } from '../utils/logger';

type TranslationNode = string | { [key: string]: TranslationNode };

const locales: Record<string, TranslationNode> = {
    en,
    ru,
    de,
    zh,
    es,
    fr,
    it,
    ja,
    ko,
    nl,
    pt,
};

const resolveTranslation = (
    translations: TranslationNode,
    keys: string[]
): string | undefined => {
    let current: TranslationNode = translations;
    for (const key of keys) {
        if (typeof current !== 'object' || current === null) {
            return undefined;
        }
        if (!(key in current)) {
            return undefined;
        }
        current = current[key];
    }
    return typeof current === 'string' ? current : undefined;
};

export class I18n {
    static t(key: string, params?: { [key: string]: string }): string {
        const locale = window.localStorage.getItem('language') || 'en';
        const keys = key.split('.');

        const translations = locales[locale] || locales['en'];
        let result = resolveTranslation(translations, keys);

        if (result === undefined) {
            logger.warn(`Translation missing: ${key}`);
            result = resolveTranslation(locales['en'], keys);
        }

        if (result === undefined) {
            return key;
        }

        let finalResult = result;
        // Handle string interpolation if params are provided
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                finalResult = finalResult.replace(`{{${key}}}`, value);
            });
        }

        return finalResult;
    }
}
