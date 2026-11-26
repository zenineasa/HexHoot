/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

import texts from './lang.json' with {type: 'json'};
import dbMessenger from '../DBMessenger/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';

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
    }

    /**
     * This function renders the dropdown for choosing a language
     */
    async render() {
        await loadStyle(new URL('./style.css', import.meta.url));
        const languages = this.texts.I18n.language;
        const elem = document.createElement('div');
        elem.innerHTML = html`<div id="i18n">
            ${this.getText('I18n.chooseLanguage')}:
            <select name="languages" id="languages">
                ${Object.keys(languages).map((key) => html`
                    <option value="${key}">${languages[key]}</option>`)}
            </select>
        </div>`;

        // If div already exists, remove it.
        document.getElementById('i18n')?.parentElement.remove();
        document.body.appendChild(elem);

        // Language selection dropdown
        const languageSelector = document.getElementById('languages');
        languageSelector.value = this.selectedLang;
        languageSelector.onchange = () => {
            this.languageSelectionCallback(languageSelector.value);
        };
    }

    /**
     * Language selection dropdown callback
     * @param {string} chosenLanguage the language chosen in the UI
     */
    languageSelectionCallback(chosenLanguage) {
        this.selectedLang = chosenLanguage;
        dbMessenger.setPreference('language', chosenLanguage);
        window.reload();
    }

    /**
     * Get text in selected language
     * @param {String} hierarchy path to the message in lang.json
     * @return {string} the requested text in the selected language
     */
    getText(hierarchy) {
        let value = this.texts;
        for (const name of hierarchy.split('.')) {
            value = value[name];
        }
        return value[this.selectedLang];
    }
}

export default new I18n();
