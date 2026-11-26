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
     */
    static async render() {
        if (document.getElementById(BOX_ID) ||
            !(await dbMessenger.getPasswordCheck()).due) {
            return;
        }
        await loadStyle(new URL('./style.css', import.meta.url));
        if (document.getElementById(BOX_ID)) {
            return;
        }
        const box = document.createElement('div');
        box.id = BOX_ID;
        box.setAttribute('role', 'status');
        box.innerHTML = html`
            <div class="title">${i18n.getText('PasswordCheck.title')}</div>
            <div class="text">${i18n.getText('PasswordCheck.text')}</div>
            <input class="HexHoot_Input" name="password" type="password"
                autocomplete="off"
                placeholder="${i18n.getText('Login.password')}" />
            <div class="buttons">
                <button class="HexHoot_Button" name="check">
                    ${i18n.getText('PasswordCheck.check')}</button>
                <button class="HexHoot_Button" name="later">
                    ${i18n.getText('PasswordCheck.later')}</button>
            </div>`.toString();
        document.body.appendChild(box);

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
        text.textContent = i18n.getText(!result.correct ?
            'PasswordCheck.wrong' : result.afterMiss ?
                'PasswordCheck.rightAfterMiss' : 'PasswordCheck.right');
        const close = document.createElement('button');
        close.className = 'HexHoot_Button';
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
