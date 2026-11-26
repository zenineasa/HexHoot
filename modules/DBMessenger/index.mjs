/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

import {tableNames, messageType, rendererMethods}
    from '../Core/constants.mjs';
import i18n from '../I18n/index.mjs';

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
        this.listOfMessageReceiveCallbackFunctions = [];
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
        if (event.type !== 'message') {
            return;
        }
        for (const func of this.listOfMessageReceiveCallbackFunctions) {
            try {
                func(event);
            } catch (err) {
                console.log('Error in message callback:', err);
            }
        }
    }

    /**
     * Add functions from other modules which get triggered when new messages
     * arrive
     * @param {function} func callback function that gets invoked with
     * {senderPublicKey, message, isFromFriend}
     */
    addMessageReceiveCallbackFunction(func) {
        this.listOfMessageReceiveCallbackFunctions.push(func);
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
            const label = document.createElement('div');
            label.textContent = i18n.getText('Backup.passphrase');
            const input = document.createElement('input');
            input.type = 'password';
            input.className = 'HexHoot_Input';
            input.name = 'passphrase';
            const ok = document.createElement('button');
            ok.className = 'HexHoot_Button';
            ok.id = 'passphraseOk';
            ok.textContent = i18n.getText('Backup.ok');
            const cancel = document.createElement('button');
            cancel.className = 'HexHoot_Button';
            cancel.textContent = i18n.getText('Backup.cancel');
            dialog.append(label, input, ok, cancel);
            document.body.appendChild(dialog);
            const finish = (value) => {
                dialog.close();
                dialog.remove();
                resolve(value);
            };
            ok.onclick = () => finish(input.value);
            cancel.onclick = () => finish(null);
            dialog.oncancel = () => finish(null);
            dialog.showModal();
            input.focus();
        });
    }

    /**
     * Download an encrypted backup (.hexhoot2)
     */
    async downloadBackup() {
        const passphrase = await this.askPassphrase();
        if (passphrase === null) {
            return;
        }
        let file;
        try {
            file = await this.call('exportBackup', [passphrase]);
        } catch (err) {
            alert(i18n.getText(errorCode(err).code === 'WEAK_CREDENTIALS' ?
                'Login.passwordLength' : 'Backup.wrongPassphrase'));
            return;
        }
        const element = document.createElement('a');
        element.href = URL.createObjectURL(
            new Blob([file], {type: 'application/octet-stream'}));
        element.download = 'hexhoot_backup.hexhoot2';
        element.click();
        setTimeout(() => URL.revokeObjectURL(element.href), 1000);
    }

    /**
     * Let the user pick a backup file and restore it
     * @return {Promise<boolean>} whether a backup was restored
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
                    resolve(false);
                    return;
                }
                try {
                    await this.call('importBackup', [bytes, passphrase]);
                    resolve(true);
                } catch (err) {
                    alert(i18n.getText(errorCode(err).code ===
                        'NOT_A_BACKUP' ? 'Backup.notABackup' :
                        'Backup.wrongPassphrase'));
                    resolve(false);
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
