/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// The hybrid KEM "HK" (docs/design/session-and-ratchet.md): ECDH P-521 and
// ML-KEM-1024 together. The shared secret stays safe as long as either one
// holds.
//
//     public key  = P-521 point (133) ‖ ML-KEM-1024 key (1568)       1701 B
//     ciphertext  = ephemeral P-521 point (133) ‖ ML-KEM ct (1568)   1701 B
//     ss = HKDF-SHA-512(ikm = parts(ss_m, ss_e, e_pub, pk_ec, ct_m, pk_m),
//                       salt = 0^64, info = "hexhoot/v2/hk", 64)

const crypto = require('node:crypto');
const {CryptoError, encodeParts, hkdf} = require('./primitives');

const ecBytes = 133;
const kemBytes = 1568;
const publicKeyBytes = ecBytes + kemBytes;
const ciphertextBytes = ecBytes + kemBytes;

/**
 * Combine both halves into one 64-byte secret. Exported for test vectors.
 * @param {Buffer} ssM ML-KEM shared secret (32)
 * @param {Buffer} ssE ECDH shared secret (66)
 * @param {Buffer} ePub ephemeral P-521 point (133)
 * @param {Buffer} pkEc recipient's P-521 point (133)
 * @param {Buffer} ctM ML-KEM ciphertext (1568)
 * @param {Buffer} pkM recipient's ML-KEM key (1568)
 * @return {Buffer} 64 bytes
 */
function combine(ssM, ssE, ePub, pkEc, ctM, pkM) {
    const ikm = encodeParts(ssM, ssE, ePub, pkEc, ctM, pkM);
    try {
        return hkdf(ikm, Buffer.alloc(64), Buffer.from('hexhoot/v2/hk'), 64);
    } finally {
        ikm.fill(0);
    }
}

/**
 * ECDH with a peer's point; BoringSSL rejects points that are not on the
 * curve
 * @param {ECDH} ecdh our key
 * @param {Buffer} point their uncompressed point
 * @return {Buffer} 66 bytes
 */
function dh(ecdh, point) {
    if (point.length !== ecBytes || point[0] !== 0x04) {
        throw new CryptoError('BAD_KEY', 'Invalid P-521 public key');
    }
    try {
        return ecdh.computeSecret(point);
    } catch (err) {
        throw new CryptoError('BAD_KEY', 'Invalid P-521 public key');
    }
}

/**
 * @param {Buffer} raw ML-KEM-1024 public key
 * @return {KeyObject} the key
 */
function importKemPublic(raw) {
    try {
        return crypto.createPublicKey({key: raw, format: 'raw-public',
            asymmetricKeyType: 'ml-kem-1024'});
    } catch (err) {
        throw new CryptoError('BAD_KEY', 'Invalid ML-KEM-1024 public key');
    }
}

/**
 * An HK key pair. Its private halves stay inside this object; destroy()
 * drops them once they are no longer needed (forward secrecy).
 */
class HybridKeyPair {
    /**
     * Generate a fresh key pair, or restore one from export()
     * @param {Object} [saved] {ec, kem} private keys, base64
     */
    constructor(saved) {
        this.ecdh = crypto.createECDH('secp521r1');
        let kemPublic;
        if (saved) {
            this.ecdh.setPrivateKey(Buffer.from(saved.ec, 'base64'));
            this.kemPrivate = crypto.createPrivateKey({
                key: Buffer.from(saved.kem, 'base64'), format: 'raw-seed',
                asymmetricKeyType: 'ml-kem-1024'});
            kemPublic = crypto.createPublicKey(this.kemPrivate);
        } else {
            this.ecdh.generateKeys();
            const kem = crypto.generateKeyPairSync('ml-kem-1024');
            this.kemPrivate = kem.privateKey;
            kemPublic = kem.publicKey;
        }
        this.publicKey = Buffer.concat([this.ecdh.getPublicKey(),
            kemPublic.export({format: 'raw-public'})]);
    }

    /**
     * The private keys, for storage encrypted under the keyring
     * @return {Object} {ec, kem}, base64
     */
    export() {
        if (!this.kemPrivate) {
            throw new CryptoError('BAD_STATE', 'This key pair was destroyed');
        }
        return {ec: this.ecdh.getPrivateKey().toString('base64'),
            kem: this.kemPrivate.export({format: 'raw-seed'})
                .toString('base64')};
    }

    /**
     * Recover the shared secret from a ciphertext made by encapsulate()
     * @param {Buffer} ciphertext 1701 bytes
     * @return {Buffer} the 64-byte shared secret
     * @throws {CryptoError} BAD_KEY for a malformed ciphertext. A tampered
     * ML-KEM half gives a different secret (implicit rejection), which the
     * caller's AEAD then rejects.
     */
    decapsulate(ciphertext) {
        if (!this.kemPrivate) {
            throw new CryptoError('BAD_STATE', 'This key pair was destroyed');
        }
        if (!Buffer.isBuffer(ciphertext) ||
            ciphertext.length !== ciphertextBytes) {
            throw new CryptoError('BAD_KEY', 'Invalid HK ciphertext');
        }
        const ePub = ciphertext.subarray(0, ecBytes);
        const ctM = ciphertext.subarray(ecBytes);
        const ssE = dh(this.ecdh, ePub);
        const ssM = crypto.decapsulate(this.kemPrivate, ctM);
        try {
            return combine(ssM, ssE, ePub, this.publicKey.subarray(0, ecBytes),
                ctM, this.publicKey.subarray(ecBytes));
        } finally {
            ssE.fill(0);
            ssM.fill(0);
        }
    }

    /** Forget the private keys */
    destroy() {
        this.ecdh = null;
        this.kemPrivate = null;
    }
}

/**
 * Encapsulate to a peer's HK public key
 * @param {Buffer} publicKey 1701 bytes
 * @return {Object} {ciphertext (1701 B), sharedSecret (64 B)}
 * @throws {CryptoError} BAD_KEY
 */
function encapsulate(publicKey) {
    if (!Buffer.isBuffer(publicKey) || publicKey.length !== publicKeyBytes) {
        throw new CryptoError('BAD_KEY', 'Invalid HK public key');
    }
    const pkEc = publicKey.subarray(0, ecBytes);
    const pkM = publicKey.subarray(ecBytes);
    const kemKey = importKemPublic(pkM);
    const ephemeral = crypto.createECDH('secp521r1');
    ephemeral.generateKeys();
    const ePub = ephemeral.getPublicKey();
    const ssE = dh(ephemeral, pkEc);
    const {sharedKey: ssM, ciphertext: ctM} = crypto.encapsulate(kemKey);
    try {
        return {
            ciphertext: Buffer.concat([ePub, ctM]),
            sharedSecret: combine(ssM, ssE, ePub, pkEc, ctM, pkM),
        };
    } finally {
        ssE.fill(0);
        ssM.fill(0);
    }
}

module.exports = {
    HybridKeyPair, encapsulate, combine, dh, importKemPublic,
    sizes: {ecBytes, kemBytes, publicKeyBytes, ciphertextBytes},
};
