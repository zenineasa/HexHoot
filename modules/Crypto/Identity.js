/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

const crypto = require('node:crypto');
const {CryptoError, encodeParts, hkdf} = require('./primitives');
const credentials = require('./credentials');
const address = require('./address');

// Sizes (ADR-003)
const ecPublicBytes = 133; // P-521, uncompressed
const pqPublicBytes = 2592; // ML-DSA-87
const ecSignatureBytes = 132; // ECDSA P-521, IEEE P1363 (r ‖ s)
const pqSignatureBytes = 4627; // ML-DSA-87
const signatureBytes = ecSignatureBytes + pqSignatureBytes;
const bundleVersion = 1;
const bundleBodyBytes = 1 + 8 + ecPublicBytes + pqPublicBytes;
const bundleBytes = bundleBodyBytes + signatureBytes;

// Order of the P-521 group (FIPS 186-5, SEC 2)
const p521Order = Buffer.from(
    '01ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' +
    'fa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409',
    'hex');

/**
 * The message that is actually signed: the purpose is part of it, so a
 * signature made for one purpose is never valid for another
 * @param {string} context purpose, for example 'bundle' or 'handshake'
 * @param {Buffer} message the message
 * @return {Buffer} the bytes to sign
 */
function signedBytes(context, message) {
    if (typeof context !== 'string' || context.length === 0) {
        throw new CryptoError('BAD_PARAMS', 'A signature context is needed');
    }
    return encodeParts('hexhoot/v2/sig', context, message);
}

/**
 * @param {Buffer} ikEc P-521 public key, uncompressed
 * @param {Buffer} ikPq ML-DSA-87 public key
 * @return {Buffer} the 32-byte fingerprint
 */
function fingerprintOf(ikEc, ikPq) {
    return crypto.createHash('sha512')
        .update(encodeParts('hexhoot/v2/fp', ikEc, ikPq))
        .digest().subarray(0, 32);
}

/**
 * Derive the P-521 scalar by rejection sampling: 521-bit candidates from
 * HKDF until one lies in [1, n). Almost always the first one does.
 * @param {Buffer} seed the identity seed
 * @return {Buffer} d, 66 bytes
 */
function deriveEcScalar(seed) {
    for (let counter = 0; counter < 1000; counter++) {
        const ctr = Buffer.alloc(4);
        ctr.writeUInt32BE(counter);
        const d = hkdf(seed, Buffer.alloc(0),
            encodeParts('hexhoot/v2/ik-ec', ctr), 66);
        d[0] &= 0x01;
        if (Buffer.compare(d, p521Order) < 0 && d.some((b) => b !== 0)) {
            return d;
        }
        d.fill(0);
    }
    throw new CryptoError('BAD_PARAMS', 'No valid P-521 scalar found');
}

/**
 * Import a P-521 public key; invalid points are rejected by BoringSSL
 * @param {Buffer} point uncompressed point (0x04 ‖ x ‖ y)
 * @return {KeyObject} the key
 */
function importEcPublic(point) {
    if (point.length !== ecPublicBytes || point[0] !== 0x04) {
        throw new CryptoError('BAD_BUNDLE', 'Invalid P-521 public key');
    }
    try {
        return crypto.createPublicKey({format: 'jwk', key: {kty: 'EC',
            crv: 'P-521', x: point.subarray(1, 67).toString('base64url'),
            y: point.subarray(67).toString('base64url')}});
    } catch (err) {
        throw new CryptoError('BAD_BUNDLE', 'Invalid P-521 public key');
    }
}

/**
 * Someone's public identity, from their bundle. Its fingerprint, address
 * and topic are computed from the two public keys.
 */
class PublicIdentity {
    /**
     * Use PublicIdentity.fromBundle()
     * @param {Object} fields {ikEc, ikPq, createdAt, bundle}
     */
    constructor(fields) {
        this.ikEc = fields.ikEc;
        this.ikPq = fields.ikPq;
        this.createdAt = fields.createdAt;
        this.bundle = fields.bundle;
        this.ecKey = importEcPublic(this.ikEc);
        try {
            this.pqKey = crypto.createPublicKey({key: this.ikPq,
                format: 'raw-public', asymmetricKeyType: 'ml-dsa-87'});
        } catch (err) {
            throw new CryptoError('BAD_BUNDLE', 'Invalid ML-DSA-87 key');
        }
        this.fingerprint = fingerprintOf(this.ikEc, this.ikPq);
        this.address = address.fingerprintToAddress(this.fingerprint);
        this.topic = address.topic(this.fingerprint);
    }

    /**
     * Parse a bundle and check its self-signature
     * @param {Buffer} bundle from Identity#bundle
     * @param {Object} [options]
     * @param {Buffer|string} [options.expected] the fingerprint or address
     * the bundle must belong to
     * @return {PublicIdentity} the identity
     * @throws {CryptoError} BAD_BUNDLE, FINGERPRINT_MISMATCH
     */
    static fromBundle(bundle, options = {}) {
        if (!Buffer.isBuffer(bundle) || bundle.length !== bundleBytes ||
            bundle[0] !== bundleVersion) {
            throw new CryptoError('BAD_BUNDLE', 'Not an identity bundle');
        }
        const createdAt = Number(bundle.readBigUInt64BE(1));
        if (!Number.isSafeInteger(createdAt)) {
            throw new CryptoError('BAD_BUNDLE', 'Invalid creation time');
        }
        const ecStart = 9;
        const pqStart = ecStart + ecPublicBytes;
        const identity = new PublicIdentity({
            ikEc: Buffer.from(bundle.subarray(ecStart, pqStart)),
            ikPq: Buffer.from(bundle.subarray(pqStart, bundleBodyBytes)),
            createdAt,
            bundle: Buffer.from(bundle),
        });
        if (options.expected !== undefined) {
            const expected = typeof options.expected === 'string' ?
                address.addressToFingerprint(options.expected) :
                options.expected;
            if (!crypto.timingSafeEqual(identity.fingerprint, expected)) {
                throw new CryptoError('FINGERPRINT_MISMATCH',
                    'The bundle belongs to someone else');
            }
        }
        if (!identity.verify('bundle', bundle.subarray(0, bundleBodyBytes),
            bundle.subarray(bundleBodyBytes))) {
            throw new CryptoError('BAD_BUNDLE', 'Invalid bundle signature');
        }
        return identity;
    }

    /**
     * Check a hybrid signature: both halves must be valid
     * @param {string} context the purpose it was made for
     * @param {Buffer} message the message
     * @param {Buffer} signature from Identity#sign
     * @return {boolean} whether it is valid
     */
    verify(context, message, signature) {
        if (!Buffer.isBuffer(signature) ||
            signature.length !== signatureBytes) {
            return false;
        }
        const data = signedBytes(context, message);
        try {
            return crypto.verify('sha512', data, {key: this.ecKey,
                dsaEncoding: 'ieee-p1363'},
            signature.subarray(0, ecSignatureBytes)) &&
                crypto.verify(null, data, this.pqKey,
                    signature.subarray(ecSignatureBytes));
        } catch (err) {
            return false;
        }
    }

    /**
     * @param {PublicIdentity} other the other person
     * @return {string} the safety number for this pair
     */
    safetyNumber(other) {
        return address.safetyNumber(this.fingerprint, other.fingerprint);
    }
}

/**
 * Our own identity (docs/design/identity-and-addresses.md). Everything is
 * derived from 32 bytes of entropy, which come from the name and password
 * (credentials.js, ADR-004):
 *
 *     seed  = HKDF(entropy, 0^64, "hexhoot/v2/identity-seed", 64)
 *     ik_pq = ML-DSA-87 from HKDF(seed, "", "hexhoot/v2/ik-pq", 32)
 *     ik_ec = P-521 with d = HKDF(seed, "", parts("hexhoot/v2/ik-ec",
 *             u32 ctr), 66), top 7 bits cleared, first ctr with 1 <= d < n
 */
class Identity {
    /**
     * Use fromCredentials() or fromSecret(). Tests may call it directly.
     * @param {Buffer} entropy 32 bytes; the identity keeps it
     * @param {number} createdAt creation time (ms)
     * @param {string} [name] the normalized account name
     */
    constructor(entropy, createdAt, name = '') {
        if (!Buffer.isBuffer(entropy) || entropy.length !== 32) {
            throw new CryptoError('BAD_PARAMS', 'Entropy must be 32 bytes');
        }
        if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
            throw new CryptoError('BAD_PARAMS', 'Invalid creation time');
        }
        this.entropy = entropy;
        this.createdAt = createdAt;
        this.name = name;

        const seed = hkdf(entropy, Buffer.alloc(64),
            Buffer.from('hexhoot/v2/identity-seed'), 64);
        const pqSeed = hkdf(seed, Buffer.alloc(0),
            Buffer.from('hexhoot/v2/ik-pq'), 32);
        const d = deriveEcScalar(seed);
        try {
            this.pqKey = crypto.createPrivateKey({key: pqSeed,
                format: 'raw-seed', asymmetricKeyType: 'ml-dsa-87'});
            const ecdh = crypto.createECDH('secp521r1');
            ecdh.setPrivateKey(d);
            const point = ecdh.getPublicKey();
            this.ecKey = crypto.createPrivateKey({format: 'jwk', key: {
                kty: 'EC', crv: 'P-521', d: d.toString('base64url'),
                x: point.subarray(1, 67).toString('base64url'),
                y: point.subarray(67).toString('base64url')}});
            this.ikEc = point;
        } finally {
            seed.fill(0);
            pqSeed.fill(0);
            d.fill(0);
        }
        this.ikPq = crypto.createPublicKey(this.pqKey)
            .export({format: 'raw-public'});

        const body = Buffer.alloc(bundleBodyBytes);
        body[0] = bundleVersion;
        body.writeBigUInt64BE(BigInt(createdAt), 1);
        this.ikEc.copy(body, 9);
        this.ikPq.copy(body, 9 + ecPublicBytes);
        this.public = new PublicIdentity({ikEc: this.ikEc, ikPq: this.ikPq,
            createdAt, bundle: Buffer.concat([body,
                this.sign('bundle', body)])});
    }

    /**
     * Create or restore an identity from a name and password. The same
     * name and password give the same keys and address on any device. This
     * runs scrypt at N=2^20: about 8 s and 1 GiB.
     * @param {string} name as typed; see credentials.normalizeName
     * @param {string} password as typed
     * @param {Object} [options] {createdAt}; for tests also scryptParams
     * and totalMemory
     * @return {Promise<Identity>} the identity
     * @throws {CryptoError} WEAK_CREDENTIALS, LOW_MEMORY
     */
    static async fromCredentials(name, password, options = {}) {
        const entropy = await credentials.deriveEntropy(name, password,
            options);
        return new Identity(entropy, options.createdAt ?? Date.now(),
            credentials.normalizeName(name));
    }

    /**
     * Load an identity from secret() as stored in the keyring
     * @param {Object} secret {entropy (base64), createdAt, name}
     * @return {Identity} the identity
     */
    static fromSecret(secret) {
        return new Identity(Buffer.from(secret.entropy, 'base64'),
            secret.createdAt, secret.name || '');
    }

    /**
     * Whether the user still remembers their password, for the occasional
     * check (credentials.nextPasswordCheck). Runs the full derivation.
     * @param {string} password as typed
     * @param {Object} [options] for tests: scryptParams, totalMemory
     * @return {Promise<boolean>} whether it gives this identity
     * @throws {CryptoError} LOW_MEMORY
     */
    async checkPassword(password, options = {}) {
        let candidate;
        try {
            candidate = await credentials.deriveEntropy(this.name, password,
                options);
        } catch (err) {
            if (err.code === 'WEAK_CREDENTIALS') {
                return false; // it cannot be the password we derived from
            }
            throw err;
        }
        try {
            return crypto.timingSafeEqual(candidate, this.entropy);
        } finally {
            candidate.fill(0);
        }
    }

    /** @return {Object} what the keyring stores ('secrets' purpose) */
    secret() {
        return {entropy: this.entropy.toString('base64'),
            createdAt: this.createdAt, name: this.name};
    }

    /** @return {Buffer} the 32-byte fingerprint */
    get fingerprint() {
        return this.public.fingerprint;
    }

    /** @return {string} the hh2: address */
    get address() {
        return this.public.address;
    }

    /** @return {Buffer} the signed bundle, 7493 bytes */
    get bundle() {
        return this.public.bundle;
    }

    /**
     * Make a hybrid signature: ECDSA P-521 with SHA-512 ‖ ML-DSA-87
     * @param {string} context the purpose, for example 'handshake'
     * @param {Buffer} message the message
     * @return {Buffer} 4759 bytes
     */
    sign(context, message) {
        const data = signedBytes(context, message);
        return Buffer.concat([
            crypto.sign('sha512', data, {key: this.ecKey,
                dsaEncoding: 'ieee-p1363'}),
            crypto.sign(null, data, this.pqKey),
        ]);
    }

    /**
     * Zero the entropy. Key objects live in BoringSSL and cannot be zeroed
     * from JavaScript; dropping the references lets them be freed.
     */
    destroy() {
        this.entropy.fill(0);
        this.ecKey = null;
        this.pqKey = null;
    }
}

module.exports = {
    Identity, PublicIdentity, sizes: {ecPublicBytes, pqPublicBytes,
        signatureBytes, bundleBytes},
};
