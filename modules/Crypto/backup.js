/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// The encrypted backup file, .hexhoot2 (docs/design/keyring.md). It holds
// the identity secret and the data tables (contacts, messages,
// preferences), but never ratchet sessions: after a restore, every contact
// gets a fresh handshake.
//
//   file    = "HEXHOOT2" ‖ 0x01 ‖ u32be header length ‖ header ‖ sealed
//   header  = JSON {kdf: "scrypt", N, r, p, salt}   (public parameters)
//   key     = HKDF(scrypt(NFKC(passphrase), salt, N, r, p), "",
//                  "hexhoot/v2/backup", 32)
//   sealed  = nonce (12) ‖ AES-256-GCM(key, deflate(JSON payload)) ‖ tag
//   ad      = parts("hexhoot/v2/backup", "HEXHOOT2", 0x01, header)
//   payload = {format: "hexhoot-backup", version: 1, createdAt,
//              identity: Identity#secret(), tables: {name: rows}}

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {
    CryptoError, encodeParts, hkdf, seal, open, scrypt, checkScryptParams,
    scryptDefaults,
} = require('./primitives');
const {Identity} = require('./Identity');
const {limits} = require('./credentials');

const magic = Buffer.from('HEXHOOT2');
const fileVersion = 1;
const maxHeaderBytes = 4096;
// Where ratchet sessions are stored; a backup must never contain them
const sessionTable = 'Sessions';

/**
 * @param {Buffer} header header bytes
 * @return {Buffer} associated data
 */
function associatedData(header) {
    return encodeParts('hexhoot/v2/backup', magic,
        Buffer.from([fileVersion]), header);
}

/**
 * @param {string} passphrase the backup passphrase
 * @param {Buffer} salt salt
 * @param {Object} params {N, r, p}
 * @param {Object} options for tests: totalMemory
 * @return {Promise<Buffer>} the file key
 */
async function fileKey(passphrase, salt, params, options) {
    const kek = await scrypt(passphrase, salt, params,
        {totalMemory: options.totalMemory});
    try {
        return hkdf(kek, Buffer.alloc(0), Buffer.from('hexhoot/v2/backup'));
    } finally {
        kek.fill(0);
    }
}

/**
 * Make a backup file
 * @param {Object} contents
 * @param {Identity} contents.identity our identity
 * @param {Object} contents.tables {table name: rows}; anything JSON-safe
 * @param {string} passphrase at least 16 characters; the account password
 * is fine
 * @param {Object} [options] for tests: scryptParams, totalMemory, now
 * @return {Promise<Buffer>} the file
 * @throws {CryptoError} WEAK_CREDENTIALS, BAD_PARAMS (session state)
 */
async function exportBackup(contents, passphrase, options = {}) {
    if ([...String(passphrase)].length < limits.minPasswordLength) {
        const err = new CryptoError('WEAK_CREDENTIALS',
            `A backup passphrase needs ${limits.minPasswordLength} ` +
            'characters or more');
        err.problems = ['passwordTooShort'];
        throw err;
    }
    const tables = contents.tables || {};
    if (Object.keys(tables).some((name) =>
        name.toLowerCase() === sessionTable.toLowerCase())) {
        throw new CryptoError('BAD_PARAMS',
            'Ratchet sessions are never put in a backup');
    }
    const params = checkScryptParams(options.scryptParams || scryptDefaults);
    const salt = crypto.randomBytes(32);
    const header = Buffer.from(JSON.stringify({kdf: 'scrypt', ...params,
        salt: salt.toString('base64')}));
    const payload = zlib.deflateRawSync(Buffer.from(JSON.stringify({
        format: 'hexhoot-backup',
        version: 1,
        createdAt: (options.now || Date.now)(),
        identity: contents.identity.secret(),
        tables,
    })));
    const key = await fileKey(passphrase, salt, params, options);
    try {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(header.length);
        return Buffer.concat([magic, Buffer.from([fileVersion]), length,
            header, seal(key, payload, associatedData(header))]);
    } finally {
        key.fill(0);
        payload.fill(0);
    }
}

/**
 * Read a backup file
 * @param {Buffer} file from exportBackup
 * @param {string} passphrase the backup passphrase
 * @param {Object} [options] for tests: totalMemory
 * @return {Promise<Object>} {identity (Identity), tables, createdAt}
 * @throws {CryptoError} NOT_A_BACKUP, UNSUPPORTED_VERSION, CORRUPT,
 * BAD_PARAMS, BAD_PASSPHRASE, LOW_MEMORY
 */
async function importBackup(file, passphrase, options = {}) {
    if (!Buffer.isBuffer(file) || file.length < magic.length + 5 ||
        !file.subarray(0, magic.length).equals(magic)) {
        throw new CryptoError('NOT_A_BACKUP', 'Not a HexHoot backup');
    }
    if (file[magic.length] !== fileVersion) {
        throw new CryptoError('UNSUPPORTED_VERSION',
            'This backup was made by a newer HexHoot');
    }
    const headerLength = file.readUInt32BE(magic.length + 1);
    const headerStart = magic.length + 5;
    if (headerLength > maxHeaderBytes ||
        headerStart + headerLength > file.length) {
        throw new CryptoError('CORRUPT', 'The backup is damaged');
    }
    const header = file.subarray(headerStart, headerStart + headerLength);
    let info;
    try {
        info = JSON.parse(header.toString('utf8'));
    } catch (err) {
        throw new CryptoError('CORRUPT', 'The backup is damaged');
    }
    if (!info || info.kdf !== 'scrypt' || typeof info.salt !== 'string') {
        throw new CryptoError('CORRUPT', 'The backup is damaged');
    }
    // Capped before scrypt runs (2^21 would crash Electron)
    const params = checkScryptParams(info);
    const key = await fileKey(passphrase, Buffer.from(info.salt, 'base64'),
        params, options);
    let compressed;
    try {
        compressed = open(key, file.subarray(headerStart + headerLength),
            associatedData(header));
    } catch (err) {
        throw new CryptoError('BAD_PASSPHRASE',
            'Wrong passphrase, or the backup was changed');
    } finally {
        key.fill(0);
    }
    let payload;
    try {
        payload = JSON.parse(zlib.inflateRawSync(compressed).toString('utf8'));
    } catch (err) {
        throw new CryptoError('CORRUPT', 'The backup is damaged');
    }
    if (!payload || payload.format !== 'hexhoot-backup' ||
        payload.version !== 1 || !payload.identity ||
        typeof payload.tables !== 'object') {
        throw new CryptoError('CORRUPT', 'The backup is damaged');
    }
    return {
        identity: Identity.fromSecret(payload.identity),
        tables: payload.tables,
        createdAt: payload.createdAt,
    };
}

module.exports = {exportBackup, importBackup, sessionTable};
