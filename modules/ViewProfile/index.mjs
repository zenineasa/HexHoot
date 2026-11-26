/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

import Layout from '../Layout/index.mjs';
import dbMessenger from '../DBMessenger/index.mjs';
import {getPath} from '../ImagePack/index.mjs';
import {safePhoto} from '../Sanitize/index.mjs';
import i18n from '../I18n/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';

/**
 * This class implements the functionality for viewing profile information.
 */
class ViewProfile {
    /**
     * This function renders the page into the UI.
     * @param {function} backCallback the callback function that is executed
     * when back button is clicked.
     * @param {Object} userInfo Information about the user that is to be
     * displayed
     */
    async render(backCallback, userInfo) {
        await Layout.render();
        await loadStyle(new URL('./style.css', import.meta.url));
        const safetyNumber = await dbMessenger.getSafetyNumber(userInfo.key);

        // Sidebar related
        document.getElementById('sidebar').insertAdjacentHTML('beforeend',
            html`<button class="HexHoot_Button" id="backButton">&larr;
                ${i18n.getText('ViewProfile.back')}</button>`.toString());
        document.getElementById('backButton').onclick = backCallback;

        // Main content related
        document.getElementById('mainContent').innerHTML = html`
            <div id="title">${i18n.getText('ViewProfile.viewProfile')}</div>
            <div id="viewProfile">
                <div class="HexHoot_Input_label">
                    ${i18n.getText('ViewProfile.publicKey')}</div>
                <input class="HexHoot_Input" name="publicKey"
                    value="${userInfo.key}" readonly/>

                <div class="HexHoot_Input_label">
                    ${i18n.getText('ViewProfile.safetyNumber')}</div>
                <div id="safetyNumber" data-testid="safety-number"
                    data-value="${safetyNumber || ''}">
                    ${(safetyNumber || '').split(' ').map((group) =>
        html`<span>${group}</span>`)}
                </div>
                <div class="help">
                    ${i18n.getText('ViewProfile.safetyNumberHelp')}</div>
                <div id="verification"></div>

                <div class="HexHoot_Input_label">
                    ${i18n.getText('ViewProfile.displayName')}</div>
                <input class="HexHoot_Input" name="displayName"
                    value="${userInfo.displayName}" readonly/>

                <div class="HexHoot_Input_label">
                    ${i18n.getText('ViewProfile.aboutPerson')}</div>
                <textarea class="HexHoot_Input" name="about"
                    readonly>${userInfo.about}</textarea>

                <div class="HexHoot_Input_label">
                    ${i18n.getText('ViewProfile.photo')}</div>
                <div class="value">
                    <img src="${this.getProfilePic(userInfo.photo)}"></div>
            </div>`;
        if (safetyNumber) {
            // Fresh from Core: the caller's copy may predate a change
            const contact = await dbMessenger.getUserInfo(userInfo.key);
            this.renderVerification(userInfo.key, Boolean(contact?.verified));
        }
    }

    /**
     * Show whether the user compared safety numbers, with a button to change
     * it
     * @param {string} address the contact
     * @param {boolean} verified whether they are marked verified
     */
    renderVerification(address, verified) {
        const box = document.getElementById('verification');
        box.dataset.verified = String(verified);
        const button = document.createElement('button');
        button.className = 'HexHoot_Button';
        button.name = 'verify';
        button.textContent = i18n.getText(verified ?
            'ViewProfile.unmarkVerified' : 'ViewProfile.markVerified');
        button.onclick = async () => {
            await dbMessenger.setVerified(address, !verified);
            this.renderVerification(address, !verified);
        };
        box.replaceChildren();
        if (verified) {
            const note = document.createElement('div');
            note.className = 'note';
            note.textContent = i18n.getText('ViewProfile.verified');
            box.appendChild(note);
        }
        box.appendChild(button);
    }

    /**
     * Get the profile pic
     * @param {string} photo either an empty string or a string that contains
     * the entire image (base64 encoded image, data URL)
     * @return {string} an image URL
     */
    getProfilePic(photo) {
        return safePhoto(photo) || getPath('interface.defaultProfilePic');
    }
}

export default new ViewProfile();
