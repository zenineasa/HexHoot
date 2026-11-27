/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Settings cover the window. "← Back" names where it returns to, and Esc
// does the same.

import dbMessenger from '../DBMessenger/index.mjs';
import PasswordCheck from '../PasswordCheck/index.mjs';
import i18n from '../I18n/index.mjs';
import {applyTheme} from '../App/theme.mjs';
import {t, icon, avatar, displayName, groupedAddress, shortAddress, toast,
    copyWithFeedback} from '../UI/index.mjs';
import {getPath} from '../ImagePack/index.mjs';
import {MAX_DISPLAY_NAME_LENGTH, MAX_ABOUT_LENGTH} from '../Sanitize/index.mjs';
import socialLinks from '../Social/links.json' with {type: 'json'};
import {html, loadStyle} from '../Html/index.mjs';

const styleLoaded = loadStyle(new URL('./style.css', import.meta.url));
const SECTIONS = ['profile', 'security', 'backup', 'appearance', 'language',
    'blocked', 'about'];
// A photo is shrunk to this many pixels on its longer side
const PHOTO_SIZE = 320;
const MIN_PASSPHRASE = 16;

/**
 * The Settings page
 */
export default class Settings {
    /**
     * @param {Object} app the App
     * @param {HTMLElement} el where to draw
     */
    static async render(app, el) {
        await styleLoaded;
        const section = SECTIONS.includes(app.state.section) ?
            app.state.section : 'profile';
        el.innerHTML = html`
            <nav class="settings-nav" aria-label="${t('Settings.title')}">
                <button class="hh-btn hh-quiet" id="settingsBack">
                    ${icon('back', 16)} ${app.backLabel()}</button>
                <div class="settings-title">${t('Settings.title')}</div>
                ${SECTIONS.map((name) => html`<button class="nav"
                    data-section="${name}"
                    aria-current="${name === section ? 'page' : 'false'}">
                    ${t('Settings.' + name)}</button>`)}
            </nav>
            <div class="settings-body">
                <div class="settings-content" id="settings-${section}">
                    <h1>${t('Settings.' + section)}</h1>
                    <p class="muted intro">${t('Settings.' + section +
                        'Intro')}</p>
                    <div class="section"></div>
                </div>
            </div>`.toString();
        el.querySelector('#settingsBack').onclick = () => app.back();
        for (const button of el.querySelectorAll('.nav')) {
            button.onclick = () => {
                app.state.section = button.dataset.section;
                Settings.render(app, el).then(() =>
                    el.querySelector(`.nav[data-section="${
                        button.dataset.section}"]`)?.focus());
            };
        }
        await Settings[section](app, el.querySelector('.section'));
    }

    /**
     * Your profile
     * @param {Object} app the App
     * @param {HTMLElement} box where to draw
     */
    static async profile(app, box) {
        const me = await dbMessenger.getLoggedInUserInfoPublic();
        let photo = me.photo || '';
        box.innerHTML = html`<div id="editProfile">
            <div class="photo-row">
                <span class="photo">${avatar(me, 64)}</span>
                <label class="hh-btn hh-secondary">
                    ${t('Settings.changePhoto')}
                    <input type="file" name="photo" class="sr-only"
                        accept="image/png,image/jpeg,image/webp"></label>
                ${photo ? html`<button class="hh-link" name="removePhoto">
                    ${t('Settings.removePhoto')}</button>` : ''}
            </div>
            <div class="hh-hint" id="photoNote" aria-live="polite"></div>
            <label class="hh-label" for="displayName">
                ${t('EditProfile.displayName')}</label>
            <input class="hh-input" id="displayName" name="displayName"
                maxlength="${MAX_DISPLAY_NAME_LENGTH}"
                value="${me.displayName}">
            <div class="hh-hint">${t('Settings.nameHint')}</div>
            <label class="hh-label" for="about">
                ${t('EditProfile.aboutYou')}</label>
            <textarea class="hh-input" id="about" name="about" rows="3"
                maxlength="${MAX_ABOUT_LENGTH}">${me.about}</textarea>
            <div class="hh-row buttons">
                <button class="hh-btn hh-primary" id="saveProfile">
                    ${t('Settings.save')}</button>
            </div>
            <h2>${t('Settings.yourAddress')}</h2>
            <div class="address mono">${groupedAddress(me.key)}</div>
            <button class="hh-btn hh-secondary" name="copy">
                ${t('AddFriend.copyToClipboard')}</button>
        </div>`.toString();
        const note = box.querySelector('#photoNote');
        const preview = (value) => {
            box.querySelector('.photo').innerHTML =
                avatar({...me, photo: value}, 64).toString();
        };
        box.querySelector('[name=photo]').onchange = async (event) => {
            const file = event.target.files[0];
            if (!file) {
                return;
            }
            try {
                photo = await shrinkPhoto(file);
            } catch (err) {
                note.dataset.tone = 'warn';
                note.textContent = t('Settings.photoUnreadable');
                return;
            }
            preview(photo);
            note.dataset.tone = 'ok';
            note.textContent = t('Settings.photoReady', {size:
                Math.round(photo.length * 3 / 4 / 1024)});
        };
        const removePhoto = box.querySelector('[name=removePhoto]');
        if (removePhoto) {
            removePhoto.onclick = () => {
                photo = '';
                preview('');
                removePhoto.remove();
            };
        }
        const copy = box.querySelector('[name=copy]');
        copy.onclick = () => copyWithFeedback(me.key, copy);
        box.querySelector('#saveProfile').onclick = async () => {
            await dbMessenger.writeLoggedInUserInfo({
                displayName: box.querySelector('[name=displayName]').value
                    .trim(),
                about: box.querySelector('[name=about]').value,
                photo,
            });
            await app.refresh();
            toast(t('Settings.saved'));
        };
    }

    /**
     * Account and security
     * @param {Object} app the App
     * @param {HTMLElement} box where to draw
     */
    static async security(app, box) {
        box.innerHTML = html`<div class="stack">
            <section class="hh-card split">
                <div><h3>${t('Settings.checkTitle')}</h3>
                    <div class="muted small">${t('Settings.checkText')}</div>
                </div>
                <button class="hh-btn hh-secondary" name="checkNow">
                    ${t('Settings.checkNow')}</button>
            </section>
            <section class="hh-card">
                <h3>${t('Settings.signedInTitle')}</h3>
                <div class="muted small">${t('Settings.signedInText')}</div>
            </section>
            <section class="danger-zone">
                <h3>${t('Settings.removeTitle')}</h3>
                <div class="muted small">${t('Settings.removeText')}</div>
                <div class="remove-step">
                    <button class="hh-btn hh-danger" name="askRemove">
                        ${t('Settings.removeAsk')}</button>
                </div>
            </section>
        </div>`.toString();
        box.querySelector('[name=checkNow]').onclick = () =>
            PasswordCheck.render({force: true});
        box.querySelector('[name=askRemove]').onclick = () => {
            const step = box.querySelector('.remove-step');
            step.innerHTML = html`
                <label class="ack"><input type="checkbox" name="ack">
                    <span>${t('Settings.removeAck')}</span></label>
                <div class="hh-row">
                    <button class="hh-btn hh-secondary" name="cancel">
                        ${t('Backup.cancel')}</button>
                    <button class="hh-btn hh-danger-solid" id="removeAccount"
                        disabled>${t('Settings.removeConfirm')}</button>
                </div>`.toString();
            const confirm = step.querySelector('#removeAccount');
            step.querySelector('[name=ack]').onchange = (event) => {
                confirm.disabled = !event.target.checked;
            };
            step.querySelector('[name=cancel]').onclick = () =>
                Settings.security(app, box);
            confirm.onclick = () => dbMessenger.deleteDatabaseContent();
        };
    }

    /**
     * Backup
     * @param {Object} app the App
     * @param {HTMLElement} box where to draw
     */
    static async backup(app, box) {
        box.innerHTML = html`<section class="hh-card">
            <label class="hh-label" for="backupPassphrase">
                ${t('Settings.passphrase')}</label>
            <input class="hh-input" id="backupPassphrase" type="password"
                autocomplete="new-password"
                placeholder="${t('Settings.passphraseMin',
        {n: MIN_PASSPHRASE})}">
            <div class="hh-hint" id="passphraseHint">${t(
        'Settings.passphraseMin', {n: MIN_PASSPHRASE})}</div>
            <div class="hh-row buttons">
                <button class="hh-btn hh-primary" id="saveBackup" disabled>
                    ${t('Settings.saveBackup')}</button>
            </div>
            <div class="hh-hint" id="backupResult" role="status"></div>
        </section>
        <p class="muted small">${t('Settings.restoreHow')}</p>`.toString();
        const input = box.querySelector('#backupPassphrase');
        const hint = box.querySelector('#passphraseHint');
        const save = box.querySelector('#saveBackup');
        const result = box.querySelector('#backupResult');
        input.oninput = () => {
            const length = [...input.value].length;
            const ok = length >= MIN_PASSPHRASE;
            save.disabled = !ok;
            hint.dataset.tone = ok ? 'ok' : '';
            hint.textContent = ok ? t('Settings.passphraseOk') :
                t('Settings.passphraseMore', {n: MIN_PASSPHRASE - length});
        };
        input.onkeydown = (event) => {
            if (event.key === 'Enter' && !save.disabled) {
                save.click();
            }
        };
        save.onclick = async () => {
            save.disabled = true;
            result.dataset.tone = '';
            result.textContent = t('Settings.saving');
            try {
                const size = await dbMessenger.saveBackup(input.value);
                result.dataset.tone = 'ok';
                result.textContent = t('Settings.backupSaved',
                    {size: Math.max(1, Math.round(size / 1024))});
                input.value = '';
            } catch (err) {
                result.dataset.tone = 'warn';
                result.textContent = t('Backup.wrongPassphrase');
                save.disabled = false;
            }
        };
    }

    /**
     * Night, day or the computer's choice
     * @param {Object} app the App
     * @param {HTMLElement} box where to draw
     */
    static async appearance(app, box) {
        const choice = app.theme || 'night';
        box.innerHTML = html`<div class="hh-row" role="group"
            aria-label="${t('Settings.appearance')}">
            ${['night', 'day', 'system'].map((name) => html`<button
                class="hh-btn hh-secondary theme" name="theme"
                value="${name}" aria-pressed="${String(name === choice)}">
                ${t('Settings.theme_' + name)}</button>`)}
        </div>
        <p class="muted small">${t('Settings.motion')}</p>`.toString();
        for (const button of box.querySelectorAll('[name=theme]')) {
            button.onclick = async () => {
                app.theme = button.value;
                applyTheme(button.value);
                await dbMessenger.setPreference('theme', button.value);
                for (const other of box.querySelectorAll('[name=theme]')) {
                    other.setAttribute('aria-pressed',
                        String(other === button));
                }
            };
        }
    }

    /**
     * Language
     * @param {Object} app the App
     * @param {HTMLElement} box where to draw
     */
    static async language(app, box) {
        const languages = i18n.languages();
        box.innerHTML = html`<fieldset class="languages">
            <legend class="sr-only">${t('Settings.language')}</legend>
            ${Object.keys(languages).map((code) => html`<label
                class="language" lang="${code}">
                <input type="radio" name="lang" value="${code}"
                    ${code === i18n.selectedLang ? 'checked' : ''}>
                <span>${languages[code]}</span></label>`)}
        </fieldset>`.toString();
        for (const radio of box.querySelectorAll('[name=lang]')) {
            radio.onchange = () => i18n.setLanguage(radio.value);
        }
    }

    /**
     * Blocked addresses
     * @param {Object} app the App
     * @param {HTMLElement} box where to draw
     */
    static async blocked(app, box) {
        const blocked = await dbMessenger.getBlocked();
        box.innerHTML = html`<div class="stack">${blocked.map((entry) =>
            html`<section class="hh-card split" data-key="${entry.address}">
                <div><div class="name">${entry.displayName ||
                shortAddress(entry.address)}</div>
                    <div class="mono muted small">${shortAddress(
        entry.address)}</div></div>
                <button class="hh-btn hh-secondary" name="unblock">
                    ${t('Settings.unblock')}</button>
            </section>`)}
            ${blocked.length ? '' : html`<div class="muted">${
        t('Settings.noneBlocked')}</div>`}</div>`.toString();
        for (const card of box.querySelectorAll('[data-key]')) {
            card.querySelector('[name=unblock]').onclick = async () => {
                await dbMessenger.unblockAddress(card.dataset.key);
                toast(t('Settings.unblocked', {name: displayName(
                    blocked.find((b) => b.address === card.dataset.key))}));
                await Settings.blocked(app, box);
            };
        }
    }

    /**
     * About HexHoot
     * @param {Object} app the App
     * @param {HTMLElement} box where to draw
     */
    static async about(app, box) {
        const {version} = await dbMessenger.getAccountState();
        box.innerHTML = html`<section class="hh-card table">
            <div class="line"><span>${t('Settings.version')}</span>
                <span class="muted">${version}</span></div>
            <div class="line"><span>${t('Settings.follow')}</span>
                <span id="social">${socialLinks.links.map(([image, url]) =>
        html`<button class="social" data-href="${url}"
                    title="${url}"><img src="${getPath(image)}"
                    alt="${image.split('.')[1]}"></button>`)}</span></div>
        </section>
        <p class="muted small" id="copyright">Copyright © 2021-2026 Zenin
            Easa Panthakkalakath. ${t('Settings.license')}</p>`.toString();
        for (const button of box.querySelectorAll('.social')) {
            // Main opens only these links, in the system browser
            button.onclick = () => window.open(button.dataset.href);
        }
    }
}

/**
 * Shrink a photo so that it fits in a message: at most PHOTO_SIZE pixels on
 * its longer side, as JPEG
 * @param {File} file the chosen image
 * @return {Promise<string>} a data: URL
 */
async function shrinkPhoto(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_SIZE / Math.max(bitmap.width,
        bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width,
        canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.85);
}
