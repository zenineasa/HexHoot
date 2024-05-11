/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

const requireText = require('require-text');
const dbMessenger = require('./../DBMessenger')();
const i18n = require('./../I18n')();

// eslint-disable-next-line no-unused-vars
const Logo = require('./../Logo'); // used in template

/**
 * This class implements the functionality to Login
 */
class Login {
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
        link.addEventListener('load', function() {
            // Load the HTML template and insert it to the UI
            const containerDOM = document.getElementById('container');
            containerDOM.innerHTML = eval('`' +
            requireText('./template.html', require) + '`');

            // Login button
            document.getElementById('loginButton').onclick = function() {
                const info = {};
                const inputs = containerDOM.querySelectorAll(
                    'input[type=text],input[type=password]');
                for (let i = 0; i < inputs.length; i++) {
                    info[inputs[i].name] = inputs[i].value;
                }
                this.validateLoginForm(info);
                this.doLogin(info);
            }.bind(this);

            // Login with JSON
            document.getElementById('loginWithJSONButton').onclick =
                function() {
                    (async function() {
                        await dbMessenger.uploadDBAsJSON();
                        window.reload();
                    })();
                };
        }.bind(this));
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
    validateLoginForm(info) {
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
    async doLogin(info) {
        await dbMessenger.writeLoggedInUserInfo(info);
        window.reload();
    }
}

module.exports = function() {
    return new Login();
};
