/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

import requireText = require('require-text');
import DBMessenger from '../DBMessenger';
const dbMessenger = new DBMessenger();
import I18n from '../I18n';
const i18n = new I18n();

// eslint-disable-next-line no-unused-vars
const Logo = require('./../Logo'); // used in template

/**
 * This class implements the functionality to Login
 */
export default class Login {
    private static _instance: Login;

    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (Login._instance) {
            return Login._instance;
        }
        Login._instance = this;
    }

    /**
     * This function renders the template into the UI.
     */
    render() {
        // Link css
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = __dirname + '/style.css';
        document.body.appendChild(link);

        // Ensure that the CSS is loaded before the HTML is
        link.addEventListener('load', () => {
            // Load the HTML template and insert it to the UI
            const containerDOM = document.getElementById('container') as HTMLElement;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const logo = Logo; // Ensure Logo is referenced for eval if needed or rely on scope
            // Note: eval uses variable from scope. 'Logo' defined above.
            containerDOM.innerHTML = eval('`' +
            requireText('./template.html', require) + '`');

            // Login button
            const loginBtn = document.getElementById('loginButton');
            if(loginBtn) {
                loginBtn.onclick = () => {
                    const info: any = {};
                    const inputs = containerDOM.querySelectorAll(
                        'input[type=text],input[type=password]') as NodeListOf<HTMLInputElement>;
                    for (let i = 0; i < inputs.length; i++) {
                        info[inputs[i].name] = inputs[i].value;
                    }
                    this.validateLoginForm(info);
                    this.doLogin(info);
                };
            }

            // Login with JSON
            const loginJsonBtn = document.getElementById('loginWithJSONButton');
            if(loginJsonBtn) {
                loginJsonBtn.onclick = () => {
                    (async function() {
                        await dbMessenger.uploadDBAsJSON();
                        window.reload();
                    })();
                };
            }
        });
    }

    /**
     * Check if the user is logged in.
     */
    async isLoggedIn() {
        const userInfo = await dbMessenger.getLoggedInUserInfoPrivate();
        if (userInfo) {
            return true;
        }
        return false;
    }

    /**
     * Validate the values entered in the login form.
     * @param {Object} info information extracted from the login form.
     */
    validateLoginForm(info: any) {
        // Validate the password
        if (info.password.length <= 8) {
            const message = i18n.getText('Login.passwordLength');
            alert(message);
            throw new Error(message);
        }

        // Validate the name
        info.displayName = info.displayName.trim();
        if (info.displayName.length <= 4) {
            const message = i18n.getText('Login.minimumCharacters');
            alert(message);
            throw new Error(message);
        }
    }

    /**
     * Log the user in!
     * @param {Object} info information extracted from the login form.
     */
    async doLogin(info: any) {
        await dbMessenger.writeLoggedInUserInfo(info);
        window.reload();
    }
}
