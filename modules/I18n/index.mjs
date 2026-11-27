/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

import texts from './lang.json' with {type: 'json'};
import dbMessenger from '../DBMessenger/index.mjs';

/**
 * This class helps in implementing support for multiple languages.
 */
class I18n {
    /** constructor */
    constructor() {
        this.texts = texts;
        this.selectedLang = 'en'; // default language
    }

    /**
     * Use the language chosen in the preferences, if any
     */
    async selectLanguageFromPreferences() {
        const langPref = await dbMessenger.getPreference('language');
        if (langPref && Object.hasOwn(this.texts.I18n.language,
            langPref.value)) {
            this.selectedLang = langPref.value;
        }
        document.documentElement.lang = this.selectedLang;
    }

    /** @return {Object} {code: name in its own language} */
    languages() {
        return this.texts.I18n.language;
    }

    /**
     * Switch language and redraw the window
     * @param {string} chosenLanguage a code from languages()
     */
    async setLanguage(chosenLanguage) {
        if (!Object.hasOwn(this.languages(), chosenLanguage)) {
            return;
        }
        this.selectedLang = chosenLanguage;
        document.documentElement.lang = chosenLanguage;
        await dbMessenger.setPreference('language', chosenLanguage);
        window.reload();
    }

    /**
     * Get text in selected language
     * @param {String} hierarchy path to the message in lang.json
     * @param {Object} [values] replacements for {name} placeholders
     * @return {string} the requested text in the selected language
     */
    getText(hierarchy, values) {
        let value = this.texts;
        for (const name of hierarchy.split('.')) {
            value = value?.[name];
        }
        let text = value?.[this.selectedLang] ?? value?.en;
        if (typeof text !== 'string') {
            throw new Error('Unknown text: ' + hierarchy);
        }
        if (values) {
            text = text.replace(/\{(\w+)\}/g, (match, key) =>
                Object.hasOwn(values, key) ? String(values[key]) : match);
        }
        return text;
    }
}

export default new I18n();
