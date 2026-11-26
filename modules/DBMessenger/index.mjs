/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

import {tableNames, messageType, rendererMethods}
    from '../Core/constants.mjs';

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
     * Download the database as JSON.
     */
    async downloadDBAsJSON() {
        const json = await this.call('exportBackup', []);
        const element = document.createElement('a');
        element.href = URL.createObjectURL(
            new Blob([json], {type: 'application/json'}));
        element.download = 'hexhoot_backup.hexhootjson';
        element.click();
        setTimeout(() => URL.revokeObjectURL(element.href), 1000);
    }

    /**
     * Let the user pick a backup file and replace the database with it.
     * @return {Promise} resolves once the backup is imported
     */
    uploadDBAsJSON() {
        return new Promise((resolve, reject) => {
            const element = document.createElement('input');
            element.type = 'file';
            element.accept = '.hexhootjson';
            element.onchange = async (event) => {
                try {
                    const json = await event.target.files[0].text();
                    await this.call('importBackup', [json]);
                    resolve('JSON file loaded and imported');
                } catch (err) {
                    reject(new Error('Loaded JSON file can not be imported'));
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
