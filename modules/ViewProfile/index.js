/* Copyright (c) 2022-2023 Zenin Easa Panthakkalakath */

const requireText = require('require-text');
const Layout = require('./../Layout');
const imagePack = require('../ImagePack');
// eslint-disable-next-line no-unused-vars
const i18n = require('./../I18n')(); // used in template

/**
 * This class implements the functionality for viewing profile information.
 */
class ViewProfile {
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
    async render(backCallback, userInfo) {
        // Render the layout
        Layout.render();

        // Link css
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = __dirname + '/style.css';
        document.body.appendChild(link);

        // Sidebar related
        const sidebarDOMNode = document.getElementById('sidebar');
        sidebarDOMNode.innerHTML += eval('`' +
            requireText('./template_sidebar.html', require) + '`');
        document.getElementById('backButton').onclick = backCallback;

        // Main content related
        const mainContentDOMNode = document.getElementById('mainContent');
        mainContentDOMNode.innerHTML += eval('`' +
            requireText('./template_mainContent.html', require) + '`');
    }

    /**
     * Get the profile pic
     * @param {string} photo either an empty string or a string that contains
     * the entire image (base64 encoded image, data URL)
     * @return {string} an image that can be used as CSS background URL
     */
    getProfilePic(photo) {
        if (photo) {
            return photo;
        } else {
            return imagePack.getPath('interface.defaultProfilePic');
        }
    }
}

module.exports = new ViewProfile();
