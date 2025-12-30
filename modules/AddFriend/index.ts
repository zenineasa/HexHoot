/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

import requireText = require('require-text');
import Layout from '../Layout';
import DBMessenger from '../DBMessenger';
import I18n from '../I18n';

const dbMessenger = new DBMessenger();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const i18n = new I18n(); // used in template

/**
 * This class implements the functionality for adding a friend
 */
export default class AddFriend {
    private static _instance: AddFriend;
    private numTimesInvoked: number;

    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (AddFriend._instance) {
            return AddFriend._instance;
        }
        AddFriend._instance = this;
        this.initialize();
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
    async render(backCallback: () => void) {
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
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        const linkOnLoadCallback = function() {
            // This should be invoked only once
            link.removeEventListener('load', linkOnLoadCallback);

            self.numTimesInvoked += 1;
            console.log(self.numTimesInvoked);

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

            const mainContent = document.getElementById('mainContent');
            if(mainContent){
                const tabDOMNodes = (mainContent.getElementsByClassName('tab')) as HTMLCollectionOf<HTMLElement>;
                for (let i = 0; i < tabDOMNodes.length; i++) {
                    tabDOMNodes[i].onclick = function(this: HTMLElement) {
                        const tabName = this.getAttribute('name');
                        const tabContents = mainContent.getElementsByClassName('tabContent') as HTMLCollectionOf<HTMLElement>;
                        for (let j = 0; j < tabContents.length; j++) {
                            if (tabContents[j].id == tabName) {
                                tabContents[j].style.display = 'flex';
                            } else {
                                tabContents[j].style.display = 'none';
                            }
                        }
                    };
                }
            }

            // Button callback
            const copyBtn = document.getElementById('copyToClipboardButton');
            if(copyBtn) {
                copyBtn.onclick = function() {
                    navigator.clipboard.writeText(publicKey);
                };
            }
            const addFriendBtn = document.getElementById('addFriendButton');
            if(addFriendBtn) {
                addFriendBtn.onclick = function() {
                    const key = (document.getElementById('theirPublicKey') as HTMLInputElement).value;
                    const otherUserInfo = {key: key};
                    dbMessenger.sendRequestOrResponse(
                        otherUserInfo, 'FriendRequest'); // Assuming string literal if enum not exported or accessible
                    dbMessenger.updateFriendInformation(otherUserInfo);
                    backCallback();
                };
            }
        };
        link.addEventListener('load', linkOnLoadCallback);
    }
}
