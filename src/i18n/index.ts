import en from './en.json';
import ru from './ru.json';

const locales: { [key: string]: any } = {
    en,
    ru
};

export class I18n {
    static t(key: string, params?: { [key: string]: string }): string {
        const locale = window.localStorage.getItem('language') || 'en';
        const keys = key.split('.');
        
        let translations = locales[locale] || locales['en'];
        
        for (const k of keys) {
            if (translations?.[k] === undefined) {
                console.warn(`Translation missing: ${key}`);
                translations = locales['en'];
                let engValue = translations;
                for (const ek of keys) {
                    engValue = engValue?.[ek];
                }
                return engValue || key;
            }
            translations = translations[k];
        }
        
        let result = translations;
        
        // Handle string interpolation if params are provided
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                result = result.replace(`{{${key}}}`, value);
            });
        }
        
        return result;
    }
} 