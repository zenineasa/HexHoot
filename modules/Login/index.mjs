/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

import dbMessenger from '../DBMessenger/index.mjs';
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
        containerDOM.innerHTML = html`<div>
            ${Logo.getHTML()}
            <div id="login">
                <input class="HexHoot_Input" name="displayName" type="text"
                    placeholder="${i18n.getText('Login.displayName')}" />
                <input class="HexHoot_Input" name="password" type="password"
                    placeholder="${i18n.getText('Login.password')}" />
                <button class="HexHoot_Button" id="loginButton">
                    ${i18n.getText('Login.login')}</button>
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

        // Login with JSON
        document.getElementById('loginWithJSONButton').onclick = async () => {
            await dbMessenger.uploadDBAsJSON();
            window.reload();
        };
    }

    /**
     * Check if the user is logged in.
     * @return {boolean}
     */
    async isLoggedIn() {
        return Boolean(await dbMessenger.getPublicKeyOfLoggedInUser());
    }

    /**
     * Validate the values entered in the login form; tell the user if they
     * are not acceptable.
     * @param {Object} info information extracted from the login form.
     * @return {boolean} whether the values are acceptable
     */
    validateLoginForm(info) {
        // Validate the password
        if (info.password.length <= 8) {
            alert(i18n.getText('Login.passwordLength'));
            return false;
        }

        // Validate the name
        info.displayName = info.displayName.trim();
        if (info.displayName.length <= 4) {
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
        await dbMessenger.writeLoggedInUserInfo(info);
        window.reload();
    }
}
