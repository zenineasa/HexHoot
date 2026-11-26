/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

const {DatabaseSync} = require('node:sqlite');
const {tableNames} = require('./constants.mjs');

const keyedTables = [
    tableNames.friends,
    tableNames.loggedInUser,
    tableNames.preferences,
];
const allTables = [...keyedTables, tableNames.chat];

/**
 * Core's local database, on node:sqlite. Rows are stored as JSON, keyed the
 * same way as the IndexedDB stores of HexHoot 1.0, so the backup format stays
 * the same: {"Friends": [...], "Chat": [...], ...}.
 */
class Storage {
    /**
     * @param {string} file path of the database file, or ':memory:'
     */
    constructor(file = ':memory:') {
        this.db = new DatabaseSync(file);
        if (file !== ':memory:') {
            this.db.exec('PRAGMA journal_mode = WAL');
        }
        for (const table of keyedTables) {
            this.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
                key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
        }
        this.db.exec(`CREATE TABLE IF NOT EXISTS ${tableNames.chat} (
            key TEXT NOT NULL, timestamp INTEGER NOT NULL,
            value TEXT NOT NULL, PRIMARY KEY (key, timestamp))`);
    }

    /**
     * Throw unless the table is one of ours; table names are interpolated
     * into SQL.
     * @param {string} table table name
     * @param {Array} allowed allowed table names
     */
    static assertTable(table, allowed = keyedTables) {
        if (!allowed.includes(table)) {
            throw new Error('Unknown table: ' + table);
        }
    }

    /**
     * Get a row by key
     * @param {string} table table name
     * @param {string|number} key row key
     * @return {Object|undefined} the row
     */
    get(table, key) {
        Storage.assertTable(table);
        const row = this.db.prepare(
            `SELECT value FROM ${table} WHERE key = ?`).get(String(key));
        return row ? JSON.parse(row.value) : undefined;
    }

    /**
     * Add a row, or merge the given fields into an existing one
     * @param {string} table table name
     * @param {Object} data row; must contain 'key'
     */
    put(table, data) {
        Storage.assertTable(table);
        const merged = Object.assign({}, this.get(table, data.key), data);
        this.db.prepare(
            `INSERT OR REPLACE INTO ${table} (key, value) VALUES (?, ?)`)
            .run(String(data.key), JSON.stringify(merged));
    }

    /**
     * Get all rows of a table
     * @param {string} table table name
     * @return {Array} rows
     */
    getAll(table) {
        Storage.assertTable(table, allTables);
        const order = table === tableNames.chat ? 'key, timestamp' : 'key';
        return this.db.prepare(
            `SELECT value FROM ${table} ORDER BY ${order}`).all()
            .map((row) => JSON.parse(row.value));
    }

    /**
     * Store a chat message
     * @param {Object} row {key, timestamp, message}
     */
    putChat(row) {
        this.db.prepare(`INSERT OR REPLACE INTO ${tableNames.chat}
            (key, timestamp, value) VALUES (?, ?, ?)`)
            .run(String(row.key), row.timestamp, JSON.stringify(row));
    }

    /**
     * Whether a chat message with this key and timestamp is stored
     * @param {string} key the other user's public key
     * @param {number} timestamp message timestamp
     * @return {boolean}
     */
    hasChat(key, timestamp) {
        return this.db.prepare(`SELECT 1 FROM ${tableNames.chat}
            WHERE key = ? AND timestamp = ?`).get(key, timestamp) !==
            undefined;
    }

    /**
     * Get the conversation with one user, oldest first
     * @param {string} key the other user's public key
     * @return {Array} rows
     */
    getChat(key) {
        return this.db.prepare(`SELECT value FROM ${tableNames.chat}
            WHERE key = ? ORDER BY timestamp`).all(String(key))
            .map((row) => JSON.parse(row.value));
    }

    /** Delete every row of every table */
    clear() {
        for (const table of allTables) {
            this.db.exec(`DELETE FROM ${table}`);
        }
    }

    /**
     * Export every table
     * @return {Object} map from table name to rows
     */
    export() {
        const out = {};
        for (const table of allTables) {
            out[table] = this.getAll(table);
        }
        return out;
    }

    /**
     * Replace the whole database with an export. Nothing changes if the
     * export is invalid.
     * @param {Object} data map from table name to rows
     */
    import(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid backup');
        }
        for (const [table, rows] of Object.entries(data)) {
            Storage.assertTable(table, allTables);
            if (!Array.isArray(rows) || !rows.every((row) =>
                row && typeof row === 'object' && row.key !== undefined &&
                (table !== tableNames.chat ||
                    Number.isFinite(row.timestamp)))) {
                throw new Error('Invalid rows in backup table ' + table);
            }
        }
        this.db.exec('BEGIN');
        try {
            this.clear();
            for (const [table, rows] of Object.entries(data)) {
                for (const row of rows) {
                    if (table === tableNames.chat) {
                        this.putChat(row);
                    } else {
                        this.put(table, row);
                    }
                }
            }
            this.db.exec('COMMIT');
        } catch (err) {
            this.db.exec('ROLLBACK');
            throw err;
        }
    }

    /** Close the database */
    close() {
        if (this.db.isOpen) {
            this.db.close();
        }
    }
}

module.exports = Storage;
