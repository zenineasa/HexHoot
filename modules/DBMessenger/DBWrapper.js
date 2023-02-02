/* Copyright (c) 2022-2023 Zenin Easa Panthakkalakath */

const IDBExportImport = require('indexeddb-export-import');

/**
 * This class contains a wrapper for IndexedDB in accordance with what we need
 */
class DBWrapper {
    /** This is the constructor (note the singleton implementation) */
    constructor() {
        /** This is the constructor (note the singleton implementation) */
        if (DBWrapper._instance) {
            return DBWrapper._instance;
        }
        DBWrapper._instance = this;
        DBWrapper._instance.initialize();
    }

    /**
     * Open the connection to the database
     */
    initialize() {
        this.dbName = 'HexhootDB';
        this.dbVersion = 1;

        const request = indexedDB.open(this.dbName, this.dbVersion);
        request.onerror = this.error;
        request.onupgradeneeded = this.upgrade.bind(this);
        request.onsuccess = this.storeDBAsMemberVariable(request);
    }

    /**
     * Once the database opening request has been processed, we store the
     * handle to the database in a member variable
     * @param {IDBOpenDBRequest} request the open request for the database
     * @return {function} callback function that populates the 'db' member
     * variable
     */
    storeDBAsMemberVariable(request) {
        return function(event) {
            this.db = request.result;
        }.bind(this);
    }

    /**
     * Wait for 'this.db' to be available by invoking the following function
     * with an await
     * @return {Promise} promise for whether the database is loaded
     */
    promiseDBLoaded() {
        return new Promise(function(resolve, reject) {
            let count = 0;
            const interval = setInterval(function() {
                if (this.db) {
                    clearInterval(interval);
                    resolve('DB Loaded');
                } else {
                    count += 1;
                    if (count % 5 == 0) {
                        this.initialize();
                    } else if (count > 9) {
                        reject(new Error('DB Not loaded after a long time'));
                    }
                }
            }.bind(this), 200);
        }.bind(this));
    }

    /**
     * Handle errors
     * @param {Event} event a javascript event
     */
    error(event) {
        console.log(new Error('Error: ' + JSON.stringify(event)));
    }

    /**
     * When you open the database for the first time or when you open the
     * database with a higher version number for the first time, the
     * following callback is invoked.
     * @param {Event} event a javascript event that is a callback param of
     * 'onupgradeneeded'
     */
    upgrade(event) {
        /**
         * Add table to the database
         * @param {string} db the database as event callback
         * @param {string} tableName the name of the table
         * @param {string} userKey the path of the key in the table; username of
         * the other person
         * @param {Object} columns An object with names corresponding to the
         * column name and the values corresponding to the configuration of the
         * columns
         */
        function addTable(db, tableName, userKey, columns) {
            const store =
                db.createObjectStore(tableName, {'keyPath': userKey});

            // Eg. columns = {'col1': {unique: false}, 'col2': {unique: false};
            Object.entries(columns).forEach(function(column) {
                store.createIndex(column[0], column[0], columns[1]);
            });
        }
        addTable(
            event.target.result,
            'Friends',
            'key',
            {
                'name': {unique: false}, // string
                'about': {unique: false}, // string
                'photo': {}, // base64 string
                'lastProfileUpdate': {}, // timestamp
                'lastMessageTimestamp': {}, // timestamp
                'isRead': {}, // boolean
            },
        );
        addTable(
            event.target.result,
            'Chat',
            ['key', 'timestamp'],
            {
                'messages': {unique: false},
            },
        );
        addTable(
            event.target.result,
            'LoggedInUserInfo',
            'key',
            {
                'privateKey': {},
                'displayName': {},
                'about': {},
                'photo': {},
            },
        );
        addTable(
            event.target.result,
            'Preferences',
            'key', // name of the field is the key
            {
                'value': {},
            },
        );
    }

    /**
     * Delete everything.
     */
    async deleteDatabaseContent() {
        indexedDB.deleteDatabase(this.dbName);
        // TODO: Ensure that the database is deleted before running the
        // following
        this.initialize();
    }

    /**
     * Add or edit (put) a data entry in a database table
     * @param {string} tableName name of the database table
     * @param {Object} data data to be added/edited
     */
    async addOrEditEntry(tableName, data) {
        await this.promiseDBLoaded();

        // Read existing data and update the fields that is available in 'data'
        // object.
        let dataToDB = await this.get(tableName, data.key);
        if (dataToDB) {
            data = Object.entries(data);
            for (let i = 0; i < data.length; i++) {
                dataToDB[data[i][0]] = data[i][1];
            }
        } else {
            dataToDB = data;
        }

        // Write to the database.
        const txn = this.db.transaction(tableName, 'readwrite');
        const store = txn.objectStore(tableName);
        const query = store.put(dataToDB);
        query.onerror = this.error;
    }

    /**
     * Get all entries from a database table
     * @param {string} tableName name of the database table
     */
    async getAll(tableName) {
        await this.promiseDBLoaded();

        const txn = this.db.transaction(tableName, 'readwrite');
        const store = txn.objectStore(tableName);

        let ret = [];

        await new Promise(function(resolve, reject) {
            const getAll = store.getAll();
            getAll.onsuccess = function(event) {
                ret = event.target.result;
                resolve('Login data retrieved from DB');
            };
            getAll.onerror = function(err) {
                this.error(err);
                reject(new Error('Error: retrieving login data from DB'));
            }.bind(this);
        }.bind(this));

        return ret;
    }

    /**
     * Get entry from a database with a key
     * @param {string} tableName name of the database table
     * @param {string} key string key value
     */
    async get(tableName, key) {
        await this.promiseDBLoaded();

        const txn = this.db.transaction(tableName, 'readwrite');
        const store = txn.objectStore(tableName);

        let ret = [];

        await new Promise(function(resolve, reject) {
            const getAll = store.get(key);
            getAll.onsuccess = function(event) {
                ret = event.target.result;
                resolve('Data retrieved from DB');
            };
            getAll.onerror = function(err) {
                this.error(err);
                reject(new Error('Error: retrieving data from DB'));
            }.bind(this);
        }.bind(this));

        return ret;
    }

    /**
     * Get entries from a database within a key range
     * @param {string} tableName name of the database table
     * @param {Array} lowerKeyBound lower bound of the key
     * @param {Array} upperKeyBound upper bound of the key
     */
    async getInKeyRange(tableName, lowerKeyBound, upperKeyBound) {
        await this.promiseDBLoaded();

        const txn = this.db.transaction(tableName, 'readwrite');
        const store = txn.objectStore(tableName);

        let ret = [];

        await new Promise(function(resolve, reject) {
            const keyRange = IDBKeyRange.bound(lowerKeyBound, upperKeyBound);
            const getAll = store.getAll(keyRange);
            getAll.onsuccess = function(event) {
                ret = event.target.result;
                resolve('Data retrieved from DB');
            };
            getAll.onerror = function(err) {
                this.error(err);
                reject(new Error('Error: retrieving data from DB'));
            };
        });

        return ret;
    }

    /**
     * Download database as JSON.
     */
    async downloadDBAsJSON() {
        IDBExportImport.exportToJsonString(this.db, function(err, jsonString) {
            if (!err) {
                const element = document.createElement('a');
                element.setAttribute(
                    'href',
                    'data:text/plain;charset=utf-8,' +
                        encodeURIComponent(jsonString),
                );
                element.setAttribute('download', 'hexhoot_backup.hexhootjson');

                element.style.display = 'none';
                element.click();
                element.remove();
            } else {
                this.error(err);
            }
        }.bind(this));
    }

    /**
     * Upload database as JSON.
     */
    async uploadDBAsJSON() {
        return new Promise(function(resolve, reject) {
            const element = document.createElement('input');
            element.type = 'file';
            element.accept = '.hexhootjson';
            element.click();
            element.onchange = function(event) {
                const reader = new FileReader();
                reader.readAsText(event.target.files[0], 'UTF-8');
                reader.onload = function(evt) {
                    const jsonString = evt.target.result;
                    IDBExportImport.importFromJsonString(this.db, jsonString,
                        function(err) {
                            if (err) {
                                reject('Loaded JSON file can not be imported');
                            }
                            resolve('JSON file loaded and imported');
                        },
                    );
                }.bind(this);
                reader.onerror = function(err) {
                    reject('JSON file not loaded');
                };
                element.remove();
            }.bind(this);
        }.bind(this));
    }
}

module.exports = function() {
    return new DBWrapper();
};
