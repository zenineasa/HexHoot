/* Copyright (c) 2022-2025 Zenin Easa Panthakkalakath */

import requireText = require('require-text');
import Layout from '../Layout';
import * as imagePack from '../ImagePack';
import DBMessenger from '../DBMessenger';
import I18n from '../I18n';

const dbMessenger = new DBMessenger();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const i18n = new I18n();

/**
 * This class implements the functionality for editing profile information.
 */
export default class EditProfile {
    private static _instance: EditProfile;

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
    async render(backCallback: () => void) {
        // Render the layout
        await Layout.render();

        // Get user info from database, which will be used by the template
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const userInfo = await dbMessenger.getLoggedInUserInfoPrivate();
        // The evaluate used below requires userInfo, imagePack, i18n
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const imagePack = require('../ImagePack');

        // Link css
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = __dirname + '/style.css';
        document.body.appendChild(link);

        // Ensure that the CSS is loaded before the HTML is
        link.addEventListener('load', () => {
            // Sidebar related
            const sidebarDOMNode = document.getElementById('sidebar');
            if (sidebarDOMNode) {
                sidebarDOMNode.innerHTML += eval('`' +
                    requireText('./template_sidebar.html', require) + '`');
            }
            const backBtn = document.getElementById('backButton')
            if (backBtn) backBtn.onclick = backCallback;

            // Main content related
            const mainContentDOMNode = document.getElementById('mainContent');
            if (mainContentDOMNode) {
                mainContentDOMNode.innerHTML += eval('`' +
                    requireText('./template_mainContent.html', require) + '`');

                // Button callbacks
                const editBtn = document.getElementById('editButton');
                if (editBtn) {
                    editBtn.onclick = async () => {
                        const info: any = {};
                        const inputs =
                            mainContentDOMNode.getElementsByClassName('HexHoot_Input') as HTMLCollectionOf<HTMLInputElement>;
                        for (let i = 0; i < inputs.length; i++) {
                            if (inputs[i].name === 'photo') {
                                // If there is a photo being uploaded
                                if (inputs[i].files && inputs[i].files.length !== 0) {
                                    const reader = new FileReader();
                                    reader.readAsDataURL(inputs[i].files[0]);

                                    await new Promise((resolve, reject) => {
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
                        await dbMessenger.writeLoggedInUserInfo(info);
                        backCallback(); // Just to give the users a sense of feedback
                    };
                }
            }

            const dpBtn = document.getElementById('downloadProfile');
            if(dpBtn) {
                dpBtn.onclick = function() {
                    dbMessenger.downloadDBAsJSON();
                };
            }
            const logoutBtn = document.getElementById('logout');
            if(logoutBtn) {
                logoutBtn.onclick = function() {
                    const confirmMessage =
                        i18n.getText('EditProfile.logoutConfirmation');
                    if (confirm(confirmMessage) == true) {
                        dbMessenger.deleteDatabaseContent();
                        window.reload();
                    }
                };
            }

            // Privatekey toggle callbacks
            const privateKeyDOM = document.querySelector('[name=privateKey]') as HTMLInputElement;
            if (privateKeyDOM) {
                privateKeyDOM.onfocus = function() {
                    privateKeyDOM.type = 'text';
                };
                privateKeyDOM.onblur = function() {
                    privateKeyDOM.type = 'password';
                };
            }
        });
    }

    /**
     * This function renders the profile icon to the icon bar. The profile icon
     * links to the page wherein the user can edit their own profile.
     * @param {function} clickCallback the callback function that is executed
     * when the icon is clicked.
     */
    async renderToIconBar(clickCallback: () => void) {
        // For profile photo on the icon; used in the template file
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const info = await dbMessenger.getLoggedInUserInfoPrivate();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const imagePack = require('../ImagePack');

        const holderDOM = document.createElement('div');
        holderDOM.innerHTML = eval('`' +
            requireText('./template_iconbar.html', require) + '`');

        const iconDOMNode = holderDOM.querySelector('#ownProfilePic') as HTMLElement;
        if (iconDOMNode) {
            iconDOMNode.onclick = () => {
                this.render(clickCallback);
            };
        }

        const iconBarDOMNode = document.getElementById('iconbar');
        if (iconBarDOMNode) {
            iconBarDOMNode.appendChild(holderDOM);
        }
    }
}
