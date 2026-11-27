/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Home: the right pane when nobody is selected. Your cell, whether you can
// be reached, your address, and how to get going.

import AddFriend from '../AddFriend/index.mjs';
import {t, avatar, groupedAddress, copyWithFeedback} from '../UI/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';

const styleLoaded = loadStyle(new URL('./style.css', import.meta.url));

/**
 * The home pane
 */
export default class Home {
    /**
     * @param {Object} app the App
     * @param {HTMLElement} pane where to draw
     */
    static async render(app, pane) {
        await styleLoaded;
        const me = app.data.me;
        const empty = app.data.contacts.length === 0 &&
            app.knocking().length === 0;
        const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl';
        const title = !navigator.onLine ? t('Home.offlineTitle') :
            empty ? t('Home.emptyTitle') : t('Home.title');
        const text = !navigator.onLine ? t('Home.offlineText') :
            empty ? t('Home.emptyText') : t('Home.text');
        pane.innerHTML = html`<div id="home">
            <div class="halo">
                <span class="ring hx"></span><span class="gap hx"></span>
                ${avatar(me, 82, 'me')}
            </div>
            <h1>${title}</h1>
            <p class="muted">${text}</p>
            ${empty ? html`<ol class="steps">
                <li>${t('Home.step1')}</li>
                <li>${t('Home.step2')}</li>
                <li>${t('Home.step3')}</li>
            </ol>` : ''}
            <div class="address mono" data-testid="my-address">
                ${groupedAddress(me.key)}</div>
            <div class="hh-row center">
                <button class="hh-btn hh-primary" name="add">
                    ${t('Hive.addFriend')}</button>
                <button class="hh-btn hh-secondary" name="copy">
                    ${t('Home.copyMine')}</button>
            </div>
            <div class="keys muted">
                <span><span class="hh-kbd">${mod} K</span>
                    ${t('Home.keyFind')}</span>
                <span><span class="hh-kbd">${mod} N</span>
                    ${t('Home.keyAdd')}</span>
                <span><span class="hh-kbd">${mod} ,</span>
                    ${t('Home.keySettings')}</span>
                <span><span class="hh-kbd">← → ↑ ↓</span>
                    ${t('Home.keyMove')}</span>
                <span><span class="hh-kbd">Esc</span>
                    ${t('Home.keyBack')}</span>
            </div>
        </div>`.toString();
        pane.querySelector('[name=add]').onclick = () => AddFriend.open(app);
        const copy = pane.querySelector('[name=copy]');
        copy.onclick = () => copyWithFeedback(me.key, copy);
    }
}
