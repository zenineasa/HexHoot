/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Now and then, a small box in the corner asks whether the user still
// remembers their password (ADR-004). It never blocks anything: the user can
// ignore it, dismiss it, or answer it. The answer only says right or wrong.

import dbMessenger from '../DBMessenger/index.mjs';
import i18n from '../I18n/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';

const BOX_ID = 'passwordCheck';

/**
 * The password check box
 */
export default class PasswordCheck {
    /**
     * Show the box if a check is due and it is not already showing
     * @param {Object} [options] {force: show it even if no check is due
     * (Settings, "Check now")}
     */
    static async render({force = false} = {}) {
        if (document.getElementById(BOX_ID) ||
            (!force && !(await dbMessenger.getPasswordCheck()).due)) {
            document.querySelector(`#${BOX_ID} input`)?.focus();
            return;
        }
        await loadStyle(new URL('./style.css', import.meta.url));
        if (document.getElementById(BOX_ID)) {
            return;
        }
        const box = document.createElement('div');
        box.id = BOX_ID;
        box.setAttribute('role', 'region');
        box.setAttribute('aria-label', i18n.getText('PasswordCheck.title'));
        box.className = 'slide-in';
        box.innerHTML = html`
            <div class="title">${i18n.getText('PasswordCheck.title')}</div>
            <div class="text">${i18n.getText('PasswordCheck.text')}</div>
            <input class="hh-input" name="password" type="password"
                autocomplete="off"
                aria-label="${i18n.getText('Login.password')}"
                placeholder="${i18n.getText('Login.password')}" />
            <div class="buttons">
                <button class="hh-btn hh-quiet" name="later">
                    ${i18n.getText('PasswordCheck.later')}</button>
                <button class="hh-btn hh-primary" name="check">
                    ${i18n.getText('PasswordCheck.check')}</button>
            </div>`.toString();
        document.body.appendChild(box);
        if (force) {
            box.querySelector('[name=password]').focus();
        }

        const input = box.querySelector('[name=password]');
        const check = box.querySelector('[name=check]');
        box.querySelector('[name=later]').onclick = async () => {
            box.remove();
            await dbMessenger.skipPasswordCheck();
        };
        check.onclick = () => PasswordCheck.check(box, input);
        input.onkeydown = (event) => {
            if (event.key === 'Enter' && !check.disabled) {
                PasswordCheck.check(box, input);
            }
        };
    }

    /**
     * Check the typed password and show how it went
     * @param {HTMLElement} box the box
     * @param {HTMLInputElement} input the password field
     */
    static async check(box, input) {
        const password = input.value;
        if (!password) {
            input.focus();
            return;
        }
        // The check runs the full key derivation: a few seconds
        input.value = '';
        input.disabled = true;
        box.querySelector('.buttons').replaceChildren();
        const text = box.querySelector('.text');
        text.textContent = i18n.getText('PasswordCheck.checking');
        box.dataset.state = 'checking';

        let result;
        try {
            result = await dbMessenger.checkPassword(password);
        } catch (err) {
            // Signed out meanwhile, or Core failed: nothing to tell
            box.remove();
            return;
        }
        input.remove();
        box.dataset.state = result.correct ? 'right' : 'wrong';
        box.querySelector('.title').textContent = i18n.getText(
            result.correct ? 'PasswordCheck.rightTitle' :
                'PasswordCheck.wrongTitle');
        text.textContent = i18n.getText(!result.correct ?
            'PasswordCheck.wrong' : result.afterMiss ?
                'PasswordCheck.rightAfterMiss' : 'PasswordCheck.right');
        const close = document.createElement('button');
        close.className = 'hh-btn hh-secondary';
        close.name = 'close';
        close.textContent = i18n.getText('PasswordCheck.close');
        close.onclick = () => box.remove();
        box.querySelector('.buttons').appendChild(close);
    }

    /** Take the box away (on signing out) */
    static remove() {
        document.getElementById(BOX_ID)?.remove();
    }
}
