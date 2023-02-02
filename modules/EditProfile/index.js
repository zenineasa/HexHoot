/* Copyright (c) 2022-2023 Zenin Easa Panthakkalakath */

const requireText = require('require-text');
const Layout = require('./../Layout');
const dbMessenger = require('./../DBMessenger')();
// eslint-disable-next-line no-unused-vars
const imagePack = require('../ImagePack'); // used in template
const i18n = require('./../I18n')();

/**
 * This class implements the functionality for editing profile information.
 */
class EditProfile {
    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (EditProfile._instance) {
            return EditProfile._instance;
        }
        EditProfile._instance = this;
    }

    /**
     * This function renders the template into the UI.
     * @param {function} backCallback the callback function that is executed
     * when back button is clicked.
     */
    async render(backCallback) {
        // Render the layout
        Layout.render();

        // Link css
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = __dirname + '/style.css';
        document.body.appendChild(link);

        // Get user info from database, which will be used by the template
        // eslint-disable-next-line no-unused-vars
        const userInfo = await dbMessenger.getLoggedInUserInfoPrivate();

        // Sidebar related
        const sidebarDOMNode = document.getElementById('sidebar');
        sidebarDOMNode.innerHTML += eval('`' +
            requireText('./template_sidebar.html', require) + '`');
        document.getElementById('backButton').onclick = backCallback;

        // Main content related
        const mainContentDOMNode = document.getElementById('mainContent');
        mainContentDOMNode.innerHTML += eval('`' +
            requireText('./template_mainContent.html', require) + '`');

        // Button callbacks
        document.getElementById('editButton').onclick = async function() {
            const info = {};
            const inputs = mainContentDOMNode.getElementsByClassName('input');
            for (let i = 0; i < inputs.length; i++) {
                if (inputs[i].name === 'photo') {
                    // If there is a photo being uploaded
                    if (inputs[i].files.length !== 0) {
                        const reader = new FileReader();
                        reader.readAsDataURL(inputs[i].files[0]);

                        await new Promise(function(resolve, reject) {
                            reader.onload = function() {
                                resolve('Image loaded');
                            };
                            reader.onerror = function() {
                                reject(new Error('Error loading image'));
                            };
                        });

                        info[inputs[i].name] = reader.result;
                    }
                } else {
                    info[inputs[i].name] = inputs[i].value;
                }
            }
            dbMessenger.writeLoggedInUserInfo(info);
            backCallback(); // Just to give the users a sense of feedback
        };
        document.getElementById('downloadProfile').onclick = function() {
            dbMessenger.downloadDBAsJSON();
        };
        document.getElementById('logout').onclick = function() {
            const confirmMessage =
                i18n.getText('EditProfile.logoutConfirmation');
            if (confirm(confirmMessage) == true) {
                dbMessenger.deleteDatabaseContent();
                window.reload();
            }
        };

        // Privatekey toggle callbacks
        const privateKeyDOM = document.querySelector('[name=privateKey]');
        privateKeyDOM.onfocus = function() {
            privateKeyDOM.type = 'text';
        };
        privateKeyDOM.onblur = function() {
            privateKeyDOM.type = 'password';
        };
    }

    /**
     * This function renders the profile icon to the icon bar. The profile icon
     * links to the page wherein the user can edit their own profile.
     * @param {function} clickCallback the callback function that is executed
     * when the icon is clicked.
     */
    async renderToIconBar(clickCallback) {
        // For profile photo on the icon; used in the template file
        // eslint-disable-next-line no-unused-vars
        const info = await dbMessenger.getLoggedInUserInfoPrivate();

        const holderDOM = document.createElement('div');
        holderDOM.innerHTML = eval('`' +
            requireText('./template_iconbar.html', require) + '`');

        const iconDOMNode = holderDOM.querySelector('#ownProfilePic');
        iconDOMNode.onclick = function() {
            this.render(clickCallback);
        }.bind(this);

        const iconBarDOMNode = document.getElementById('iconbar');
        iconBarDOMNode.appendChild(holderDOM);
    }
}

module.exports = new EditProfile();
