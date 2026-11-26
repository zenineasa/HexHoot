/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// The SIGMA-I handshake over HK (docs/design/session-and-ratchet.md). The
// initiator (A) knows the responder's (B's) address; B learns who A is only
// at M3, and only after A has checked B. Neither identity is ever sent in
// the clear.
//
//   M1 = 0x01 ‖ 0x02 (version) ‖ sid_A (32) ‖ hk_pk_A (1701)
//   M2 = 0x02 ‖ sid_B (32) ‖ HK ciphertext to hk_pk_A (1701) ‖ hk_pk_B (1701)
//        ‖ AEAD(k_B, bundle_B ‖ Sig_B("handshake-responder", T2)
//                    ‖ HMAC(k_mac, parts("B", fp_B)), ad = parts(.., T2))
//   M3 = 0x03 ‖ AEAD(k_A, bundle_A ‖ Sig_A("handshake-initiator", T3)
//                    ‖ HMAC(k_mac, parts("A", fp_A)), ad = parts(.., T3))
//
//   k_A, k_B, k_mac (32 each), RK0 (64)
//              = HKDF(ss, sid_A ‖ sid_B, "hexhoot/v2/hs", 160)
//   T2         = SHA-512(parts("hexhoot/v2/hs-t2", M1, M2 before the AEAD))
//   T3         = SHA-512(parts("hexhoot/v2/hs-t3", T2, M2's AEAD part))
//   session_ad = SHA-512(parts("hexhoot/v2/hs-session", T3, M3))
//
// hk_pk_B becomes B's first ratchet key: A starts the ratchet by sending
// to it (the Double Ratchet's "Bob's signed prekey" role).

const crypto = require('node:crypto');
const {CryptoError, encodeParts, hkdf, seal, open} = require('./primitives');
const {PublicIdentity, sizes: idSizes} = require('./Identity');
const hk = require('./hybridKem');
const address = require('./address');

const protocolVersion = 2;
const sidBytes = 32;
const macBytes = 64;
const payloadBytes = idSizes.bundleBytes + idSizes.signatureBytes + macBytes;
const sealedBytes = 12 + payloadBytes + 16;
const m1Bytes = 2 + sidBytes + hk.sizes.publicKeyBytes;
const m2ClearBytes = 1 + sidBytes + hk.sizes.ciphertextBytes +
    hk.sizes.publicKeyBytes;
const m2Bytes = m2ClearBytes + sealedBytes;
const m3Bytes = 1 + sealedBytes;

/**
 * @param {string} label domain label
 * @param {...Buffer} parts data
 * @return {Buffer} SHA-512 of the encoded parts
 */
function hash(label, ...parts) {
    return crypto.createHash('sha512').update(encodeParts(label, ...parts))
        .digest();
}

/**
 * @param {Buffer} ss HK shared secret
 * @param {Buffer} sidA initiator's sid
 * @param {Buffer} sidB responder's sid
 * @return {Object} {kA, kB, kMac, rootKey}
 */
function deriveKeys(ss, sidA, sidB) {
    const okm = hkdf(ss, Buffer.concat([sidA, sidB]),
        Buffer.from('hexhoot/v2/hs'), 160);
    const keys = {
        kA: Buffer.from(okm.subarray(0, 32)),
        kB: Buffer.from(okm.subarray(32, 64)),
        kMac: Buffer.from(okm.subarray(64, 96)),
        rootKey: Buffer.from(okm.subarray(96, 160)),
    };
    okm.fill(0);
    return keys;
}

/**
 * @param {Buffer} key k_mac
 * @param {string} role 'A' or 'B'
 * @param {Buffer} fingerprint the sender's fingerprint
 * @return {Buffer} the MAC
 */
function identityMac(key, role, fingerprint) {
    return crypto.createHmac('sha512', key)
        .update(encodeParts(role, fingerprint)).digest();
}

/**
 * Seal the identity part of M2 or M3
 * @param {Object} identity our Identity
 * @param {Object} options {key, kMac, role, context, transcript, label}
 * @return {Buffer} the sealed part
 */
function sealIdentity(identity, options) {
    const payload = Buffer.concat([identity.bundle,
        identity.sign(options.context, options.transcript),
        identityMac(options.kMac, options.role, identity.fingerprint)]);
    return seal(options.key, payload,
        encodeParts(options.label, options.transcript));
}

/**
 * Open and check the identity part of M2 or M3
 * @param {Buffer} sealed the sealed part
 * @param {Object} options as for sealIdentity, plus 'expected'
 * @return {PublicIdentity} the sender
 * @throws {CryptoError} HANDSHAKE_FAILED, FINGERPRINT_MISMATCH
 */
function openIdentity(sealed, options) {
    let payload;
    try {
        payload = open(options.key, sealed,
            encodeParts(options.label, options.transcript));
    } catch (err) {
        throw new CryptoError('HANDSHAKE_FAILED',
            'The handshake was tampered with');
    }
    const bundleEnd = idSizes.bundleBytes;
    const sigEnd = bundleEnd + idSizes.signatureBytes;
    let peer;
    try {
        peer = PublicIdentity.fromBundle(payload.subarray(0, bundleEnd),
            options.expected === undefined ? {} :
                {expected: options.expected});
    } catch (err) {
        if (err.code === 'FINGERPRINT_MISMATCH') {
            throw err;
        }
        throw new CryptoError('HANDSHAKE_FAILED', 'Invalid identity bundle');
    }
    const mac = identityMac(options.kMac, options.role, peer.fingerprint);
    if (!peer.verify(options.context, options.transcript,
        payload.subarray(bundleEnd, sigEnd)) ||
        !crypto.timingSafeEqual(mac, payload.subarray(sigEnd))) {
        throw new CryptoError('HANDSHAKE_FAILED',
            'Invalid handshake signature');
    }
    return peer;
}

/**
 * @param {Buffer} message a received message
 * @param {number} type expected type byte
 * @param {number} length expected length
 */
function checkMessage(message, type, length) {
    if (!Buffer.isBuffer(message) || message.length < 2 ||
        message[0] !== type) {
        throw new CryptoError('BAD_MESSAGE', 'Unexpected handshake message');
    }
    if (type === 1 && message[1] !== protocolVersion) {
        throw new CryptoError('UNSUPPORTED_VERSION',
            'Unsupported protocol version ' + message[1]);
    }
    if (message.length !== length) {
        throw new CryptoError('BAD_MESSAGE', 'Wrong handshake message size');
    }
}

/** @param {Object} keys from deriveKeys; zeroes the handshake-only keys */
function wipe(keys) {
    keys.kA.fill(0);
    keys.kB.fill(0);
    keys.kMac.fill(0);
}

/**
 * The side that knows the other's address and starts the handshake
 */
class Initiator {
    /**
     * @param {Object} options
     * @param {Identity} options.identity our identity
     * @param {string|Buffer} options.expected the address (or fingerprint)
     * we are dialling; any other responder is rejected
     */
    constructor(options) {
        this.identity = options.identity;
        this.expected = typeof options.expected === 'string' ?
            address.addressToFingerprint(options.expected) : options.expected;
        this.state = 'new';
    }

    /** @return {Buffer} M1 */
    start() {
        if (this.state !== 'new') {
            throw new CryptoError('BAD_STATE', 'Already started');
        }
        this.sid = crypto.randomBytes(sidBytes);
        this.keyPair = new hk.HybridKeyPair();
        this.m1 = Buffer.concat([Buffer.from([1, protocolVersion]), this.sid,
            this.keyPair.publicKey]);
        this.state = 'sent-m1';
        return this.m1;
    }

    /**
     * @param {Buffer} m2 the responder's reply
     * @return {Object} {message: M3 to send, session}
     * @throws {CryptoError} BAD_MESSAGE, HANDSHAKE_FAILED,
     * FINGERPRINT_MISMATCH, BAD_KEY, BAD_STATE
     */
    handleM2(m2) {
        if (this.state !== 'sent-m1') {
            throw new CryptoError('BAD_STATE', 'Not expecting M2');
        }
        checkMessage(m2, 2, m2Bytes);
        this.state = 'failed'; // until it succeeds; a handshake is one-shot
        let offset = 1;
        const take = (n) => m2.subarray(offset, offset += n);
        const sidB = take(sidBytes);
        const ciphertext = take(hk.sizes.ciphertextBytes);
        const theirRatchetKey = Buffer.from(take(hk.sizes.publicKeyBytes));
        const sealedB = m2.subarray(m2ClearBytes);

        let ss;
        try {
            ss = this.keyPair.decapsulate(ciphertext);
        } finally {
            this.keyPair.destroy();
        }
        const keys = deriveKeys(ss, this.sid, sidB);
        ss.fill(0);
        try {
            const t2 = hash('hexhoot/v2/hs-t2', this.m1,
                m2.subarray(0, m2ClearBytes));
            const peer = openIdentity(sealedB, {key: keys.kB,
                kMac: keys.kMac, role: 'B', context: 'handshake-responder',
                transcript: t2, label: 'hexhoot/v2/hs-m2',
                expected: this.expected});
            const t3 = hash('hexhoot/v2/hs-t3', t2, sealedB);
            const m3 = Buffer.concat([Buffer.from([3]),
                sealIdentity(this.identity, {key: keys.kA, kMac: keys.kMac,
                    role: 'A', context: 'handshake-initiator',
                    transcript: t3, label: 'hexhoot/v2/hs-m3'})]);
            this.state = 'done';
            return {message: m3, session: {
                role: 'initiator', peer, rootKey: keys.rootKey,
                sessionAd: hash('hexhoot/v2/hs-session', t3, m3),
                theirRatchetKey,
            }};
        } catch (err) {
            keys.rootKey.fill(0);
            throw err;
        } finally {
            wipe(keys);
        }
    }
}

/**
 * The side that is dialled. It answers anyone who knows its address, and
 * decides at M3, once it knows who the initiator is.
 */
class Responder {
    /**
     * @param {Object} options
     * @param {Identity} options.identity our identity
     * @param {function} [options.authorize] called with the initiator's
     * PublicIdentity; returns (or resolves to) whether to accept them.
     * Everyone is accepted if omitted.
     */
    constructor(options) {
        this.identity = options.identity;
        this.authorize = options.authorize || (() => true);
        this.state = 'new';
    }

    /**
     * @param {Buffer} m1 the initiator's first message
     * @return {Buffer} M2
     * @throws {CryptoError} BAD_MESSAGE, UNSUPPORTED_VERSION, BAD_KEY
     */
    handleM1(m1) {
        if (this.state !== 'new') {
            throw new CryptoError('BAD_STATE', 'Not expecting M1');
        }
        checkMessage(m1, 1, m1Bytes);
        this.state = 'failed';
        this.theirSid = Buffer.from(m1.subarray(2, 2 + sidBytes));
        const {ciphertext, sharedSecret} =
            hk.encapsulate(m1.subarray(2 + sidBytes));
        const sid = crypto.randomBytes(sidBytes);
        this.keys = deriveKeys(sharedSecret, this.theirSid, sid);
        sharedSecret.fill(0);
        this.ratchetKeyPair = new hk.HybridKeyPair();

        const clear = Buffer.concat([Buffer.from([2]), sid, ciphertext,
            this.ratchetKeyPair.publicKey]);
        const t2 = hash('hexhoot/v2/hs-t2', m1, clear);
        const sealedB = sealIdentity(this.identity, {key: this.keys.kB,
            kMac: this.keys.kMac, role: 'B', context: 'handshake-responder',
            transcript: t2, label: 'hexhoot/v2/hs-m2'});
        this.t3 = hash('hexhoot/v2/hs-t3', t2, sealedB);
        this.state = 'sent-m2';
        return Buffer.concat([clear, sealedB]);
    }

    /**
     * @param {Buffer} m3 the initiator's last message
     * @return {Promise<Object>} the session
     * @throws {CryptoError} BAD_MESSAGE, HANDSHAKE_FAILED, UNAUTHORIZED
     */
    async handleM3(m3) {
        if (this.state !== 'sent-m2') {
            throw new CryptoError('BAD_STATE', 'Not expecting M3');
        }
        checkMessage(m3, 3, m3Bytes);
        this.state = 'failed';
        const keys = this.keys;
        this.keys = null;
        try {
            const peer = openIdentity(m3.subarray(1), {key: keys.kA,
                kMac: keys.kMac, role: 'A', context: 'handshake-initiator',
                transcript: this.t3, label: 'hexhoot/v2/hs-m3'});
            if (peer.address === this.identity.address) {
                throw new CryptoError('HANDSHAKE_FAILED',
                    'A handshake with ourselves');
            }
            if (!await this.authorize(peer)) {
                throw new CryptoError('UNAUTHORIZED', 'Not accepted');
            }
            this.state = 'done';
            return {
                role: 'responder', peer, rootKey: keys.rootKey,
                sessionAd: hash('hexhoot/v2/hs-session', this.t3, m3),
                ourRatchetKeyPair: this.ratchetKeyPair,
            };
        } catch (err) {
            keys.rootKey.fill(0);
            this.ratchetKeyPair.destroy();
            throw err;
        } finally {
            wipe(keys);
        }
    }
}

/**
 * When both sides start a handshake at the same time, both keep the one
 * whose initiator's sid is lower, and drop the other
 * @param {Buffer} ourSid the sid of the handshake we started
 * @param {Buffer} theirSid the sid in the M1 we received
 * @return {string} 'ours' (ignore their M1) or 'theirs' (abandon ours and
 * answer theirs)
 */
function resolveSimultaneous(ourSid, theirSid) {
    return Buffer.compare(ourSid, theirSid) < 0 ? 'ours' : 'theirs';
}

module.exports = {
    Initiator, Responder, resolveSimultaneous,
    sizes: {m1Bytes, m2Bytes, m3Bytes},
};
