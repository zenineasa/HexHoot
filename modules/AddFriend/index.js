/* Copyright (c) 2022 Zenin Easa Panthakkalakath */

const requireText = require('require-text');
const Layout = require('./../Layout');
const dbMessenger = require('./../DBMessenger')();

// eslint-disable-next-line no-unused-vars
const i18n = require('./../I18n')(); // used in template

/**
 * This class implements the functionality for adding a friend
 */
class AddFriend {
    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (AddFriend._instance) {
            return AddFriend._instance;
        }
        AddFriend._instance = this;
        AddFriend._instance.initialize();
    }

    /**
     * Initialize Add friend
     */
    initialize() {
        // If there is something to do...
    }

    /**
     * This function renders the template into the UI.
     * @param {function} backCallback the callback function that is executed
     * when back button is clicked
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
        const publicKey = await dbMessenger.getPublicKeyOfLoggedInUser();

        // Sidebar related
        const sidebarDOMNode = document.getElementById('sidebar');
        sidebarDOMNode.innerHTML += eval('`' +
            requireText('./template_sidebar.html', require) + '`');
        document.getElementById('backButton').onclick = backCallback;

        // Main content related
        const mainContentDOMNode = document.getElementById('mainContent');
        mainContentDOMNode.innerHTML += eval('`' +
            requireText('./template_mainContent.html', require) + '`');

        const tabDOMNodes = document.getElementById('mainContent')
            .getElementsByClassName('tab');
        for (let i = 0; i < tabDOMNodes.length; i++) {
            tabDOMNodes[i].onclick = function() {
                const tabName = this.getAttribute('name');
                const tabContents = document.getElementById('mainContent')
                    .getElementsByClassName('tabContent');
                for (let i = 0; i < tabContents.length; i++) {
                    if (tabContents[i].id == tabName) {
                        tabContents[i].style.display = 'flex';
                    } else {
                        tabContents[i].style.display = 'none';
                    }
                }
            };
        }

        // Button callback
        document.getElementById('copyToClipboardButton').onclick = function() {
            navigator.clipboard.writeText(publicKey);
        };
        document.getElementById('addFriendButton').onclick = function() {
            const key = document.getElementById('theirPublicKey').value;
            const otherUserInfo = {key: key};
            dbMessenger.sendRequestOrResponse(
                otherUserInfo, dbMessenger.messageType.friendRequest);
            dbMessenger.updateFriendInformation(otherUserInfo);
            backCallback();
        };
    }
}

module.exports = function() {
    return new AddFriend();
};
