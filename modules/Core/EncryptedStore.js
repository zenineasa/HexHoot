/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

const crypto = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {encodeParts} = require('../Crypto/primitives');

// Tables whose records hold secrets (identity, ratchet sessions, outbox);
// they use the keyring's 'secrets' key, everything else its 'db' key
const secretTables = ['Identity', 'Sessions', 'Outbox'];

/**
 * Core's storage (docs/design/keyring.md): one SQLite table of encrypted
 * records. Each record is a JSON value encrypted with its own key and bound
 * to its slot (RecordCipher). Record and group ids are keyed hashes, so the
 * file shows neither contact addresses nor message ids; without the
 * keyring it shows only how many records there are and their sizes.
 */
class EncryptedStore {
    /** @param {string} file database path, or ':memory:' */
    constructor(file) {
        this.db = new DatabaseSync(file);
        this.db.exec('PRAGMA journal_mode = WAL');
        this.db.exec(`CREATE TABLE IF NOT EXISTS records (
            tbl TEXT NOT NULL, id TEXT NOT NULL, grp TEXT, blob BLOB NOT NULL,
            PRIMARY KEY (tbl, id))`);
        this.db.exec('CREATE INDEX IF NOT EXISTS records_grp ON ' +
            'records (tbl, grp)');
        this.keys = null;
    }

    /**
     * @param {Object} keys {db: RecordCipher, secrets: RecordCipher,
     * index: Buffer}, from the keyring
     */
    unlock(keys) {
        this.keys = keys;
    }

    /** Forget the keys (the keyring zeroes them) */
    lock() {
        this.keys = null;
    }

    /** @return {boolean} whether records can be read */
    get unlocked() {
        return this.keys !== null;
    }

    /**
     * @param {string} kind 'row' or 'group'
     * @param {string} table table name
     * @param {string} key the logical id
     * @return {string} the stored id
     */
    hashId(kind, table, key) {
        if (!this.keys) {
            throw new Error('Storage is locked');
        }
        return crypto.createHmac('sha512', this.keys.index)
            .update(encodeParts(kind, table, String(key))).digest('hex')
            .slice(0, 64);
    }

    /**
     * @param {string} table table name
     * @return {RecordCipher} its cipher
     */
    cipher(table) {
        return secretTables.includes(table) ? this.keys.secrets :
            this.keys.db;
    }

    /**
     * Store a value
     * @param {string} table table name
     * @param {string} key id within the table
     * @param {*} value JSON-safe value
     * @param {string} [group] optional group (for example a contact)
     */
    put(table, key, value, group) {
        const id = this.hashId('row', table, key);
        const blob = this.cipher(table).encrypt(table, id,
            JSON.stringify(value));
        this.db.prepare('INSERT OR REPLACE INTO records (tbl, id, grp, blob) ' +
            'VALUES (?, ?, ?, ?)').run(table, id,
            group === undefined ? null : this.hashId('group', table, group),
            blob);
    }

    /**
     * @param {string} table table name
     * @param {string} key id within the table
     * @return {*} the value, or undefined
     */
    get(table, key) {
        const id = this.hashId('row', table, key);
        const row = this.db.prepare('SELECT blob FROM records WHERE tbl = ? ' +
            'AND id = ?').get(table, id);
        return row ? this.decode(table, id, row.blob) : undefined;
    }

    /**
     * @param {string} table table name
     * @param {string} key id within the table
     */
    delete(table, key) {
        this.db.prepare('DELETE FROM records WHERE tbl = ? AND id = ?')
            .run(table, this.hashId('row', table, key));
    }

    /**
     * @param {string} table table name
     * @return {Array} every value in the table
     */
    all(table) {
        return this.db.prepare('SELECT id, blob FROM records WHERE tbl = ?')
            .all(table).map((row) => this.decode(table, row.id, row.blob));
    }

    /**
     * @param {string} table table name
     * @param {string} group the group
     * @return {Array} the group's values
     */
    group(table, group) {
        return this.db.prepare('SELECT id, blob FROM records WHERE tbl = ? ' +
            'AND grp = ?').all(table, this.hashId('group', table, group))
            .map((row) => this.decode(table, row.id, row.blob));
    }

    /**
     * @param {string} table table name
     * @param {string} group the group to delete
     */
    deleteGroup(table, group) {
        this.db.prepare('DELETE FROM records WHERE tbl = ? AND grp = ?')
            .run(table, this.hashId('group', table, group));
    }

    /**
     * @param {string} table table name
     * @param {string} id stored id
     * @param {Uint8Array} blob stored blob
     * @return {*} the value
     */
    decode(table, id, blob) {
        return JSON.parse(this.cipher(table).decrypt(table, id,
            Buffer.from(blob)).toString('utf8'));
    }

    /** Delete every record */
    clear() {
        this.db.exec('DELETE FROM records');
    }

    /** Close the database */
    close() {
        this.lock();
        this.db.close();
    }
}

module.exports = EncryptedStore;
