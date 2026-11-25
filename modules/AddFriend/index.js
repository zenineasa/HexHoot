/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

const readText = require('./../ReadText');
const Layout = require('./../Layout');
const dbMessenger = require('./../DBMessenger')();
const sanitize = require('./../Sanitize');

const i18n = require('./../I18n')();

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
        this.numTimesInvoked = 0;
    }

    /**
     * This function renders the template into the UI.
     * @param {function} backCallback the callback function that is executed
     * when back button is clicked
     */
    async render(backCallback) {
        // Render the layout
        await Layout.render();

        // Get user info from database, which will be used by the template
        const publicKey = await dbMessenger.getPublicKeyOfLoggedInUser();

        // Link css
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = __dirname + '/style.css';
        document.body.appendChild(link);

        // Ensure that the CSS is loaded before the HTML is
        const linkOnLoadCallback = function() {
            // This should be invoked only once
            link.removeEventListener('load', linkOnLoadCallback);

            this.numTimesInvoked += 1;
            console.log(this.numTimesInvoked);

            // Sidebar related
            const sidebarDOMNode = document.getElementById('sidebar');
            sidebarDOMNode.innerHTML += eval('`' +
                readText(__dirname, './template_sidebar.html') + '`');
            document.getElementById('backButton').onclick = backCallback;

            // Main content related
            const mainContentDOMNode = document.getElementById('mainContent');
            mainContentDOMNode.innerHTML += eval('`' +
                readText(__dirname, './template_mainContent.html') + '`');

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
            document.getElementById('copyToClipboardButton').onclick =
                function() {
                    navigator.clipboard.writeText(publicKey);
                };
            document.getElementById('addFriendButton').onclick =
                async function() {
                    const key = document.getElementById('theirPublicKey')
                        .value.trim();
                    if (!sanitize.isValidKey(key) || key === publicKey) {
                        alert(i18n.getText('AddFriend.invalidKey'));
                        return;
                    }
                    const otherUserInfo = {key: key};
                    const pending =
                        await dbMessenger.getPendingFriendRequests();
                    if (pending[key]) {
                        // They had already sent us a request; accept it
                        await dbMessenger.acceptFriendRequest(key);
                    } else {
                        await dbMessenger.updateFriendInformation(
                            otherUserInfo);
                    }
                    dbMessenger.sendRequestOrResponse(
                        otherUserInfo, dbMessenger.messageType.friendRequest);
                    backCallback();
                };
        }.bind(this);
        link.addEventListener('load', linkOnLoadCallback);
    }
}

module.exports = function() {
    return new AddFriend();
};
