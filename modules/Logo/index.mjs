/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

import {getPath} from '../ImagePack/index.mjs';
import i18n from '../I18n/index.mjs';
import {html, raw, loadStyle} from '../Html/index.mjs';

// The app's own logo, inlined so that CSS can style it
const logoSVG = raw(await (await fetch(getPath('branding.logoIcon'))).text());
const styleLoaded = loadStyle(new URL('./style.css', import.meta.url));

/**
 * The logo with the app name
 */
export default class Logo {
    /**
     * @param {boolean} small the half-size logo used in the sidebar
     * @return {SafeHTML} the logo
     */
    static getHTML(small = false) {
        return html`<div id="logoWithText" class="${small ? 'small' : ''}">
            <div class="logo">${logoSVG}</div>
            <div class="text">${i18n.getText('Logo.hexhoot')}</div>
            <div class="version">${i18n.getText('Logo.alpha')}</div>
        </div>`;
    }

    /** @return {Promise} resolves once the logo's stylesheet has loaded */
    static ready() {
        return styleLoaded;
    }
}
