/* Copyright (c) 2022 Zenin Easa Panthakkalakath */

const requireText = require('require-text');
const dbMessenger = require('./../DBMessenger')();

/**
 * This class helps in implementing support for multiple languages.
 */
class I18n {
    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (I18n._instance) {
            return I18n._instance;
        }
        I18n._instance = this;
        I18n._instance.initialize();
    }

    /**
     * Initialize I18n
     */
    initialize() {
        this.texts = JSON.parse(requireText('./lang.json', require));

        this.selectedLang = 'en'; // default language
        this.selectLanguageFromPreferences();
    }

    /**
     * Chosen language in the preferences (database)
     */
    async selectLanguageFromPreferences() {
        const langPref = await dbMessenger.getPreference('language');
        if (langPref) {
            if (langPref.value !== '') {
                this.selectedLang = langPref.value;
                window.reload();
            }
        }
    }

    /**
     * This function renders the dropdown for choosing a language
     */
    render() {
        // Link css
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = __dirname + '/style.css';
        document.body.appendChild(link);

        const elem = document.createElement('div');
        elem.innerHTML =
            eval('`' + requireText('./template.html', require) + '`');

        // If div already exists, remove it.
        const checkElem = document.getElementById('i18n');
        if (checkElem) {
            checkElem.remove();
        }

        // Append the new element into the body
        document.body.appendChild(elem);

        // Language selection dropdown
        const languageSelector = document.getElementById('languages');
        languageSelector.querySelector('[value=' + this.selectedLang + ']')
            .setAttribute('selected', '');
        languageSelector.onchange = function() {
            this.languageSelectionCallback(languageSelector.value);
        }.bind(this);
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
        hierarchy = hierarchy.split('.'); // to hierarchy array

        let value = this.texts;
        for (let i = 0; i < hierarchy.length; i++) {
            value = value[hierarchy[i]];
        }

        return value[this.selectedLang];
    }
}

module.exports = function() {
    return new I18n();
};
