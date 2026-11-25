/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

// Capability guard (testing layer L1). HexHoot 2.0 uses only the crypto built
// into Electron (docs/decisions/adr-002-builtin-crypto-only.md) with the suite
// in docs/decisions/adr-003-hybrid-pq-algorithm-choice.md. This test fails if
// an Electron upgrade drops or changes any primitive that the suite needs.
//
// Run with: npm run test:capability (it must run inside Electron, see
// scripts/electron-node.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
const msg = Buffer.from('hexhoot capability guard');

test('runs inside Electron (BoringSSL), not a system Node', function() {
    assert.ok(process.versions.electron,
        'Run through scripts/electron-node.js');
    assert.equal(process.versions.openssl, '0.0.0',
        'Expected BoringSSL (Electron reports OpenSSL as 0.0.0)');
});

test('ML-KEM-1024: sizes, round trip, deterministic seed', function() {
    const {publicKey, privateKey} = crypto.generateKeyPairSync('ml-kem-1024');
    assert.equal(publicKey.export({format: 'raw-public'}).length, 1568);

    const {sharedKey, ciphertext} = crypto.encapsulate(publicKey);
    assert.equal(ciphertext.length, 1568);
    assert.equal(sharedKey.length, 32);
    assert.deepEqual(crypto.decapsulate(privateKey, ciphertext), sharedKey);

    // A tampered ciphertext must give a different (implicitly rejected) key
    const tampered = Buffer.from(ciphertext);
    tampered[0] ^= 1;
    assert.notDeepEqual(crypto.decapsulate(privateKey, tampered), sharedKey);

    // Keys derived from the recovery phrase: same 64-byte seed, same key
    const seed = Buffer.alloc(64, 7);
    const fromSeed = () => crypto.createPublicKey(crypto.createPrivateKey({
        key: seed, format: 'raw-seed', asymmetricKeyType: 'ml-kem-1024',
    })).export({format: 'raw-public'});
    assert.deepEqual(fromSeed(), fromSeed());
});

test('ML-DSA-87: sizes, sign/verify, deterministic seed', function() {
    const seed = Buffer.alloc(32, 3);
    const privateKey = crypto.createPrivateKey(
        {key: seed, format: 'raw-seed', asymmetricKeyType: 'ml-dsa-87'});
    const publicKey = crypto.createPublicKey(privateKey);
    assert.equal(publicKey.export({format: 'raw-public'}).length, 2592);
    assert.deepEqual(publicKey.export({format: 'raw-public'}),
        crypto.createPublicKey(crypto.createPrivateKey(
            {key: seed, format: 'raw-seed', asymmetricKeyType: 'ml-dsa-87'}),
        ).export({format: 'raw-public'}));

    const signature = crypto.sign(null, msg, privateKey);
    assert.equal(signature.length, 4627);
    assert.ok(crypto.verify(null, msg, publicKey, signature));
    assert.ok(!crypto.verify(null, Buffer.from('other'), publicKey,
        signature));
});

test('P-521: ECDH, ECDSA-SHA-512 (P1363), key from scalar', function() {
    const a = crypto.generateKeyPairSync('ec', {namedCurve: 'P-521'});
    const b = crypto.generateKeyPairSync('ec', {namedCurve: 'P-521'});
    const ab = crypto.diffieHellman(
        {privateKey: a.privateKey, publicKey: b.publicKey});
    assert.equal(ab.length, 66);
    assert.deepEqual(ab, crypto.diffieHellman(
        {privateKey: b.privateKey, publicKey: a.publicKey}));

    const sig = crypto.sign('sha512', msg,
        {key: a.privateKey, dsaEncoding: 'ieee-p1363'});
    assert.equal(sig.length, 132);
    assert.ok(crypto.verify('sha512', msg,
        {key: a.publicKey, dsaEncoding: 'ieee-p1363'}, sig));

    // Identity keys are derived from a scalar (docs/design/identity-and-
    // addresses.md): import d through createECDH and a JWK
    const d = Buffer.alloc(66, 0x11);
    d[0] &= 0x01; // below the group order
    const ecdh = crypto.createECDH('secp521r1');
    ecdh.setPrivateKey(d);
    const point = ecdh.getPublicKey();
    const key = crypto.createPrivateKey({format: 'jwk', key: {
        kty: 'EC', crv: 'P-521', d: d.toString('base64url'),
        x: point.subarray(1, 67).toString('base64url'),
        y: point.subarray(67).toString('base64url'),
    }});
    const derivedSig = crypto.sign('sha512', msg,
        {key: key, dsaEncoding: 'ieee-p1363'});
    assert.ok(crypto.verify('sha512', msg, {key: crypto.createPublicKey(key),
        dsaEncoding: 'ieee-p1363'}, derivedSig));
});

test('P-521: invalid public points are rejected', function() {
    const offCurve = {kty: 'EC', crv: 'P-521',
        x: Buffer.alloc(66, 1).toString('base64url'),
        y: Buffer.alloc(66, 2).toString('base64url')};
    assert.throws(() => crypto.createPublicKey({key: offCurve,
        format: 'jwk'}));

    const ecdh = crypto.createECDH('secp521r1');
    ecdh.generateKeys();
    const bad = Buffer.concat([Buffer.from([4]), Buffer.alloc(132, 5)]);
    assert.throws(() => ecdh.computeSecret(bad));
});

test('AES-256-GCM: round trip, tampering is detected', function() {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const aad = Buffer.from('table|record');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const ct = Buffer.concat([cipher.update(msg), cipher.final()]);
    const tag = cipher.getAuthTag();
    assert.equal(tag.length, 16);

    const open = (c, t, a) => {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(a);
        decipher.setAuthTag(t);
        return Buffer.concat([decipher.update(c), decipher.final()]);
    };
    assert.deepEqual(open(ct, tag, aad), msg);
    const flipped = Buffer.from(ct);
    flipped[0] ^= 1;
    assert.throws(() => open(flipped, tag, aad));
    assert.throws(() => open(ct, tag, Buffer.from('other|record')));
});

test('SHA-512 and HMAC-SHA-512 match published vectors', function() {
    // FIPS 180-4 example, "abc"
    assert.equal(crypto.createHash('sha512').update('abc').digest('hex'),
        'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
        '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');
    // RFC 4231 test case 2
    assert.equal(crypto.createHmac('sha512', 'Jefe')
        .update('what do ya want for nothing?').digest('hex'),
    '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea250554' +
    '9758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737');
});

test('HKDF-SHA-512 matches extract-then-expand built from HMAC', function() {
    const ikm = Buffer.alloc(32, 0x0b);
    const salt = Buffer.from('salt');
    const info = Buffer.from('hexhoot/v2/test');
    const length = 100;

    const prk = crypto.createHmac('sha512', salt).update(ikm).digest();
    let t = Buffer.alloc(0);
    let okm = Buffer.alloc(0);
    for (let i = 1; okm.length < length; i++) {
        t = crypto.createHmac('sha512', prk)
            .update(Buffer.concat([t, info, Buffer.from([i])])).digest();
        okm = Buffer.concat([okm, t]);
    }
    assert.deepEqual(
        Buffer.from(crypto.hkdfSync('sha512', ikm, salt, info, length)),
        okm.subarray(0, length));
});

/**
 * Promise wrapper for crypto.scrypt.
 * @param {number} N CPU/memory cost
 * @return {Promise<Buffer>} 64-byte key for the RFC 7914 inputs
 */
function rfc7914Scrypt(N) {
    return new Promise(function(resolve, reject) {
        crypto.scrypt('pleaseletmein', 'SodiumChloride', 64,
            {N: N, r: 8, p: 1, maxmem: 128 * N * 8 + 2 ** 28},
            (err, key) => (err ? reject(err) : resolve(key)));
    });
}

test('scrypt matches RFC 7914 (N=2^14)', async function() {
    assert.deepEqual(await rfc7914Scrypt(2 ** 14), hex(`
        70 23 bd cb 3a fd 73 48 46 1c 06 cd 81 fd 38 eb
        fd a8 fb ba 90 4f 8e 3e a9 b5 43 f6 54 5d a1 f2
        d5 43 29 55 61 3f 0f cf 62 d4 97 05 24 2a 9a f9
        e6 1e 85 dc 0d 65 1e 40 df cf 01 7b 45 57 58 87`));
});

// The passphrase unlocker and backups use N=2^20; 2^21 crashes Electron, so
// 2^20 is the cap (docs/assessment/electron-crypto-capabilities.md). It needs
// 1 GiB and takes from seconds to minutes depending on free memory, so it
// runs in CI, or locally with HEXHOOT_SLOW_TESTS=1.
const runSlow = Boolean(process.env.CI || process.env.HEXHOOT_SLOW_TESTS);
test('scrypt N=2^20, r=8, p=1 completes (RFC 7914 vector)',
    {skip: runSlow ? false : 'set HEXHOOT_SLOW_TESTS=1 to run'},
    async function() {
        assert.deepEqual(await rfc7914Scrypt(2 ** 20), hex(`
            21 01 cb 9b 6a 51 1a ae ad db be 09 cf 70 f8 81
            ec 56 8d 57 4a 2f fd 4d ab e5 ee 98 20 ad aa 47
            8e 56 fd 8f 4b a5 d0 9f fa 1c 6d 92 7c 40 f4 c3
            37 30 40 49 e8 a9 52 fb cb f4 5c 6f a7 7a 41 a4`));
    });

test('node:sqlite is available for Core storage', function() {
    const {DatabaseSync} = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE records (id TEXT PRIMARY KEY, body BLOB)');
    db.prepare('INSERT INTO records VALUES (?, ?)')
        .run('a', Buffer.from([1, 2, 3]));
    const row = db.prepare('SELECT body FROM records WHERE id = ?').get('a');
    assert.deepEqual(Buffer.from(row.body), Buffer.from([1, 2, 3]));
    db.close();
});
