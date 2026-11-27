/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// The contact panel, sliding in over a conversation: photo, about text, the
// safety number to compare, the verified mark, their address, and removing
// or blocking them (with a confirmation).

import dbMessenger from '../DBMessenger/index.mjs';
import Chain from '../Chain/index.mjs';
import {t, avatar, displayName, firstName, groupedAddress, icon, toast,
    copyWithFeedback} from '../UI/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';

const styleLoaded = loadStyle(new URL('./style.css', import.meta.url));

/**
 * The contact panel
 */
export default class Contact {
    /**
     * @param {Object} app the App
     * @param {HTMLElement} panel where to draw
     * @param {string} key the contact
     */
    static async render(app, panel, key) {
        await styleLoaded;
        const [contact, safetyNumber] = await Promise.all([
            dbMessenger.getUserInfo(key),
            dbMessenger.getSafetyNumber(key),
        ]);
        if (!contact || !app.state.panel || app.state.id !== key) {
            return;
        }
        const name = firstName(contact);
        panel.innerHTML = html`<div id="contact" class="slide-in">
            <div class="head">
                <h2>${t('Contact.title')}</h2>
                <button class="hh-icon" name="close"
                    aria-label="${t('Contact.close')}"
                    title="${t('Contact.close')}">${icon('close', 18)}</button>
            </div>
            <div class="body">
                <div class="who">
                    ${avatar(contact, 76)}
                    <div class="name">${displayName(contact)}</div>
                    ${contact.about ? html`<div class="about muted"
                        >${contact.about}</div>` : ''}
                </div>
                <h3>${t('Contact.safetyNumber')}</h3>
                <div class="help muted">${t('Contact.safetyHelp', {name})}</div>
                <div id="safetyNumber" class="mono"
                    data-testid="safety-number"
                    data-value="${safetyNumber || ''}">${(safetyNumber || '')
    .split(' ').map((group) => html`<span>${group}</span>`)}</div>
                <div id="verification"
                    data-verified="${String(Boolean(contact.verified))}">
                    ${contact.verified ? html`<div class="verified">
                        <span class="dot hx"></span>
                        <span class="label">${t('Contact.verified')}</span>
                        <button class="hh-link" name="verify">
                            ${t('Contact.removeMark')}</button></div>` :
        html`<button class="hh-btn hh-primary wide" name="verify">
                        ${t('Contact.numbersMatch')}</button>`}
                </div>
                <h3>${t('Contact.address')}</h3>
                <div class="address mono">${groupedAddress(key)}</div>
                <button class="hh-btn hh-secondary" name="copy">
                    ${t('Contact.copyAddress')}</button>
                <div class="actions">
                    <button class="hh-btn hh-secondary" name="remove">
                        ${t('Contact.remove')}</button>
                    <button class="hh-btn hh-danger" name="block">
                        ${t('Contact.block')}</button>
                </div>
                <div class="confirm" hidden></div>
            </div>
        </div>`.toString();

        panel.querySelector('[name=close]').onclick = () => app.closePanel();
        panel.querySelector('[name=verify]').onclick = async () => {
            await dbMessenger.setVerified(key, !contact.verified);
            await app.refresh();
            // The header's mark and the event on the chain
            await Chain.onContactChanged(app, key);
            await Contact.render(app, panel, key);
            panel.querySelector('[name=verify]')?.focus();
        };
        const copy = panel.querySelector('[name=copy]');
        copy.onclick = () => copyWithFeedback(key, copy);
        panel.querySelector('[name=remove]').onclick = () =>
            Contact.confirm(app, panel, contact, 'remove');
        panel.querySelector('[name=block]').onclick = () =>
            Contact.confirm(app, panel, contact, 'block');
        panel.querySelector('[name=close]').focus();
    }

    /**
     * Ask before removing or blocking
     * @param {Object} app the App
     * @param {HTMLElement} panel the panel
     * @param {Object} contact the contact
     * @param {string} what 'remove' or 'block'
     */
    static confirm(app, panel, contact, what) {
        const name = firstName(contact);
        const box = panel.querySelector('.confirm');
        panel.querySelector('.actions').hidden = true;
        box.hidden = false;
        box.innerHTML = html`
            <div class="title">${t(what === 'block' ? 'Contact.blockTitle' :
        'Contact.removeTitle', {name})}</div>
            <div class="text muted">${t(what === 'block' ?
        'Contact.blockText' : 'Contact.removeText', {name})}</div>
            <div class="hh-row">
                <button class="hh-btn hh-secondary" name="cancel">
                    ${t('Backup.cancel')}</button>
                <button class="hh-btn hh-danger-solid" name="confirm">
                    ${t(what === 'block' ? 'Contact.block' :
        'Contact.remove')}</button>
            </div>`.toString();
        box.querySelector('[name=cancel]').onclick = () => {
            box.hidden = true;
            panel.querySelector('.actions').hidden = false;
        };
        box.querySelector('[name=confirm]').onclick = async () => {
            if (what === 'block') {
                await dbMessenger.blockAddress(contact.key);
            } else {
                await dbMessenger.removeContact(contact.key);
            }
            sessionStorage.removeItem('hexhoot.draft.' + contact.key);
            await app.refresh();
            await app.go('home');
            toast(t(what === 'block' ? 'Contact.blocked' : 'Contact.removed',
                {name}));
        };
        box.querySelector('[name=confirm]').focus();
    }
}
