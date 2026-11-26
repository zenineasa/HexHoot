/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

const crypto = require('node:crypto');
const {CryptoError, encodeParts, hkdf, seal, open} = require('./primitives');

// Format byte at the start of every record blob
const recordVersion = 1;
const saltBytes = 32;

/**
 * Encrypts stored records (docs/design/keyring.md). Each record gets its own
 * key, derived from the cipher's key with a random salt and bound to its
 * table and id, so a record cannot be moved to another slot, and no key
 * ever encrypts enough records to strain AES-GCM's random nonces.
 *
 *     blob  = 0x01 ‖ salt (32) ‖ nonce (12) ‖ ciphertext ‖ tag (16)
 *     K_rec = HKDF-SHA-512(key, salt, parts("hexhoot/v2/rec", table, id))
 *     ad    = parts("hexhoot/v2/rec", 0x01, table, id)
 */
class RecordCipher {
    /**
     * @param {Buffer} key 32 bytes; the cipher keeps a reference, and
     * destroy() zeroes it
     * @param {Object} [options]
     * @param {function} [options.random] randomBytes replacement, for test
     * vectors only
     */
    constructor(key, options = {}) {
        if (!Buffer.isBuffer(key) || key.length !== 32) {
            throw new CryptoError('BAD_KEY', 'A 32-byte key is needed');
        }
        this.key = key;
        this.random = options.random || crypto.randomBytes;
    }

    /**
     * @param {string} table table name
     * @param {string|number} id record id
     * @return {Array} [info, ad]
     */
    context(table, id) {
        if (!this.key) {
            throw new CryptoError('LOCKED', 'The keyring is locked');
        }
        const label = 'hexhoot/v2/rec';
        const tableName = String(table);
        const recordId = String(id);
        // HKDF info is limited to 1024 bytes
        if (Buffer.byteLength(tableName) + Buffer.byteLength(recordId) >
            900) {
            throw new CryptoError('BAD_RECORD', 'Table or record id too long');
        }
        return [encodeParts(label, tableName, recordId),
            encodeParts(label, Buffer.from([recordVersion]), tableName,
                recordId)];
    }

    /**
     * @param {string} table table name
     * @param {string|number} id record id
     * @param {Buffer|string} data the record; strings are UTF-8 encoded
     * @return {Buffer} the blob
     */
    encrypt(table, id, data) {
        const [info, ad] = this.context(table, id);
        const salt = this.random(saltBytes);
        const key = hkdf(this.key, salt, info);
        try {
            return Buffer.concat([Buffer.from([recordVersion]), salt,
                seal(key, Buffer.from(data), ad, this.random)]);
        } finally {
            key.fill(0);
        }
    }

    /**
     * @param {string} table table name
     * @param {string|number} id record id
     * @param {Buffer} blob from encrypt()
     * @return {Buffer} the record
     * @throws {CryptoError} DECRYPT_FAILED if the blob was altered or belongs
     * to another table or id
     */
    decrypt(table, id, blob) {
        const [info, ad] = this.context(table, id);
        if (!Buffer.isBuffer(blob) || blob.length < 1 + saltBytes ||
            blob[0] !== recordVersion) {
            throw new CryptoError('DECRYPT_FAILED', 'Not a record blob');
        }
        const key = hkdf(this.key, blob.subarray(1, 1 + saltBytes), info);
        try {
            return open(key, blob.subarray(1 + saltBytes), ad);
        } finally {
            key.fill(0);
        }
    }

    /** Zero the key; later calls throw LOCKED */
    destroy() {
        this.key?.fill(0);
        this.key = null;
    }
}

module.exports = RecordCipher;
