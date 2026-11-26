/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

import Layout from '../Layout/index.mjs';
import dbMessenger from '../DBMessenger/index.mjs';
import {getPath} from '../ImagePack/index.mjs';
import {safePhoto} from '../Sanitize/index.mjs';
import i18n from '../I18n/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';

/**
 * This class implements the functionality for editing profile information.
 */
class EditProfile {
    /**
     * This function renders the page into the UI.
     * @param {function} backCallback the callback function that is executed
     * when back button is clicked.
     */
    async render(backCallback) {
        await Layout.render();
        await loadStyle(new URL('./style.css', import.meta.url));
        const userInfo = await dbMessenger.getLoggedInUserInfoPublic();

        // Sidebar related
        document.getElementById('sidebar').insertAdjacentHTML('beforeend',
            html`<button class="HexHoot_Button" id="backButton">&larr;
                ${i18n.getText('EditProfile.back')}</button>`.toString());
        document.getElementById('backButton').onclick = backCallback;

        // Main content related
        const mainContentDOMNode = document.getElementById('mainContent');
        mainContentDOMNode.innerHTML = html`
            <div id="title">${i18n.getText('EditProfile.editProfile')}</div>
            <div id="editProfile">
                <div class="HexHoot_Input_label">
                    ${i18n.getText('EditProfile.displayName')}</div>
                <input class="HexHoot_Input" name="displayName" type="text"
                    value="${userInfo.displayName}"/>

                <div class="HexHoot_Input_label">
                    ${i18n.getText('EditProfile.aboutYou')}</div>
                <textarea class="HexHoot_Input" name="about"
                    >${userInfo.about}</textarea>

                <div class="HexHoot_Input_label">
                    ${i18n.getText('EditProfile.photo')}</div>
                <input class="HexHoot_Input" name="photo" type="file"
                    accept="image/png,image/jpeg,image/webp"/>

                <button class="HexHoot_Button" id="editButton">
                    ${i18n.getText('EditProfile.applyEdit')}</button>
                <button class="HexHoot_Button" id="downloadProfile">
                    ${i18n.getText('EditProfile.downloadProfile')}</button>
                <button class="HexHoot_Button" id="logout">
                    ${i18n.getText('EditProfile.logout')}</button>
            </div>`;

        // Button callbacks
        document.getElementById('editButton').onclick = async () => {
            const info = {};
            const inputs =
                mainContentDOMNode.getElementsByClassName('HexHoot_Input');
            for (const input of inputs) {
                if (input.name === 'photo') {
                    // If there is a photo being uploaded
                    if (input.files.length !== 0) {
                        info.photo = await readAsDataURL(input.files[0]);
                    }
                } else {
                    info[input.name] = input.value;
                }
            }
            await dbMessenger.writeLoggedInUserInfo(info);
            backCallback(); // Just to give the users a sense of feedback
        };
        document.getElementById('downloadProfile').onclick = () => {
            dbMessenger.downloadBackup();
        };
        document.getElementById('logout').onclick = () => {
            if (confirm(i18n.getText('EditProfile.logoutConfirmation'))) {
                dbMessenger.deleteDatabaseContent();
            }
        };
    }

    /**
     * This function renders the profile icon to the icon bar. The profile icon
     * links to the page wherein the user can edit their own profile.
     * @param {function} clickCallback the callback function that is executed
     * when the icon is clicked.
     */
    async renderToIconBar(clickCallback) {
        const info = await dbMessenger.getLoggedInUserInfoPublic();
        const icon = document.createElement('div');
        icon.id = 'ownProfilePic';
        icon.className = 'icon';
        icon.style.backgroundImage = 'url(' + JSON.stringify(
            info && safePhoto(info.photo) ? info.photo :
                getPath('interface.defaultProfilePic')) + ')';
        icon.onclick = () => this.render(clickCallback);
        document.getElementById('iconbar').appendChild(icon);
    }
}

/**
 * Read a file as a data URL
 * @param {File} file the file
 * @return {Promise<string>} the data URL
 */
function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Error loading image'));
        reader.readAsDataURL(file);
    });
}

export default new EditProfile();
