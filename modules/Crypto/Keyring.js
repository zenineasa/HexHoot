/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const RecordCipher = require('./RecordCipher');
const {
    CryptoError, encodeParts, hkdf, seal, open, scrypt, checkScryptParams,
    scryptDefaults,
} = require('./primitives');

const fileFormat = 'hexhoot-keyring';
const fileVersion = 1;
const purposes = ['db', 'secrets'];

/**
 * The OS keyring, as the keyring sees it. In the app this is Electron's
 * safeStorage, which only works in the main process (Main/sealer.js).
 * @typedef {Object} Sealer
 * @property {function(): Promise<Object>} status resolves to
 * {available, backend, strong}; strong is false for Linux basic_text
 * @property {function(string): Promise<Buffer>} seal encrypt
 * @property {function(Buffer): Promise<string>} unseal decrypt
 */

/**
 * The keyring (docs/design/keyring.md): one random 256-bit vault key (VK)
 * that is only ever stored wrapped, by the OS keyring and/or a passphrase.
 * All stored records are encrypted under keys derived from it.
 *
 *     keyring.json = {format, version, check, unlockers: [
 *         {type: 'os-keyring', backend, sealed},
 *         {type: 'passphrase', kdf: 'scrypt', N, r, p, salt, wrapped}]}
 *     check   = HKDF(VK, "", "hexhoot/v2/keyring/check"); detects a wrong
 *               VK from the OS keyring
 *     KEK     = scrypt(NFKC(passphrase), salt, N, r, p)
 *     wrapped = AES-256-GCM(KEK, VK, ad = parts(label, kdf, N, r, p))
 *     K_db, K_secrets = HKDF(VK, "", "hexhoot/v2/db" | "hexhoot/v2/secrets")
 */
class Keyring {
    /**
     * Use Keyring.create() or Keyring.open()
     * @param {string} file path of keyring.json
     * @param {Object} data its contents
     * @param {Object} options see create()
     */
    constructor(file, data, options) {
        this.file = file;
        this.data = data;
        this.sealer = options.sealer || null;
        this.scryptParams = checkScryptParams(
            options.scryptParams || scryptDefaults);
        this.availableMemory = options.availableMemory;
        this.vk = null;
        this.ciphers = [];
    }

    /**
     * Create a keyring with a new vault key. The OS keyring is used when it
     * is strong; otherwise a passphrase is required.
     * @param {Object} options
     * @param {string} options.file path of keyring.json; must not exist
     * @param {Sealer} [options.sealer] the OS keyring
     * @param {string} [options.passphrase] adds a passphrase unlocker
     * @param {Object} [options.scryptParams] {N, r, p}; 2^20, 8, 1 if
     * omitted. Lower values are for tests only.
     * @param {function} [options.availableMemory] for tests
     * @return {Promise<Keyring>} the keyring, unlocked
     * @throws {CryptoError} EXISTS, PASSPHRASE_REQUIRED, LOW_MEMORY
     */
    static async create(options) {
        if (fs.existsSync(options.file)) {
            throw new CryptoError('EXISTS', 'A keyring already exists');
        }
        const status = options.sealer ?
            await options.sealer.status() : {strong: false};
        if (!status.strong && !options.passphrase) {
            throw new CryptoError('PASSPHRASE_REQUIRED',
                'The OS keyring is not available or not secure; ' +
                'a passphrase is needed');
        }
        const keyring = new Keyring(options.file, {
            format: fileFormat, version: fileVersion, check: '',
            unlockers: [],
        }, options);
        keyring.vk = crypto.randomBytes(32);
        try {
            keyring.data.check = keyring.checkValue().toString('base64');
            if (status.strong) {
                keyring.data.unlockers.push(
                    await keyring.osUnlocker(status));
            }
            if (options.passphrase) {
                keyring.data.unlockers.push(
                    await keyring.passphraseUnlocker(options.passphrase));
            }
            keyring.save();
        } catch (err) {
            keyring.lock();
            throw err;
        }
        return keyring;
    }

    /**
     * Whether a keyring file exists
     * @param {string} file path of keyring.json
     * @return {boolean}
     */
    static exists(file) {
        return fs.existsSync(file);
    }

    /**
     * Read a keyring; it starts locked
     * @param {Object} options see create(); passphrase is ignored
     * @return {Keyring} the keyring
     * @throws {CryptoError} NOT_FOUND, CORRUPT
     */
    static open(options) {
        let data;
        try {
            data = JSON.parse(fs.readFileSync(options.file, 'utf8'));
        } catch (err) {
            throw new CryptoError(err.code === 'ENOENT' ? 'NOT_FOUND' :
                'CORRUPT', 'Cannot read the keyring: ' + err.message);
        }
        if (!data || data.format !== fileFormat ||
            data.version !== fileVersion || typeof data.check !== 'string' ||
            !Array.isArray(data.unlockers) || data.unlockers.length === 0) {
            throw new CryptoError('CORRUPT', 'Not a HexHoot keyring');
        }
        return new Keyring(options.file, data, options);
    }

    /**
     * Delete a keyring file. The OS keyring entry is shared by the whole
     * app (safeStorage has one key per app), so nothing is removed there;
     * the sealed vault key lived only in this file.
     * @param {string} file path of keyring.json
     */
    static reset(file) {
        fs.rmSync(file, {force: true});
    }

    /** @return {boolean} whether the vault key is in memory */
    get unlocked() {
        return this.vk !== null;
    }

    /**
     * What the UI needs to know; no secrets
     * @return {Object} {unlocked, unlockers, passphraseRequired}
     */
    info() {
        const types = this.data.unlockers.map((u) => u.type);
        return {
            unlocked: this.unlocked,
            unlockers: types,
            passphraseRequired: !types.includes('os-keyring'),
        };
    }

    /**
     * Unlock with the OS keyring, or with a passphrase if one is given.
     * A passphrase unlocker made with weaker scrypt parameters than the
     * current ones is re-made with the current ones.
     * @param {Object} [options]
     * @param {string} [options.passphrase] the passphrase
     * @throws {CryptoError} PASSPHRASE_REQUIRED, BAD_PASSPHRASE,
     * OS_KEYRING_FAILED, LOW_MEMORY
     */
    async unlock(options = {}) {
        if (this.unlocked) {
            return;
        }
        const vk = options.passphrase !== undefined ?
            await this.unlockWithPassphrase(options.passphrase) :
            await this.unlockWithOS();
        this.vk = vk;
        const unlocker = this.findUnlocker('passphrase');
        if (options.passphrase !== undefined &&
            unlocker.N < this.scryptParams.N) {
            try {
                await this.setPassphrase(options.passphrase);
            } catch (err) {
                // Keep the old unlocker; try again on the next unlock
            }
        }
    }

    /**
     * @return {Promise<Buffer>} the vault key
     */
    async unlockWithOS() {
        const unlocker = this.findUnlocker('os-keyring');
        if (!unlocker) {
            throw new CryptoError('PASSPHRASE_REQUIRED',
                'This keyring is locked with a passphrase');
        }
        let vk;
        try {
            const status = await this.sealer.status();
            if (!status.available) {
                throw new Error('The OS keyring is not available');
            }
            vk = Buffer.from(await this.sealer.unseal(
                Buffer.from(unlocker.sealed, 'base64')), 'base64');
        } catch (err) {
            throw new CryptoError('OS_KEYRING_FAILED',
                'The OS keyring could not unlock HexHoot: ' + err.message);
        }
        if (!this.isVaultKey(vk)) {
            vk.fill(0);
            throw new CryptoError('OS_KEYRING_FAILED',
                'The OS keyring returned the wrong key');
        }
        return vk;
    }

    /**
     * @param {string} passphrase the passphrase
     * @return {Promise<Buffer>} the vault key
     */
    async unlockWithPassphrase(passphrase) {
        const unlocker = this.findUnlocker('passphrase');
        if (!unlocker) {
            throw new CryptoError('BAD_PASSPHRASE',
                'This keyring has no passphrase');
        }
        const params = checkScryptParams(unlocker);
        const kek = await scrypt(passphrase,
            Buffer.from(unlocker.salt, 'base64'), params,
            {availableMemory: this.availableMemory});
        let vk;
        try {
            vk = open(kek, Buffer.from(unlocker.wrapped, 'base64'),
                this.passphraseAD(params));
        } catch (err) {
            throw new CryptoError('BAD_PASSPHRASE', 'Wrong passphrase');
        } finally {
            kek.fill(0);
        }
        if (!this.isVaultKey(vk)) {
            vk.fill(0);
            throw new CryptoError('CORRUPT', 'The keyring check failed');
        }
        return vk;
    }

    /** Forget the vault key and zero every key derived from it */
    lock() {
        this.vk?.fill(0);
        this.vk = null;
        for (const cipher of this.ciphers.splice(0)) {
            cipher.destroy();
        }
    }

    /**
     * Add or replace the passphrase unlocker
     * @param {string} passphrase the new passphrase
     */
    async setPassphrase(passphrase) {
        this.assertUnlocked();
        const unlocker = await this.passphraseUnlocker(passphrase);
        this.data.unlockers = this.data.unlockers
            .filter((u) => u.type !== 'passphrase').concat(unlocker);
        this.save();
    }

    /**
     * Remove the passphrase unlocker. Only allowed while a strong OS
     * keyring can still unlock the keyring.
     * @throws {CryptoError} PASSPHRASE_REQUIRED
     */
    async removePassphrase() {
        this.assertUnlocked();
        const status = this.sealer ?
            await this.sealer.status() : {strong: false};
        if (!this.findUnlocker('os-keyring') || !status.strong) {
            throw new CryptoError('PASSPHRASE_REQUIRED',
                'Without the OS keyring, the passphrase cannot be removed');
        }
        this.data.unlockers = this.data.unlockers
            .filter((u) => u.type !== 'passphrase');
        this.save();
    }

    /**
     * A record cipher for one purpose. It stops working when the keyring
     * is locked.
     * @param {string} purpose 'db' (contacts, messages, preferences) or
     * 'secrets' (identity seed, ratchet sessions)
     * @return {RecordCipher} the cipher
     */
    cipher(purpose) {
        this.assertUnlocked();
        if (!purposes.includes(purpose)) {
            throw new CryptoError('BAD_PARAMS', 'Unknown purpose ' + purpose);
        }
        const cipher = new RecordCipher(hkdf(this.vk, Buffer.alloc(0),
            Buffer.from('hexhoot/v2/' + purpose)));
        this.ciphers.push(cipher);
        return cipher;
    }

    /** @throws {CryptoError} LOCKED */
    assertUnlocked() {
        if (!this.unlocked) {
            throw new CryptoError('LOCKED', 'The keyring is locked');
        }
    }

    /**
     * @param {string} type unlocker type
     * @return {Object|undefined} the unlocker
     */
    findUnlocker(type) {
        return this.data.unlockers.find((u) => u && u.type === type);
    }

    /**
     * @param {Buffer} [vk] a vault key; the keyring's own if omitted
     * @return {Buffer} the check value of a vault key
     */
    checkValue(vk = this.vk) {
        return hkdf(vk, Buffer.alloc(0),
            Buffer.from('hexhoot/v2/keyring/check'));
    }

    /**
     * @param {Buffer} vk a candidate vault key
     * @return {boolean} whether it matches the stored check value
     */
    isVaultKey(vk) {
        const expected = Buffer.from(this.data.check, 'base64');
        return vk.length === 32 && expected.length === 32 &&
            crypto.timingSafeEqual(this.checkValue(vk), expected);
    }

    /**
     * @param {Object} status from the sealer
     * @return {Promise<Object>} an os-keyring unlocker
     */
    async osUnlocker(status) {
        const sealed = await this.sealer.seal(this.vk.toString('base64'));
        return {type: 'os-keyring', backend: String(status.backend),
            sealed: Buffer.from(sealed).toString('base64')};
    }

    /**
     * @param {Object} params {N, r, p}
     * @return {Buffer} associated data that binds the KDF parameters
     */
    passphraseAD(params) {
        return encodeParts('hexhoot/v2/keyring/passphrase', 'scrypt',
            String(params.N), String(params.r), String(params.p));
    }

    /**
     * @param {string} passphrase the passphrase
     * @return {Promise<Object>} a passphrase unlocker
     */
    async passphraseUnlocker(passphrase) {
        const params = this.scryptParams;
        const salt = crypto.randomBytes(32);
        const kek = await scrypt(passphrase, salt, params,
            {availableMemory: this.availableMemory});
        try {
            return {type: 'passphrase', kdf: 'scrypt', ...params,
                salt: salt.toString('base64'),
                wrapped: seal(kek, this.vk, this.passphraseAD(params))
                    .toString('base64')};
        } finally {
            kek.fill(0);
        }
    }

    /** Write keyring.json atomically, readable only by this user */
    save() {
        const temp = path.join(path.dirname(this.file),
            `.${path.basename(this.file)}.${process.pid}.tmp`);
        fs.writeFileSync(temp, JSON.stringify(this.data, null, 2) + '\n',
            {mode: 0o600});
        fs.renameSync(temp, this.file);
    }
}

module.exports = Keyring;
