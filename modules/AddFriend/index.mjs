/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

import Layout from '../Layout/index.mjs';
import dbMessenger from '../DBMessenger/index.mjs';
import * as sanitize from '../Sanitize/index.mjs';
import i18n from '../I18n/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';

/**
 * This class implements the functionality for adding a friend
 */
class AddFriend {
    /**
     * This function renders the page into the UI.
     * @param {function} backCallback the callback function that is executed
     * when back button is clicked
     */
    async render(backCallback) {
        await Layout.render();
        await loadStyle(new URL('./style.css', import.meta.url));
        const publicKey = await dbMessenger.getPublicKeyOfLoggedInUser();

        // Sidebar related
        document.getElementById('sidebar').insertAdjacentHTML('beforeend',
            html`<button class="HexHoot_Button" id="backButton">&larr;
                ${i18n.getText('AddFriend.back')}</button>`.toString());
        document.getElementById('backButton').onclick = backCallback;

        // Main content related
        const keyPlaceholder = i18n.getText('AddFriend.publicKey');
        const mainContentDOMNode = document.getElementById('mainContent');
        mainContentDOMNode.innerHTML = html`
            <div id="title">Add friend</div>
            <div id="tabs">
                <div class="tabContentContainer">
                    <div class="tabContent" id="myCode">
                        <input class="HexHoot_Input" name="myPublicKey"
                            type="text" value="${publicKey}" readonly />
                        <button class="HexHoot_Button"
                            id="copyToClipboardButton">
                            ${i18n.getText('AddFriend.copyToClipboard')}
                        </button>
                    </div>
                    <div class="tabContent" id="theirCode">
                        <input class="HexHoot_Input" id="theirPublicKey"
                            name="theirPublicKey" type="text"
                            placeholder="${keyPlaceholder}" />
                        <button class="HexHoot_Button" id="addFriendButton">
                            ${i18n.getText('AddFriend.add')}</button>
                    </div>
                </div>
                <div class="tabContainer">
                    <div class="tab" name="myCode">
                        ${i18n.getText('AddFriend.myCode')}</div>
                    <div class="tab" name="theirCode">
                        ${i18n.getText('AddFriend.theirCode')}</div>
                </div>
            </div>`;

        for (const tab of mainContentDOMNode.getElementsByClassName('tab')) {
            tab.onclick = function() {
                const tabName = this.getAttribute('name');
                for (const content of mainContentDOMNode
                    .getElementsByClassName('tabContent')) {
                    content.style.display =
                        content.id === tabName ? 'flex' : 'none';
                }
            };
        }

        // Button callback
        document.getElementById('copyToClipboardButton').onclick = () => {
            navigator.clipboard.writeText(publicKey);
        };
        document.getElementById('addFriendButton').onclick = async () => {
            const key = document.getElementById('theirPublicKey').value.trim();
            if (!sanitize.isValidKey(key) || key === publicKey) {
                alert(i18n.getText('AddFriend.invalidKey'));
                return;
            }
            const otherUserInfo = {key: key};
            const pending = await dbMessenger.getPendingFriendRequests();
            if (pending[key]) {
                // They had already sent us a request; accept it
                await dbMessenger.acceptFriendRequest(key);
            } else {
                await dbMessenger.updateFriendInformation(otherUserInfo);
            }
            dbMessenger.sendRequestOrResponse(
                otherUserInfo, dbMessenger.messageType.friendRequest);
            backCallback();
        };
    }
}

export default new AddFriend();
