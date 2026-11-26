/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Building blocks shared by the keyring, identity and session code. Only
// Electron's built-in crypto (BoringSSL) is used; see ADR-002 and ADR-003.

const crypto = require('node:crypto');

// scrypt limits. N=2^21 crashes Electron with SIGTRAP, which cannot be
// caught, so N is capped here before scrypt is ever called.
const scryptDefaults = Object.freeze({N: 2 ** 20, r: 8, p: 1});
const scryptMinN = 2 ** 14;
const scryptMaxN = 2 ** 20;
// Refuse to start scrypt unless this much more than its own memory need is
// available, rather than pushing the machine into swap (Q14)
const scryptHeadroom = 1.5;

/** An error with a stable code that callers can branch on */
class CryptoError extends Error {
    /**
     * @param {string} code machine-readable code
     * @param {string} message description
     */
    constructor(code, message) {
        super(message);
        this.name = 'CryptoError';
        this.code = code;
    }
}

/**
 * Encode several parts unambiguously: each part is a 4-byte big-endian
 * length followed by its bytes. Used for HKDF info and AEAD associated data,
 * so that ("ab", "c") and ("a", "bc") never encode the same way.
 * @param {...(string|Buffer|Uint8Array)} parts strings are UTF-8 encoded
 * @return {Buffer} the encoding
 */
function encodeParts(...parts) {
    const buffers = [];
    for (const part of parts) {
        const bytes = typeof part === 'string' ?
            Buffer.from(part, 'utf8') : Buffer.from(part);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(bytes.length);
        buffers.push(length, bytes);
    }
    return Buffer.concat(buffers);
}

/**
 * HKDF-SHA-512
 * @param {Buffer} ikm input key material
 * @param {Buffer} salt salt (may be empty)
 * @param {Buffer} info context
 * @param {number} [length] output bytes
 * @return {Buffer} the key
 */
function hkdf(ikm, salt, info, length = 32) {
    return Buffer.from(crypto.hkdfSync('sha512', ikm, salt, info, length));
}

/**
 * AES-256-GCM encryption with a random 96-bit nonce
 * @param {Buffer} key 32 bytes
 * @param {Buffer} plaintext data
 * @param {Buffer} ad associated data
 * @param {function} [random] randomBytes replacement, for test vectors
 * @return {Buffer} nonce (12) ‖ ciphertext ‖ tag (16)
 */
function seal(key, plaintext, ad, random = crypto.randomBytes) {
    const nonce = random(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(ad);
    return Buffer.concat([nonce, cipher.update(plaintext), cipher.final(),
        cipher.getAuthTag()]);
}

/**
 * AES-256-GCM decryption
 * @param {Buffer} key 32 bytes
 * @param {Buffer} sealed nonce ‖ ciphertext ‖ tag, from seal()
 * @param {Buffer} ad associated data
 * @return {Buffer} the plaintext
 * @throws {CryptoError} DECRYPT_FAILED if anything was altered
 */
function open(key, sealed, ad) {
    if (sealed.length < 12 + 16) {
        throw new CryptoError('DECRYPT_FAILED', 'Ciphertext is too short');
    }
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key,
            sealed.subarray(0, 12));
        decipher.setAAD(ad);
        decipher.setAuthTag(sealed.subarray(sealed.length - 16));
        return Buffer.concat([
            decipher.update(sealed.subarray(12, sealed.length - 16)),
            decipher.final()]);
    } catch (err) {
        throw new CryptoError('DECRYPT_FAILED', 'Decryption failed');
    }
}

/**
 * Check scrypt parameters against the limits above
 * @param {Object} params {N, r, p}
 * @return {Object} the same parameters
 */
function checkScryptParams(params) {
    const {N, r, p} = params;
    if (!Number.isInteger(N) || N < scryptMinN || N > scryptMaxN ||
        (N & (N - 1)) !== 0) {
        throw new CryptoError('BAD_PARAMS',
            `scrypt N must be a power of two from 2^14 to 2^20, not ${N}`);
    }
    if (!Number.isInteger(r) || r < 1 || r > 8 ||
        !Number.isInteger(p) || p < 1 || p > 4) {
        throw new CryptoError('BAD_PARAMS', 'Unsupported scrypt r or p');
    }
    return {N, r, p};
}

/**
 * Derive a key from a passphrase with scrypt. The passphrase is NFKC
 * normalized, so the same characters typed on different systems match.
 * @param {string} passphrase the passphrase
 * @param {Buffer} salt random salt
 * @param {Object} [params] {N, r, p}; scryptDefaults if omitted
 * @param {Object} [options]
 * @param {number} [options.length] output bytes
 * @param {function} [options.availableMemory] returns free bytes; for tests
 * @return {Promise<Buffer>} the key
 * @throws {CryptoError} BAD_PARAMS, LOW_MEMORY
 */
async function scrypt(passphrase, salt, params = scryptDefaults,
    options = {}) {
    const {N, r, p} = checkScryptParams(params);
    if (typeof passphrase !== 'string' || passphrase.length === 0) {
        throw new CryptoError('BAD_PASSPHRASE', 'A passphrase is needed');
    }
    const need = 128 * N * r;
    // process.availableMemory() counts reclaimable memory (macOS inactive
    // pages, Linux MemAvailable); os.freemem() reports almost 0 on macOS.
    const available = (options.availableMemory ||
        process.availableMemory)();
    if (available < need * scryptHeadroom) {
        throw new CryptoError('LOW_MEMORY', `scrypt needs about ` +
            `${Math.ceil(need * scryptHeadroom / 2 ** 20)} MiB of free memory`);
    }
    const password = Buffer.from(passphrase.normalize('NFKC'), 'utf8');
    try {
        return await new Promise((resolve, reject) => crypto.scrypt(
            password, salt, options.length || 32,
            {N, r, p, maxmem: need + 32 * 2 ** 20},
            (err, key) => err ? reject(err) : resolve(key)));
    } finally {
        password.fill(0);
    }
}

module.exports = {
    CryptoError, encodeParts, hkdf, seal, open, scrypt, checkScryptParams,
    scryptDefaults,
};
