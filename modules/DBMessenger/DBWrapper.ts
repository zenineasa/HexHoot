/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

import IDBExportImport = require('indexeddb-export-import');

/**
 * This class contains a wrapper for IndexedDB in accordance with what we need
 */
export default class DBWrapper {
    private static _instance: DBWrapper;
    private dbName: string;
    private dbVersion: number;
    private db: IDBDatabase | null = null;

    /** This is the constructor (note the singleton implementation) */
    constructor() {
        /** This is the constructor (note the singleton implementation) */
        if (DBWrapper._instance) {
            return DBWrapper._instance;
        }
        DBWrapper._instance = this;
        this.initialize();
    }

    /**
     * Open the connection to the database
     */
    initialize() {
        this.dbName = 'HexhootDB';
        this.dbVersion = 3;

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
    storeDBAsMemberVariable(request: IDBOpenDBRequest) {
        return (event: Event) => {
            this.db = request.result;
        };
    }

    /**
     * Wait for 'this.db' to be available by invoking the following function
     * with an await
     * @return {Promise} promise for whether the database is loaded
     */
    promiseDBLoaded() {
        return new Promise((resolve, reject) => {
            let count = 0;
            const interval = setInterval(() => {
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
            }, 200);
        });
    }

    /**
     * Handle errors
     * @param {Event} event a javascript event
     */
    error(event: Event) {
        const error = (event.target as IDBRequest).error;
        console.error('IndexedDB Error:', error);
        console.log(new Error('Error: ' + (error ? error.message : JSON.stringify(event))));
    }

    /**
     * Once the database opening request has been processed, ...
     */
    // ...

    // ...

    /**
     * When you open the database for the first time ...
     */
    upgrade(event: IDBVersionChangeEvent) {
        /**
         * Add table to the database
         * ...
         */
        function addTable(db: IDBDatabase, tableName: string, userKey: string | string[], columns: {[key: string]: IDBIndexParameters}) {
            if (db.objectStoreNames.contains(tableName)) {
                return;
            }
            const store =
                db.createObjectStore(tableName, {'keyPath': userKey});

            // Eg. columns = {'col1': {unique: false}, 'col2': {unique: false};
            Object.entries(columns).forEach(function(column) {
                store.createIndex(column[0], column[0], columns[1]);
            });
        }

        const db = (event.target as IDBOpenDBRequest).result;
        addTable(
            db,
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
            db,
            'Chat',
            ['key', 'timestamp'],
            {
                'messages': {unique: false},
            },
        );
        addTable(
            db,
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
            db,
            'Preferences',
            'key', // name of the field is the key
            {
                'value': {},
            },
        );
    }

    /**
     * Delete table
     * @param {string} tableName
     */
    async deleteTable(tableName: string) {
        await new Promise<void>((resolve, reject) => {
            if(!this.db) {
                reject(new Error("DB not initialized"));
                return;
            }
            const transaction = this.db.transaction(tableName, 'readwrite');
            const objectStore = transaction.objectStore(tableName);

            const clearRequest = objectStore.clear();

            clearRequest.onsuccess = () => {
                console.log(`All entries removed from ${tableName} table`);
                resolve();
            };

            clearRequest.onerror = (event) => {
                console.error(
                    `Error clearing entries from ${tableName} table:`,
                    (event.target as IDBRequest).error
                );
                reject((event.target as IDBRequest).error);
            };
        });
    }

    /**
     * Add or edit (put) a data entry in a database table
     * @param {string} tableName name of the database table
     * @param {Object} data data to be added/edited
     */
    async addOrEditEntry(tableName: string, data: any) {
        await this.promiseDBLoaded();
        if(!this.db) throw new Error("DB not initialized");

        // Read existing data and update the fields that is available in 'data'
        // object.
        let dataToDB: any = await this.get(tableName, data.key);
        if (dataToDB) {
            const dataEntries = Object.entries(data);
            for (let i = 0; i < dataEntries.length; i++) {
                dataToDB[dataEntries[i][0]] = dataEntries[i][1];
            }
        } else {
            dataToDB = data;
        }

        // Write to the database.
        const txn = this.db.transaction(tableName, 'readwrite');
        const store = txn.objectStore(tableName);
        const query = store.put(dataToDB);
        query.onerror = (e) => this.error(e);
    }

    /**
     * Get all entries from a database table
     * @param {string} tableName name of the database table
     */
    async getAll(tableName: string) {
        await this.promiseDBLoaded();
        if(!this.db) throw new Error("DB not initialized");

        const txn = this.db.transaction(tableName, 'readwrite');
        const store = txn.objectStore(tableName);

        let ret: any[] = [];

        await new Promise((resolve, reject) => {
            const getAll = store.getAll();
            getAll.onsuccess = (event) => {
                ret = (event.target as IDBRequest).result;
                resolve('Login data retrieved from DB');
            };
            getAll.onerror = (err) => {
                this.error(err);
                reject(new Error('Error: retrieving login data from DB'));
            };
        });

        return ret;
    }

    /**
     * Get entry from a database with a key
     * @param {string} tableName name of the database table
     * @param {string} key string key value
     */
    async get(tableName: string, key: string | any[]) {
        await this.promiseDBLoaded();
        if(!this.db) throw new Error("DB not initialized");

        const txn = this.db.transaction(tableName, 'readwrite');
        const store = txn.objectStore(tableName);

        let ret: any = null;

        await new Promise((resolve, reject) => {
            const getAll = store.get(key);
            getAll.onsuccess = (event) => {
                ret = (event.target as IDBRequest).result;
                resolve('Data retrieved from DB');
            };
            getAll.onerror = (err) => {
                this.error(err);
                reject(new Error('Error: retrieving data from DB'));
            };
        });

        return ret;
    }

    /**
     * Get entries from a database within a key range
     * @param {string} tableName name of the database table
     * @param {Array} lowerKeyBound lower bound of the key
     * @param {Array} upperKeyBound upper bound of the key
     */
    async getInKeyRange(tableName: string, lowerKeyBound: any, upperKeyBound: any) {
        await this.promiseDBLoaded();
        if(!this.db) throw new Error("DB not initialized");

        const txn = this.db.transaction(tableName, 'readwrite');
        const store = txn.objectStore(tableName);

        let ret: any[] = [];

        await new Promise((resolve, reject) => {
            const keyRange = IDBKeyRange.bound(lowerKeyBound, upperKeyBound);
            const getAll = store.getAll(keyRange);
            getAll.onsuccess = (event) => {
                ret = (event.target as IDBRequest).result;
                resolve('Data retrieved from DB');
            };
            getAll.onerror = (err) => {
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
        if(!this.db) throw new Error("DB not initialized");
        const db = this.db;
        IDBExportImport.exportToJsonString(db, (err: any, jsonString: string) => {
            if (!err) {
                const element = document.createElement('a');
                element.setAttribute(
                    'href',
                    'data:text/plain;charset=utf-8,' +
                        encodeURIComponent(jsonString),
                );
                element.setAttribute('download', 'hexhoot_backup.hexhootjson');

                element.style.display = 'none';
                document.body.appendChild(element); // Added append to body for Firefox support mostly but good practice
                element.click();
                element.remove();
            } else {
                this.error(err);
            }
        });
    }

    /**
     * Upload database as JSON.
     */
    async uploadDBAsJSON() {
        return new Promise((resolve, reject) => {
            const element = document.createElement('input');
            element.type = 'file';
            element.accept = '.hexhootjson';
            element.click();
            element.onchange = (event) => {
                const target = event.target as HTMLInputElement;
                if(!target.files || !target.files[0]) {
                    reject('No file selected');
                    return;
                }
                const reader = new FileReader();
                reader.readAsText(target.files[0], 'UTF-8');
                reader.onload = (evt) => {
                    if(!this.db) {
                        reject('DB not initialized');
                        return;
                    }
                    const jsonString = (evt.target as FileReader).result as string;
                    IDBExportImport.importFromJsonString(this.db, jsonString,
                        (err: any) => {
                            if (err) {
                                reject('Loaded JSON file can not be imported');
                            }
                            resolve('JSON file loaded and imported');
                        },
                    );
                };
                reader.onerror = (err) => {
                    reject('JSON file not loaded');
                };
                element.remove();
            };
        });
    }
}
