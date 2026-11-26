/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L1 tests of identities, recovery phrases and addresses
// (docs/design/identity-and-addresses.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {Identity, PublicIdentity, sizes} =
    require('../../modules/Crypto/Identity');
const {entropyToPhrase, phraseToEntropy, wordlist} =
    require('../../modules/Crypto/phrase');
const address = require('../../modules/Crypto/address');
const {encodeParts} = require('../../modules/Crypto/primitives');

// 256-bit vectors from trezor/python-mnemonic vectors.json (BIP-39)
const bip39Vectors = [
    ['00'.repeat(32), 'abandon '.repeat(23) + 'art'],
    ['7f'.repeat(32), 'legal winner thank year wave sausage worth useful ' +
        'legal winner thank year wave sausage worth useful legal winner ' +
        'thank year wave sausage worth title'],
    ['80'.repeat(32), 'letter advice cage absurd amount doctor acoustic ' +
        'avoid letter advice cage absurd amount doctor acoustic avoid ' +
        'letter advice cage absurd amount doctor acoustic bless'],
    ['ff'.repeat(32), 'zoo '.repeat(23) + 'vote'],
    ['68a79eaca2324873eacc50cb9c6eca8cc68ea5d936f98787c60c7ebc74e6ce7c',
        'hamster diagram private dutch cause delay private meat slide ' +
        'toddler razor book happy fancy gospel tennis maple dilemma loan ' +
        'word shrug inflict delay length'],
    ['f585c11aec520db57dd353c69554b21a89b20fb0650966fa0a9d6f74fd989d8f',
        'void come effort suffer camp survey warrior heavy shoot primary ' +
        'clutch crush open amazing screen patrol group space point ten ' +
        'exist slush involve unfold'],
];

// Known-answer values for entropy 00 01 … 1f, created at 1e12 ms. They pin
// the derivation; the WebCrypto test below checks it independently.
const kat = {
    entropy: Buffer.from(Array.from({length: 32}, (_, i) => i)),
    createdAt: 1e12,
    address: 'hh21v8hmcyjd6ajy5sc9k8extxfpcwzges4k0hkyex0fa7pzj4qaj96q3vnscy',
    ikEcSha256:
        'd0799f7355c2f800fdc2fae5994dc125e82c44789c4942bc955e4350a64e36f9',
    ikPqSha256:
        '63407ba26c5eb03dcb9d2a68fa74557e552e390b91e40b860f13ceebfefb71ff',
};

const sha256 = (data) => crypto.createHash('sha256').update(data)
    .digest('hex');

test('The word list is the published BIP-39 list', () => {
    const list = wordlist();
    assert.equal(list.length, 2048);
    assert.equal(new Set(list).size, 2048);
    // Every word is identified by its first four letters
    assert.equal(new Set(list.map((w) => w.slice(0, 4))).size, 2048);
});

test('Recovery phrases match the BIP-39 vectors', () => {
    for (const [entropy, phrase] of bip39Vectors) {
        assert.equal(entropyToPhrase(Buffer.from(entropy, 'hex')), phrase);
        assert.equal(phraseToEntropy(phrase).toString('hex'), entropy);
    }
});

test('Phrases are read as typed, and mistakes are caught', () => {
    const [entropy, phrase] = bip39Vectors[4];
    const sloppy = '  ' + phrase.toUpperCase().replace(/ /g, ' \n\t ') + ' ';
    assert.equal(phraseToEntropy(sloppy).toString('hex'), entropy);

    const words = phrase.split(' ');
    assert.throws(() => phraseToEntropy(words.slice(1).join(' ')),
        {code: 'BAD_PHRASE', message: /24 words, not 23/});
    assert.throws(() => phraseToEntropy(['hamstr', ...words.slice(1)]
        .join(' ')), {code: 'BAD_PHRASE', word: 'hamstr'});
    // Swapping two words breaks the checksum
    const swapped = [...words];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    assert.throws(() => phraseToEntropy(swapped.join(' ')),
        {code: 'BAD_PHRASE', message: /checksum/});
});

test('An identity is derived deterministically from its entropy', () => {
    const identity = new Identity(Buffer.from(kat.entropy), kat.createdAt);
    assert.equal(identity.address, kat.address);
    assert.equal(sha256(identity.public.ikEc), kat.ikEcSha256);
    assert.equal(sha256(identity.public.ikPq), kat.ikPqSha256);
    assert.equal(identity.public.ikEc.length, sizes.ecPublicBytes);
    assert.equal(identity.public.ikPq.length, sizes.pqPublicBytes);
    assert.equal(identity.bundle.length, sizes.bundleBytes);
    assert.match(identity.address,
        /^hh21[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/);
});

test('The derivation matches an independent WebCrypto HKDF', async () => {
    const subtle = crypto.webcrypto.subtle;
    const hkdf = async (ikm, salt, info, bytes) => Buffer.from(
        await subtle.deriveBits({name: 'HKDF', hash: 'SHA-512', salt, info},
            await subtle.importKey('raw', ikm, 'HKDF', false,
                ['deriveBits']), bytes * 8));
    const seed = await hkdf(kat.entropy, Buffer.alloc(64),
        Buffer.from('hexhoot/v2/identity-seed'), 64);
    const d = await hkdf(seed, Buffer.alloc(0), encodeParts(
        'hexhoot/v2/ik-ec', Buffer.from([0, 0, 0, 0])), 66);
    d[0] &= 1;
    const ecdh = crypto.createECDH('secp521r1');
    ecdh.setPrivateKey(d);
    const pqSeed = await hkdf(seed, Buffer.alloc(0),
        Buffer.from('hexhoot/v2/ik-pq'), 32);
    const pq = crypto.createPublicKey(crypto.createPrivateKey({key: pqSeed,
        format: 'raw-seed', asymmetricKeyType: 'ml-dsa-87'}))
        .export({format: 'raw-public'});

    const identity = new Identity(Buffer.from(kat.entropy), kat.createdAt);
    assert.deepEqual(identity.public.ikEc, ecdh.getPublicKey());
    assert.deepEqual(identity.public.ikPq, pq);
});

test('The phrase restores the same keys and address', () => {
    const original = Identity.generate(1000);
    const restored = Identity.fromPhrase(original.phrase(), 2000);
    assert.equal(restored.address, original.address);
    assert.deepEqual(restored.fingerprint, original.fingerprint);
    // The bundle is re-signed with the new time; both are valid
    assert.notDeepEqual(restored.bundle, original.bundle);
    assert.equal(PublicIdentity.fromBundle(restored.bundle).createdAt, 2000);
    assert.equal(Identity.fromSecret(original.secret()).address,
        original.address);
    assert.notEqual(Identity.generate().address, original.address);
});

test('A bundle is checked against its address and signature', () => {
    const alice = Identity.generate();
    const bob = Identity.generate();
    const pub = PublicIdentity.fromBundle(alice.bundle,
        {expected: alice.address});
    assert.equal(pub.address, alice.address);
    assert.deepEqual(pub.topic, address.topic(alice.fingerprint));
    PublicIdentity.fromBundle(alice.bundle, {expected: alice.fingerprint});
    assert.throws(() => PublicIdentity.fromBundle(alice.bundle,
        {expected: bob.address}), {code: 'FINGERPRINT_MISMATCH'});

    // Flip one bit in each part: version, time, both keys, both signatures
    for (const offset of [0, 5, 9 + 40, 142 + 1000, 2734 + 10,
        2734 + 132 + 2000]) {
        const bad = Buffer.from(alice.bundle);
        bad[offset] ^= 1;
        assert.throws(() => PublicIdentity.fromBundle(bad),
            {code: 'BAD_BUNDLE'}, 'offset ' + offset);
    }
    assert.throws(() => PublicIdentity.fromBundle(alice.bundle.subarray(1)),
        {code: 'BAD_BUNDLE'});

    // A point that is not on the curve is rejected before anything else
    const offCurve = Buffer.from(alice.bundle);
    offCurve.fill(5, 10, 142);
    assert.throws(() => PublicIdentity.fromBundle(offCurve),
        {code: 'BAD_BUNDLE', message: /P-521/});
});

test('Hybrid signatures need both halves and the right purpose', () => {
    const alice = Identity.generate();
    const mallory = Identity.generate();
    const pub = alice.public;
    const message = Buffer.from('transcript');
    const signature = alice.sign('handshake', message);
    assert.equal(signature.length, sizes.signatureBytes);
    assert.ok(pub.verify('handshake', message, signature));
    assert.ok(!pub.verify('bundle', message, signature));
    assert.ok(!pub.verify('handshake', Buffer.from('other'), signature));

    // Either half from another key fails, so both must be broken to forge
    const other = mallory.sign('handshake', message);
    assert.ok(!pub.verify('handshake', message,
        Buffer.concat([signature.subarray(0, 132), other.subarray(132)])));
    assert.ok(!pub.verify('handshake', message,
        Buffer.concat([other.subarray(0, 132), signature.subarray(132)])));
    assert.ok(!pub.verify('handshake', message, signature.subarray(1)));
    assert.ok(!pub.verify('handshake', message, Buffer.alloc(4759)));
    assert.throws(() => alice.sign('', message), {code: 'BAD_PARAMS'});
});

test('Addresses round-trip and catch typos', () => {
    const fingerprint = crypto.randomBytes(32);
    const text = address.fingerprintToAddress(fingerprint);
    assert.equal(text.length, 62);
    assert.deepEqual(address.addressToFingerprint(text), fingerprint);
    assert.deepEqual(address.addressToFingerprint(text.toUpperCase()),
        fingerprint);
    assert.deepEqual(address.addressToFingerprint(
        text.replace(/(.{8})/g, '$1 ')), fingerprint);

    // Every single-character typo is detected (Bech32m guarantees up to 4)
    const charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    for (let i = 4; i < text.length; i++) {
        for (const c of charset) {
            if (c !== text[i]) {
                const typo = text.slice(0, i) + c + text.slice(i + 1);
                assert.throws(() => address.addressToFingerprint(typo),
                    {code: 'BAD_ADDRESS'});
            }
        }
    }
    for (const bad of ['', 'hh2', text.slice(0, -1), text + 'q',
        'hh3' + text.slice(3), text.slice(0, 10).toUpperCase() +
        text.slice(10), address.bech32mEncode('hh2', [1, 2, 3])]) {
        assert.throws(() => address.addressToFingerprint(bad),
            {code: 'BAD_ADDRESS'}, bad);
    }
});

test('Bech32m matches the BIP-350 vectors', () => {
    for (const valid of ['A1LQFN3A', 'a1lqfn3a',
        'an83characterlonghumanreadablepartthatcontainsthetheexcludedchar' +
        'actersbioandnumber11sg7hg6',
        'abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx',
        '11llllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllll' +
        'llllllllllllllllllludsr8',
        'split1checkupstagehandshakeupstreamerranterredcaperredlc445v',
        '?1v759aa']) {
        const {hrp, data} = address.bech32mDecode(valid);
        assert.equal(address.bech32mEncode(hrp, data), valid.toLowerCase());
    }
    for (const invalid of [
        'an84characterslonghumanreadablepartthatcontainsthetheexcludedcha' +
        'ractersbioandnumber11d6pts4',
        'qyrz8wqd2c9m', '1qyrz8wqd2c9m', 'y1b0jsk6g', 'lt1igcx5c0',
        'in1muywd', 'mm1crxm3i', 'au1s5cgom', 'M1VUXWEZ', '16plkw9',
        '1p2gdwpf', '\x201xj0phk', '\x7f1g6xzxy', '\x801vctc34']) {
        assert.throws(() => address.bech32mDecode(invalid),
            {code: 'BAD_ADDRESS'}, invalid);
    }
});

test('Both sides compute the same safety number', () => {
    const a = crypto.randomBytes(32);
    const b = crypto.randomBytes(32);
    const number = address.safetyNumber(a, b);
    assert.equal(number, address.safetyNumber(b, a));
    assert.match(number, /^(\d{5} ){15}\d{5}$/);
    assert.notEqual(number, address.safetyNumber(a, crypto.randomBytes(32)));
    const alice = Identity.generate();
    const bob = Identity.generate();
    assert.equal(alice.public.safetyNumber(bob.public),
        bob.public.safetyNumber(alice.public));
});

test('The topic is not the fingerprint (finding T1)', () => {
    const fingerprint = crypto.randomBytes(32);
    const topic = address.topic(fingerprint);
    assert.equal(topic.length, 32);
    assert.notDeepEqual(topic, fingerprint);
});

test('destroy() zeroes the entropy', () => {
    const identity = Identity.generate();
    const entropy = identity.entropy;
    identity.destroy();
    assert.deepEqual(entropy, Buffer.alloc(32));
});
