/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

import {tableNames, messageType, rendererMethods}
    from '../Core/constants.mjs';
import i18n from '../I18n/index.mjs';
import {html} from '../Html/index.mjs';

/**
 * The code Core gave an error; preload.js puts it in front of the message
 * as "[CODE:detail,detail] text"
 * @param {Error} err an error from a Core call
 * @return {Object} {code, details}
 */
export function errorCode(err) {
    const match = /^\[([A-Z_]+)(?::([\w,]*))?\]/.exec(String(err?.message));
    return {code: match ? match[1] : 'UNKNOWN',
        details: match && match[2] ? match[2].split(',') : []};
}

/**
 * The renderer's client for Core. Every Core method listed in
 * 'rendererMethods' is available here as an async method of the same name.
 * Calls go through window.hexhoot.core, which the preload script provides.
 */
class DBMessenger {
    /** constructor */
    constructor() {
        this.tableNames = tableNames;
        this.messageType = messageType;
        this.listeners = [];
        window.hexhoot.core.onEvent(this.handleEvent.bind(this));
    }

    /**
     * Call a Core method
     * @param {string} method name
     * @param {Array} args arguments
     * @return {*} the result
     */
    call(method, args) {
        return window.hexhoot.core.call(method, args);
    }

    /**
     * @param {Object} event an event from Core
     */
    handleEvent(event) {
        for (const {type, func} of this.listeners) {
            if (type === event?.type) {
                try {
                    func(event);
                } catch (err) {
                    console.error('Error in a Core event handler:', err);
                }
            }
        }
    }

    /**
     * Listen to Core events of one type: 'message' (chats, requests and
     * profiles), 'delivered', 'link' or 'account'
     * @param {string} type the event type
     * @param {function} func called with the event
     */
    on(type, func) {
        this.listeners.push({type, func});
    }

    /**
     * Delete everything, then re-render the app.
     */
    async deleteDatabaseContent() {
        await this.call('deleteDatabaseContent', []);
        window.reload();
    }

    /**
     * Ask for a backup passphrase in a small dialog (Electron has no
     * prompt())
     * @return {Promise<string|null>} the passphrase, or null if cancelled
     */
    askPassphrase() {
        return new Promise((resolve) => {
            const dialog = document.createElement('dialog');
            dialog.id = 'passphraseDialog';
            dialog.className = 'hh-dialog';
            dialog.innerHTML = html`
                <div class="head"><h2>${i18n.getText('Backup.title')}</h2></div>
                <div class="body">
                    <label class="hh-label" for="passphraseInput">
                        ${i18n.getText('Backup.passphrase')}</label>
                    <input class="hh-input" id="passphraseInput"
                        name="passphrase" type="password" autocomplete="off">
                    <div class="hh-row end" style="margin-top: 14px">
                        <button class="hh-btn hh-secondary" name="cancel">
                            ${i18n.getText('Backup.cancel')}</button>
                        <button class="hh-btn hh-primary" id="passphraseOk">
                            ${i18n.getText('Backup.ok')}</button>
                    </div>
                </div>`.toString();
            document.body.appendChild(dialog);
            const input = dialog.querySelector('input');
            const finish = (value) => {
                dialog.close();
                dialog.remove();
                resolve(value);
            };
            dialog.querySelector('#passphraseOk').onclick = () =>
                finish(input.value);
            dialog.querySelector('[name=cancel]').onclick = () =>
                finish(null);
            input.onkeydown = (event) => {
                if (event.key === 'Enter') {
                    finish(input.value);
                }
            };
            dialog.oncancel = () => finish(null);
            dialog.showModal();
            input.focus();
        });
    }

    /**
     * Encrypt a backup and save it as a file (.hexhoot2)
     * @param {string} passphrase at least 16 characters
     * @return {Promise<number>} the size of the file in bytes
     */
    async saveBackup(passphrase) {
        const file = await this.call('exportBackup', [passphrase]);
        const element = document.createElement('a');
        element.href = URL.createObjectURL(
            new Blob([file], {type: 'application/octet-stream'}));
        element.download = 'hexhoot_backup.hexhoot2';
        element.click();
        setTimeout(() => URL.revokeObjectURL(element.href), 1000);
        return file.length;
    }

    /**
     * Let the user pick a backup file and restore it
     * @return {Promise<Object>} {restored, error}: error is the key of a
     * text to show, or null
     */
    uploadBackup() {
        return new Promise((resolve) => {
            const element = document.createElement('input');
            element.type = 'file';
            element.accept = '.hexhoot2';
            element.onchange = async (event) => {
                const bytes = new Uint8Array(
                    await event.target.files[0].arrayBuffer());
                const passphrase = await this.askPassphrase();
                if (passphrase === null) {
                    resolve({restored: false, error: null});
                    return;
                }
                try {
                    await this.call('importBackup', [bytes, passphrase]);
                    resolve({restored: true, error: null});
                } catch (err) {
                    resolve({restored: false, error: errorCode(err).code ===
                        'NOT_A_BACKUP' ? 'Backup.notABackup' :
                        'Backup.wrongPassphrase'});
                }
            };
            element.click();
        });
    }
}

for (const method of rendererMethods) {
    if (!Object.hasOwn(DBMessenger.prototype, method)) {
        DBMessenger.prototype[method] = function(...args) {
            return this.call(method, args);
        };
    }
}

export default new DBMessenger();
