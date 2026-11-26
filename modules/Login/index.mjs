/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

import dbMessenger, {errorCode} from '../DBMessenger/index.mjs';
import i18n from '../I18n/index.mjs';
import Logo from '../Logo/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';

/**
 * This class implements the functionality to Login
 */
export default class Login {
    /**
     * This function renders the login form into the UI.
     */
    async render() {
        await Promise.all([
            loadStyle(new URL('./style.css', import.meta.url)),
            Logo.ready(),
        ]);
        const containerDOM = document.getElementById('container');
        if ((await dbMessenger.getAccountState()).state === 'locked') {
            this.renderUnlock(containerDOM);
            return;
        }
        containerDOM.innerHTML = html`<div>
            ${Logo.getHTML()}
            <div id="login">
                <input class="HexHoot_Input" name="displayName" type="text"
                    placeholder="${i18n.getText('Login.displayName')}" />
                <input class="HexHoot_Input" name="password" type="password"
                    placeholder="${i18n.getText('Login.password')}" />
                <button class="HexHoot_Button" id="loginButton">
                    ${i18n.getText('Login.login')}</button>
                <div id="loginStatus" data-state="idle"></div>
                <div>${i18n.getText('Login.or')}</div>
                <button class="HexHoot_Button" id="loginWithJSONButton">
                    ${i18n.getText('Login.loginUsingBackup')}</button>
            </div>
        </div>`;

        // Login button
        document.getElementById('loginButton').onclick = () => {
            const info = {};
            const inputs = containerDOM.querySelectorAll(
                'input[type=text],input[type=password]');
            for (const input of inputs) {
                info[input.name] = input.value;
            }
            if (this.validateLoginForm(info)) {
                this.doLogin(info);
            }
        };

        // Restore a backup
        document.getElementById('loginWithJSONButton').onclick = async () => {
            if (await dbMessenger.uploadBackup()) {
                window.reload();
            }
        };
    }

    /**
     * The account is here, but the OS keyring cannot open it (Linux without
     * a secret service): ask for the password
     * @param {HTMLElement} containerDOM where to render
     */
    renderUnlock(containerDOM) {
        containerDOM.innerHTML = html`<div>
            ${Logo.getHTML()}
            <div id="login">
                <div>${i18n.getText('Login.unlockTitle')}</div>
                <input class="HexHoot_Input" name="password" type="password"
                    placeholder="${i18n.getText('Login.password')}" />
                <button class="HexHoot_Button" id="unlockButton">
                    ${i18n.getText('Login.unlock')}</button>
            </div>
        </div>`;
        document.getElementById('unlockButton').onclick = async () => {
            try {
                await dbMessenger.unlock(containerDOM
                    .querySelector('[name=password]').value);
                window.reload();
            } catch (err) {
                alert(i18n.getText('Login.wrongPassword'));
            }
        };
    }

    /**
     * Check if the user is logged in.
     * @return {boolean}
     */
    async isLoggedIn() {
        return (await dbMessenger.getAccountState()).state === 'ready';
    }

    /**
     * Validate the values entered in the login form; tell the user if they
     * are not acceptable.
     * @param {Object} info information extracted from the login form.
     * @return {boolean} whether the values are acceptable
     */
    validateLoginForm(info) {
        // Core checks everything; these quick checks save a round trip
        if ([...info.password].length < 16) {
            alert(i18n.getText('Login.passwordLength'));
            return false;
        }
        info.displayName = info.displayName.trim();
        if ([...info.displayName].length < 5) {
            alert(i18n.getText('Login.minimumCharacters'));
            return false;
        }
        return true;
    }

    /**
     * Log the user in!
     * @param {Object} info information extracted from the login form.
     */
    async doLogin(info) {
        const status = document.getElementById('loginStatus');
        const button = document.getElementById('loginButton');
        const {scryptSlow} = await dbMessenger.getAccountState();
        status.textContent = i18n.getText(scryptSlow ? 'Login.slow' :
            'Login.working');
        status.dataset.state = 'working';
        button.disabled = true;
        try {
            await dbMessenger.writeLoggedInUserInfo(info);
        } catch (err) {
            const {code, details} = errorCode(err);
            const messages = {
                passwordTooShort: 'Login.passwordLength',
                passwordTooLong: 'Login.passwordLength',
                passwordContainsName: 'Login.passwordContainsName',
                passwordRepetitive: 'Login.passwordRepetitive',
                nameTooShort: 'Login.minimumCharacters',
                nameTooLong: 'Login.nameTooLong',
            };
            status.textContent = '';
            status.dataset.state = 'idle';
            button.disabled = false;
            alert(code === 'WEAK_CREDENTIALS' && messages[details[0]] ?
                i18n.getText(messages[details[0]]) : String(err.message));
            return;
        }
        window.reload();
    }
}
