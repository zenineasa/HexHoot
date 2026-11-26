/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// The Double Ratchet with a P-521 step and an ML-KEM-1024 step in every
// turn (docs/design/session-and-ratchet.md). It starts from a completed
// handshake (handshake.js).
//
//   message = 0x01 ‖ header ‖ AES-256-GCM ciphertext ‖ tag (16)
//   header  = dh (133) ‖ kem_pub (1568) ‖ kem_ct (1568) ‖ u32be pn ‖ u32be n
//   ad      = parts("hexhoot/v2/msg-ad", session_ad, 0x01 ‖ header)
//
//   KDF_RK(RK, dh, ss_k) = HKDF(parts(dh, ss_k), salt = RK, "hexhoot/v2/rk",
//                               128) → RK (64), CK (64)
//   KDF_CK(CK)           = CK' = HMAC(CK, 0x02), MK = HMAC(CK, 0x01)
//   key, nonce           = HKDF(MK, 0^64, "hexhoot/v2/msg", 44) → 32, 12
//
// Every message of a sending chain carries the whole header, so the first
// message of a chain that arrives (whichever it is) completes the turn.

const crypto = require('node:crypto');
const {CryptoError, encodeParts, hkdf} = require('./primitives');
const {HybridKeyPair, dh, importKemPublic, sizes: hkSizes} =
    require('./hybridKem');
const {PublicIdentity} = require('./Identity');

const messageVersion = 1;
const ecBytes = hkSizes.ecBytes;
const kemBytes = hkSizes.kemBytes;
const headerBytes = ecBytes + kemBytes + kemBytes + 4 + 4;
const tagBytes = 16;
const defaults = Object.freeze({
    maxSkip: 2000, // per chain (spec)
    maxSkippedKeys: 5000, // all chains together
    skippedTtl: 7 * 24 * 3600 * 1000, // 7 days (spec)
});

/**
 * @param {Buffer} rk root key
 * @param {Buffer} dhOut P-521 shared secret
 * @param {Buffer} ssK ML-KEM shared secret
 * @return {Object} {rk, ck}, 64 bytes each
 */
function kdfRk(rk, dhOut, ssK) {
    const okm = hkdf(encodeParts(dhOut, ssK), rk,
        Buffer.from('hexhoot/v2/rk'), 128);
    const out = {rk: Buffer.from(okm.subarray(0, 64)),
        ck: Buffer.from(okm.subarray(64))};
    okm.fill(0);
    return out;
}

/**
 * @param {Buffer} ck chain key
 * @return {Object} {ck, mk}: the next chain key and this message's key
 */
function kdfCk(ck) {
    const mac = (byte) => crypto.createHmac('sha512', ck)
        .update(Buffer.from([byte])).digest();
    return {ck: mac(0x02), mk: mac(0x01)};
}

/**
 * Encrypt or decrypt one message with its message key
 * @param {boolean} encrypting direction
 * @param {Buffer} mk message key
 * @param {Buffer} data plaintext, or ciphertext ‖ tag
 * @param {Buffer} ad associated data
 * @return {Buffer} ciphertext ‖ tag, or plaintext
 * @throws {CryptoError} DECRYPT_FAILED
 */
function aead(encrypting, mk, data, ad) {
    const okm = hkdf(mk, Buffer.alloc(64), Buffer.from('hexhoot/v2/msg'), 44);
    const key = okm.subarray(0, 32);
    const nonce = okm.subarray(32);
    try {
        if (encrypting) {
            const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
            cipher.setAAD(ad);
            return Buffer.concat([cipher.update(data), cipher.final(),
                cipher.getAuthTag()]);
        }
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAAD(ad);
        decipher.setAuthTag(data.subarray(data.length - tagBytes));
        return Buffer.concat([
            decipher.update(data.subarray(0, data.length - tagBytes)),
            decipher.final()]);
    } catch (err) {
        throw new CryptoError('DECRYPT_FAILED', 'Message decryption failed');
    } finally {
        okm.fill(0);
    }
}

/**
 * @param {Buffer} message a received message
 * @return {Object} the parsed header and body
 */
function parse(message) {
    if (!Buffer.isBuffer(message) ||
        message.length < 1 + headerBytes + tagBytes) {
        throw new CryptoError('BAD_MESSAGE', 'Not a ratchet message');
    }
    if (message[0] !== messageVersion) {
        throw new CryptoError('UNSUPPORTED_VERSION',
            'Unsupported message version ' + message[0]);
    }
    let offset = 1;
    const take = (n) => message.subarray(offset, offset += n);
    const header = {
        dh: take(ecBytes),
        kemPub: take(kemBytes),
        kemCt: take(kemBytes),
        pn: message.readUInt32BE(offset),
        n: message.readUInt32BE(offset + 4),
    };
    return {header, headerBytes: message.subarray(0, 1 + headerBytes),
        body: message.subarray(1 + headerBytes)};
}

/** @param {...Buffer} buffers zeroed if present */
function wipe(...buffers) {
    for (const buffer of buffers) {
        buffer?.fill(0);
    }
}

/**
 * One end of a session
 */
class Ratchet {
    /**
     * Use Ratchet.fromHandshake() or Ratchet.deserialize()
     * @param {Object} [options] limits: maxSkip, maxSkippedKeys,
     * skippedTtl; now() for tests
     */
    constructor(options = {}) {
        this.options = {...defaults, ...options};
        this.now = options.now || Date.now;
        this.skipped = new Map(); // "dh hex:n" -> {mk, at}
    }

    /**
     * Start a session from a completed handshake
     * @param {Object} session from Initiator#handleM2 or Responder#handleM3
     * @param {Object} [options] see the constructor
     * @return {Ratchet} the ratchet
     */
    static fromHandshake(session, options) {
        const ratchet = new Ratchet(options);
        ratchet.peer = session.peer;
        ratchet.sessionAd = Buffer.from(session.sessionAd);
        ratchet.rk = Buffer.from(session.rootKey);
        ratchet.cks = null;
        ratchet.ckr = null;
        ratchet.dhr = null;
        ratchet.kemr = null;
        ratchet.ns = 0;
        ratchet.nr = 0;
        ratchet.pn = 0;
        if (session.role === 'initiator') {
            // The responder's handshake key is its first ratchet key
            ratchet.dhs = null;
            ratchet.dhr = Buffer.from(session.theirRatchetKey
                .subarray(0, ecBytes));
            ratchet.kemr = Buffer.from(session.theirRatchetKey
                .subarray(ecBytes));
            ratchet.sendingTurn();
        } else {
            ratchet.dhs = session.ourRatchetKeyPair;
        }
        return ratchet;
    }

    /**
     * Whether encrypt() works. The responder can send once the first
     * message from the initiator has arrived, because only then does it
     * have the initiator's ratchet keys.
     * @return {boolean}
     */
    get canSend() {
        return this.cks !== null;
    }

    /**
     * Start a sending chain: fresh P-521 and ML-KEM-1024 keys, and an
     * encapsulation to the peer's current ML-KEM key
     */
    sendingTurn() {
        const keyPair = new HybridKeyPair();
        const {sharedKey, ciphertext} =
            crypto.encapsulate(importKemPublic(this.kemr));
        const dhOut = dh(keyPair.ecdh, this.dhr);
        const {rk, ck} = kdfRk(this.rk, dhOut, sharedKey);
        wipe(dhOut, sharedKey, this.rk, this.cks);
        this.dhs?.destroy();
        this.dhs = keyPair;
        this.rk = rk;
        this.cks = ck;
        this.sendKemCt = ciphertext;
        this.pn = this.ns;
        this.ns = 0;
    }

    /**
     * @param {Buffer|string} plaintext the message; strings are UTF-8
     * @return {Buffer} the encrypted message
     * @throws {CryptoError} NOT_READY
     */
    encrypt(plaintext) {
        if (!this.canSend) {
            throw new CryptoError('NOT_READY',
                'Waiting for the first message from the initiator');
        }
        if (this.ns >= 0xffffffff) {
            throw new CryptoError('BAD_STATE', 'Chain exhausted');
        }
        const numbers = Buffer.alloc(8);
        numbers.writeUInt32BE(this.pn, 0);
        numbers.writeUInt32BE(this.ns, 4);
        const header = Buffer.concat([Buffer.from([messageVersion]),
            this.dhs.publicKey, this.sendKemCt, numbers]);
        const {ck, mk} = kdfCk(this.cks);
        wipe(this.cks);
        this.cks = ck;
        this.ns++;
        try {
            return Buffer.concat([header, aead(true, mk, Buffer.from(plaintext),
                this.ad(header))]);
        } finally {
            wipe(mk);
        }
    }

    /**
     * Decrypt a message. The state only changes if the message is
     * authentic, so a forged or corrupted message cannot break the session.
     * @param {Buffer} message from the peer's encrypt()
     * @return {Buffer} the plaintext
     * @throws {CryptoError} BAD_MESSAGE, UNSUPPORTED_VERSION, BAD_KEY,
     * DECRYPT_FAILED (forged, corrupted or replayed), TOO_MANY_SKIPPED
     */
    decrypt(message) {
        const {header, headerBytes: headerData, body} = parse(message);
        const ad = this.ad(headerData);
        this.pruneSkipped();

        // A message whose key was set aside earlier
        const skippedId = header.dh.toString('hex') + ':' + header.n;
        const skipped = this.skipped.get(skippedId);
        if (skipped) {
            const plaintext = aead(false, skipped.mk, body, ad);
            this.skipped.delete(skippedId);
            wipe(skipped.mk);
            return plaintext;
        }

        // Work on a draft; commit only after the message has decrypted
        const draft = {rk: null, ckr: this.ckr, nr: this.nr, skipped: []};
        const newTurn = !this.ckr || !header.dh.equals(this.dhr);
        try {
            if (newTurn) {
                if (this.ckr) {
                    this.skipKeys(draft, this.dhr, header.pn);
                }
                importKemPublic(header.kemPub); // must be valid before commit
                const ssK = crypto.decapsulate(this.dhs.kemPrivate,
                    header.kemCt);
                const dhOut = dh(this.dhs.ecdh, header.dh);
                const next = kdfRk(this.rk, dhOut, ssK);
                wipe(ssK, dhOut);
                if (draft.ckr !== this.ckr) {
                    wipe(draft.ckr); // the old chain's last key
                }
                draft.rk = next.rk;
                draft.ckr = next.ck;
                draft.nr = 0;
            } else if (header.n < draft.nr) {
                throw new CryptoError('DECRYPT_FAILED',
                    'Replayed or expired message');
            }
            this.skipKeys(draft, header.dh, header.n);
            const {ck, mk} = kdfCk(draft.ckr);
            if (draft.ckr !== this.ckr) {
                wipe(draft.ckr);
            }
            draft.ckr = ck;
            draft.nr = header.n + 1;
            let plaintext;
            try {
                plaintext = aead(false, mk, body, ad);
            } finally {
                wipe(mk);
            }

            // Commit
            if (newTurn) {
                wipe(this.rk);
                this.rk = draft.rk;
                this.dhr = Buffer.from(header.dh);
                this.kemr = Buffer.from(header.kemPub);
            }
            wipe(this.ckr);
            this.ckr = draft.ckr;
            this.nr = draft.nr;
            for (const [id, key] of draft.skipped) {
                this.skipped.set(id, {mk: key, at: this.now()});
            }
            draft.skipped = [];
            this.pruneSkipped();
            if (newTurn) {
                this.sendingTurn();
            }
            return plaintext;
        } catch (err) {
            if (draft.rk) {
                wipe(draft.rk);
            }
            if (draft.ckr !== this.ckr) {
                wipe(draft.ckr);
            }
            for (const [, key] of draft.skipped) {
                wipe(key);
            }
            if (err instanceof CryptoError) {
                throw err;
            }
            throw new CryptoError('BAD_KEY', 'Invalid message: ' +
                err.message);
        }
    }

    /**
     * Set aside the keys of messages that have not arrived yet
     * @param {Object} draft the draft state
     * @param {Buffer} dhPub the chain's ratchet key
     * @param {number} until the message number to stop before
     */
    skipKeys(draft, dhPub, until) {
        if (until - draft.nr > this.options.maxSkip) {
            throw new CryptoError('TOO_MANY_SKIPPED',
                `More than ${this.options.maxSkip} missing messages`);
        }
        const prefix = dhPub.toString('hex') + ':';
        while (draft.nr < until) {
            const {ck, mk} = kdfCk(draft.ckr);
            if (draft.ckr !== this.ckr) {
                wipe(draft.ckr);
            }
            draft.ckr = ck;
            draft.skipped.push([prefix + draft.nr, mk]);
            draft.nr++;
        }
    }

    /** Drop skipped keys that are too old, then the oldest over the cap */
    pruneSkipped() {
        const oldest = this.now() - this.options.skippedTtl;
        for (const [id, entry] of this.skipped) {
            if (entry.at < oldest ||
                this.skipped.size > this.options.maxSkippedKeys) {
                wipe(entry.mk);
                this.skipped.delete(id);
            }
        }
    }

    /**
     * @param {Buffer} header version byte and header
     * @return {Buffer} the associated data
     */
    ad(header) {
        return encodeParts('hexhoot/v2/msg-ad', this.sessionAd, header);
    }

    /**
     * The whole state, for storage encrypted under the keyring's 'secrets'
     * key. It holds private keys: never store it anywhere else.
     * @return {Object} JSON-safe state
     */
    serialize() {
        const b64 = (buffer) => buffer ? buffer.toString('base64') : null;
        return {
            version: 1,
            peer: b64(this.peer?.bundle),
            sessionAd: b64(this.sessionAd),
            rk: b64(this.rk), cks: b64(this.cks), ckr: b64(this.ckr),
            dhs: this.dhs ? this.dhs.export() : null,
            dhr: b64(this.dhr), kemr: b64(this.kemr),
            sendKemCt: b64(this.sendKemCt),
            ns: this.ns, nr: this.nr, pn: this.pn,
            skipped: [...this.skipped].map(([id, e]) =>
                [id, b64(e.mk), e.at]),
        };
    }

    /**
     * @param {Object} state from serialize()
     * @param {Object} [options] see the constructor
     * @return {Ratchet} the ratchet
     */
    static deserialize(state, options) {
        if (!state || state.version !== 1) {
            throw new CryptoError('CORRUPT', 'Unknown session format');
        }
        const buf = (text) => text ? Buffer.from(text, 'base64') : null;
        const ratchet = new Ratchet(options);
        ratchet.peer = state.peer ?
            PublicIdentity.fromBundle(buf(state.peer)) : null;
        ratchet.sessionAd = buf(state.sessionAd);
        ratchet.rk = buf(state.rk);
        ratchet.cks = buf(state.cks);
        ratchet.ckr = buf(state.ckr);
        ratchet.dhs = state.dhs ? new HybridKeyPair(state.dhs) : null;
        ratchet.dhr = buf(state.dhr);
        ratchet.kemr = buf(state.kemr);
        ratchet.sendKemCt = buf(state.sendKemCt);
        ratchet.ns = state.ns;
        ratchet.nr = state.nr;
        ratchet.pn = state.pn;
        for (const [id, mk, at] of state.skipped) {
            ratchet.skipped.set(id, {mk: buf(mk), at});
        }
        return ratchet;
    }

    /** Zero every key; the ratchet cannot be used afterwards */
    destroy() {
        wipe(this.rk, this.cks, this.ckr);
        this.rk = this.cks = this.ckr = null;
        for (const entry of this.skipped.values()) {
            wipe(entry.mk);
        }
        this.skipped.clear();
        this.dhs?.destroy();
        this.dhs = null;
    }
}

module.exports = {
    Ratchet, sizes: {headerBytes: 1 + headerBytes, tagBytes},
    internals: {kdfRk}, // for tests
};
