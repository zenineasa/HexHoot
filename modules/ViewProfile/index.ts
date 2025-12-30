/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

import requireText = require('require-text');
import Layout from '../Layout';
import * as imagePack from '../ImagePack';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import I18n from '../I18n';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const i18n = new I18n();

/**
 * This class implements the functionality for viewing profile information.
 */
export default class ViewProfile {
    private static _instance: ViewProfile;

    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (ViewProfile._instance) {
            return ViewProfile._instance;
        }
        ViewProfile._instance = this;
    }

    /**
     * This function renders the template into the UI.
     * @param {function} backCallback the callback function that is executed
     * when back button is clicked.
     * @param {function} userInfo Information about the user that is to be
     * displayed
     */
    async render(backCallback: () => void, userInfo: any) {
        // Render the layout
        await Layout.render();

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
            const backBtn = document.getElementById('backButton');
            if(backBtn) backBtn.onclick = backCallback;

            // Main content related
            const mainContentDOMNode = document.getElementById('mainContent');
            if (mainContentDOMNode) {
                mainContentDOMNode.innerHTML += eval('`' +
                    requireText('./template_mainContent.html', require) + '`');
            }
        });
    }

    /**
     * Get the profile pic
     * @param {string} photo either an empty string or a string that contains
     * the entire image (base64 encoded image, data URL)
     * @return {string} an image that can be used as CSS background URL
     */
    getProfilePic(photo: string | null | undefined) {
        if (photo) {
            return photo;
        } else {
            return imagePack.getPath('interface.defaultProfilePic');
        }
    }
}
