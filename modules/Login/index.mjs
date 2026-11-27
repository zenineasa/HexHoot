/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

// The welcome screen: start (a new account, or the same name and password
// on another computer, which gives the same address), restore a backup, or
// unlock when the OS keyring cannot (Linux without a secret service).
// Problems are shown on the page, next to what caused them.

import dbMessenger, {errorCode} from '../DBMessenger/index.mjs';
import i18n from '../I18n/index.mjs';
import {t, logo} from '../UI/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';

const MIN_NAME = 5;
const MIN_PASSWORD = 16;

/**
 * The welcome screen
 */
export default class Login {
    /**
     * Draw it for the account's state
     */
    async render() {
        await loadStyle(new URL('./style.css', import.meta.url));
        const container = document.getElementById('container');
        const {state} = await dbMessenger.getAccountState();
        container.innerHTML = html`<div id="welcome">
            <div class="language-choice">
                <label for="languages" class="sr-only">
                    ${t('I18n.chooseLanguage')}</label>
                <select id="languages" class="hh-input">
                    ${Object.entries(i18n.languages()).map(([code, name]) =>
        html`<option value="${code}">${name}</option>`)}
                </select>
            </div>
            <div class="card">
                <div id="logoWithText">${logo(44)}
                    <span class="text">HexHoot</span></div>
                <div id="login"></div>
            </div>
        </div>`.toString();
        const languages = container.querySelector('#languages');
        languages.value = i18n.selectedLang;
        languages.onchange = () => i18n.setLanguage(languages.value);
        const box = container.querySelector('#login');
        if (state === 'locked') {
            this.renderUnlock(box);
        } else {
            this.renderStart(box);
        }
    }

    /**
     * Start: name and password
     * @param {HTMLElement} box where to draw
     */
    renderStart(box) {
        box.innerHTML = html`
            <h1>${t('Welcome.title')}</h1>
            <p class="muted">${t('Welcome.text')}</p>
            <label class="hh-label" for="displayName">
                ${t('Login.displayName')}</label>
            <input class="hh-input" id="displayName" name="displayName"
                type="text" autocomplete="off" spellcheck="false">
            <label class="hh-label" for="password">
                ${t('Login.password')}</label>
            <div class="password">
                <input class="hh-input" id="password" name="password"
                    type="password" autocomplete="off">
                <button class="hh-btn hh-quiet" name="show"
                    aria-pressed="false">${t('Welcome.show')}</button>
            </div>
            <ul id="requirements">
                <li data-rule="name">${t('Welcome.ruleName',
        {n: MIN_NAME})}</li>
                <li data-rule="length">${t('Welcome.ruleLength',
        {n: MIN_PASSWORD})}</li>
                <li data-rule="notName">${t('Welcome.ruleNotName')}</li>
            </ul>
            <div id="loginStatus" data-state="idle" role="status"></div>
            <button class="hh-btn hh-primary wide" id="loginButton" disabled>
                ${t('Welcome.start')}</button>
            <p class="muted small">${t('Welcome.sameEverywhere')}</p>
            <div class="or muted"><span>${t('Login.or')}</span></div>
            <button class="hh-btn hh-secondary wide" id="loginWithJSONButton">
                ${t('Login.loginUsingBackup')}</button>`.toString();

        const name = box.querySelector('[name=displayName]');
        const password = box.querySelector('[name=password]');
        const button = box.querySelector('#loginButton');
        const status = box.querySelector('#loginStatus');
        const update = () => {
            const okay = this.checkRules(box, name.value, password.value);
            button.disabled = !okay || status.dataset.state === 'working';
            if (status.dataset.state === 'error') {
                this.setStatus(status, 'idle', '');
            }
        };
        name.oninput = update;
        password.oninput = update;
        for (const input of [name, password]) {
            input.onkeydown = (event) => {
                if (event.key === 'Enter' && !button.disabled) {
                    button.click();
                }
            };
        }
        const show = box.querySelector('[name=show]');
        show.onclick = () => {
            const shown = password.type === 'password';
            password.type = shown ? 'text' : 'password';
            show.setAttribute('aria-pressed', String(shown));
            show.textContent = t(shown ? 'Welcome.hide' : 'Welcome.show');
        };
        button.onclick = () => this.start(box, name.value.trim(),
            password.value);
        box.querySelector('#loginWithJSONButton').onclick = async () => {
            const {restored, error} = await dbMessenger.uploadBackup();
            if (restored) {
                window.reload();
            } else if (error) {
                this.setStatus(status, 'error', t(error));
            }
        };
        name.focus();
    }

    /**
     * Mark each requirement met or not
     * @param {HTMLElement} box the form
     * @param {string} name as typed
     * @param {string} password as typed
     * @return {boolean} whether all are met
     */
    checkRules(box, name, password) {
        name = name.trim();
        const rules = {
            name: [...name].length >= MIN_NAME,
            length: [...password].length >= MIN_PASSWORD,
            notName: password !== '' && (name === '' || !password
                .toLowerCase().includes(name.toLowerCase())),
        };
        for (const li of box.querySelectorAll('#requirements li')) {
            li.dataset.ok = String(rules[li.dataset.rule]);
        }
        return Object.values(rules).every(Boolean);
    }

    /**
     * @param {HTMLElement} status the status line
     * @param {string} state idle, working or error
     * @param {string} text what to say
     */
    setStatus(status, state, text) {
        status.dataset.state = state;
        status.textContent = text;
        status.setAttribute('role', state === 'error' ? 'alert' : 'status');
    }

    /**
     * Derive the keys and open the account (several seconds)
     * @param {HTMLElement} box the form
     * @param {string} displayName the name
     * @param {string} password the password
     */
    async start(box, displayName, password) {
        const status = box.querySelector('#loginStatus');
        const button = box.querySelector('#loginButton');
        const {scryptSlow} = await dbMessenger.getAccountState();
        this.setStatus(status, 'working', t(scryptSlow ? 'Login.slow' :
            'Login.working'));
        button.disabled = true;
        try {
            await dbMessenger.writeLoggedInUserInfo({displayName, password});
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
            this.setStatus(status, 'error', code === 'WEAK_CREDENTIALS' &&
                messages[details[0]] ? t(messages[details[0]]) :
                t('Welcome.failed'));
            button.disabled = false;
            return;
        }
        window.reload();
    }

    /**
     * The account is here, but the OS keyring cannot open it: ask for the
     * password
     * @param {HTMLElement} box where to draw
     */
    renderUnlock(box) {
        box.innerHTML = html`
            <h1>${t('Welcome.unlockTitle')}</h1>
            <p class="muted">${t('Login.unlockTitle')}</p>
            <label class="hh-label" for="password">
                ${t('Login.password')}</label>
            <input class="hh-input" id="password" name="password"
                type="password" autocomplete="off">
            <div id="loginStatus" data-state="idle" role="status"></div>
            <button class="hh-btn hh-primary wide" id="unlockButton">
                ${t('Login.unlock')}</button>`.toString();
        const button = box.querySelector('#unlockButton');
        const input = box.querySelector('[name=password]');
        const status = box.querySelector('#loginStatus');
        input.onkeydown = (event) => {
            if (event.key === 'Enter' && !button.disabled) {
                button.click();
            }
        };
        button.onclick = async () => {
            // Unlocking runs scrypt: a few seconds
            button.disabled = true;
            this.setStatus(status, 'working', t('PasswordCheck.checking'));
            try {
                await dbMessenger.unlock(input.value);
                window.reload();
            } catch (err) {
                button.disabled = false;
                this.setStatus(status, 'error', t('Login.wrongPassword'));
                input.select();
            }
        };
        input.focus();
    }

    /**
     * Check if the user is logged in.
     * @return {boolean}
     */
    async isLoggedIn() {
        return (await dbMessenger.getAccountState()).state === 'ready';
    }
}
