/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

const {tableNames, messageType, rendererMethods} =
    require('./../Core/constants');

let injectedConnection = null;

/**
 * Connect to Core through the main process: ask for a MessagePort and talk
 * over it.
 * @return {Object} connection {call(method, args), onEvent(func)}
 */
function connectOverIPC() {
    const {ipcRenderer} = require('electron');
    const pending = new Map();
    const eventListeners = [];
    let nextId = 1;
    const portPromise = new Promise(function(resolve) {
        ipcRenderer.once('core:port', function(event) {
            const port = event.ports[0];
            port.onmessage = function({data}) {
                if (data.event) {
                    eventListeners.forEach((func) => func(data.event));
                    return;
                }
                const request = pending.get(data.id);
                if (!request) {
                    return;
                }
                pending.delete(data.id);
                if (Object.hasOwn(data, 'error')) {
                    request.reject(new Error(data.error));
                } else {
                    request.resolve(data.result);
                }
            };
            resolve(port);
        });
    });
    ipcRenderer.send('core:connect');

    return {
        call: async function(method, args) {
            const port = await portPromise;
            const id = nextId++;
            return new Promise(function(resolve, reject) {
                pending.set(id, {resolve, reject});
                port.postMessage({id, method, args});
            });
        },
        onEvent: function(func) {
            eventListeners.push(func);
        },
    };
}

/**
 * The renderer's client for Core. Every Core method listed in
 * 'rendererMethods' is available here as an async method of the same name.
 * This is a singleton class.
 */
class DBMessenger {
    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (DBMessenger._instance) {
            return DBMessenger._instance;
        }
        DBMessenger._instance = this;

        this.tableNames = tableNames;
        this.messageType = messageType;
        this.listOfMessageReceiveCallbackFunctions = [];
        this.connection = null;
    }

    /**
     * The connection to Core, created on first use
     * @return {Object} connection
     */
    getConnection() {
        if (!this.connection) {
            this.connection = injectedConnection || connectOverIPC();
            this.connection.onEvent(this.handleEvent.bind(this));
        }
        return this.connection;
    }

    /**
     * Call a Core method
     * @param {string} method name
     * @param {Array} args arguments
     * @return {*} the result
     */
    call(method, args) {
        return this.getConnection().call(method, args);
    }

    /**
     * @param {Object} event an event from Core
     */
    handleEvent(event) {
        if (event.type !== 'message') {
            return;
        }
        this.listOfMessageReceiveCallbackFunctions.forEach(function(func) {
            try {
                func(event);
            } catch (err) {
                console.log('Error in message callback:', err);
            }
        });
    }

    /**
     * Add functions from other modules which get triggered when new messages
     * arrive
     * @param {function} func callback function that gets invoked with
     * {senderPublicKey, message, isFromFriend}
     */
    addMessageReceiveCallbackFunction(func) {
        this.getConnection();
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
        element.setAttribute('href', 'data:text/plain;charset=utf-8,' +
            encodeURIComponent(json));
        element.setAttribute('download', 'hexhoot_backup.hexhootjson');
        element.style.display = 'none';
        element.click();
        element.remove();
    }

    /**
     * Let the user pick a backup file and replace the database with it.
     * @return {Promise} resolves once the backup is imported
     */
    uploadDBAsJSON() {
        return new Promise(function(resolve, reject) {
            const element = document.createElement('input');
            element.type = 'file';
            element.accept = '.hexhootjson';
            element.onchange = async function(event) {
                element.remove();
                try {
                    const json = await event.target.files[0].text();
                    await this.call('importBackup', [json]);
                    resolve('JSON file loaded and imported');
                } catch (err) {
                    reject(new Error('Loaded JSON file can not be imported'));
                }
            }.bind(this);
            element.click();
        }.bind(this));
    }
}

for (const method of rendererMethods) {
    if (!Object.hasOwn(DBMessenger.prototype, method)) {
        DBMessenger.prototype[method] = function(...args) {
            return this.call(method, args);
        };
    }
}

module.exports = function() {
    return new DBMessenger();
};

/**
 * Use the given connection to Core instead of IPC; for tests that run the UI
 * without the main process.
 * @param {Object} connection {call(method, args), onEvent(func)}
 */
module.exports.useConnection = function(connection) {
    injectedConnection = connection;
};
