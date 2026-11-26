/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L1 tests of identities, name-and-password derivation and addresses
// (docs/design/identity-and-addresses.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {Identity, PublicIdentity, sizes} =
    require('../../modules/Crypto/Identity');
const credentials = require('../../modules/Crypto/credentials');
const {randomIdentity} = require('./helpers');
const address = require('../../modules/Crypto/address');
const {encodeParts} = require('../../modules/Crypto/primitives');

// Cheap scrypt for most tests; the real cost runs in the slow test below
const fast = {scryptParams: {N: 2 ** 14, r: 8, p: 1}};
const password = 'correct horse battery staple';

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

test('The name is normalized, and weak credentials are refused', () => {
    assert.equal(credentials.normalizeName('  Alice \t Liddell '),
        'alice liddell');
    assert.equal(credentials.normalizeName('ＡＬＩＣＥ'), 'alice'); // NFKC
    const problems = (name, pass) => credentials.checkCredentials(name, pass);
    assert.deepEqual(problems('Alice Liddell', password), []);
    assert.deepEqual(problems('Al', password), ['nameTooShort']);
    assert.deepEqual(problems('Alice Liddell', 'fifteen chars!!'),
        ['passwordTooShort']);
    assert.deepEqual(problems('Alice Liddell', 'my name is alice liddell'),
        ['passwordContainsName']);
    assert.deepEqual(problems('Alice Liddell', 'aaaabbbbaaaabbbbaaaa'),
        ['passwordRepetitive']);
    // 16 characters, counted as characters rather than bytes
    assert.deepEqual(problems('Alice Liddell', 'ಉಪ್ಪಿನಕಾಯಿ ಮತ್ತು ಅನ್ನ'), []);
});

test('The same name and password give the same identity', async () => {
    const original = await Identity.fromCredentials('Alice Liddell',
        password, {...fast, createdAt: 1000});
    const again = await Identity.fromCredentials(' alice   LIDDELL', password,
        {...fast, createdAt: 2000});
    assert.equal(again.address, original.address);
    assert.equal(again.name, 'alice liddell');
    // The bundle is re-signed with the new time; both are valid
    assert.notDeepEqual(again.bundle, original.bundle);
    assert.equal(PublicIdentity.fromBundle(again.bundle).createdAt, 2000);
    assert.equal(Identity.fromSecret(original.secret()).address,
        original.address);

    const otherPassword = await Identity.fromCredentials('Alice Liddell',
        password + '!', fast);
    const otherName = await Identity.fromCredentials('Bobby Tables',
        password, fast);
    assert.notEqual(otherPassword.address, original.address);
    assert.notEqual(otherName.address, original.address);
    await assert.rejects(Identity.fromCredentials('Alice Liddell', 'short',
        fast), (err) => err.code === 'WEAK_CREDENTIALS' &&
        err.problems.includes('passwordTooShort'));
});

test('The derivation matches scrypt computed directly', async () => {
    const entropy = await credentials.deriveEntropy('Alice Liddell',
        password, fast);
    const salt = crypto.createHash('sha512').update(encodeParts(
        'hexhoot/v2/identity-salt', 'alice liddell')).digest();
    assert.deepEqual(entropy, crypto.scryptSync(password, salt, 32,
        {N: 2 ** 14, r: 8, p: 1}));
});

test('checkPassword tells whether the password is remembered', async () => {
    const identity = await Identity.fromCredentials('Alice Liddell',
        password, fast);
    const restored = Identity.fromSecret(identity.secret());
    assert.equal(await restored.checkPassword(password, fast), true);
    assert.equal(await restored.checkPassword(password + ' ', fast), false);
    assert.equal(await restored.checkPassword('Correct horse battery staple',
        fast), false);
    assert.equal(await restored.checkPassword('short', fast), false);
    await assert.rejects(restored.checkPassword(password,
        {totalMemory: () => 2 ** 30}), {code: 'LOW_MEMORY'});
});

test('Password checks come sooner after a miss, later after a hit', () => {
    const day = 24 * 3600 * 1000;
    let state = credentials.nextPasswordCheck({},
        {now: 0, result: 'created'});
    assert.deepEqual(state, {streak: 0, nextAt: 3 * day});
    const gaps = [];
    for (let i = 0; i < 7; i++) {
        const next = credentials.nextPasswordCheck(state,
            {now: state.nextAt, result: 'right'});
        gaps.push((next.nextAt - state.nextAt) / day);
        state = next;
    }
    assert.deepEqual(gaps, [7, 14, 30, 60, 90, 90, 90]);
    const missed = credentials.nextPasswordCheck(state,
        {now: 0, result: 'wrong'});
    assert.deepEqual(missed, {streak: 0, nextAt: day});
    const skipped = credentials.nextPasswordCheck(state,
        {now: 0, result: 'skipped'});
    assert.deepEqual(skipped, {streak: state.streak, nextAt: 2 * day});
    assert.throws(() => credentials.nextPasswordCheck(state,
        {now: 0, result: 'maybe'}), {code: 'BAD_PARAMS'});
});

test('A bundle is checked against its address and signature', () => {
    const alice = randomIdentity();
    const bob = randomIdentity();
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
    const alice = randomIdentity();
    const mallory = randomIdentity();
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
    const alice = randomIdentity();
    const bob = randomIdentity();
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
    const identity = randomIdentity();
    const entropy = identity.entropy;
    identity.destroy();
    assert.deepEqual(entropy, Buffer.alloc(32));
});

// The real cost: scrypt N=2^20, about 5-8 s and 1 GiB
const runSlow = Boolean(process.env.CI || process.env.HEXHOOT_SLOW_TESTS);
test('Name and password at the real cost give the known identity',
    {skip: runSlow ? false : 'set HEXHOOT_SLOW_TESTS=1 to run'},
    async () => {
        const identity = await Identity.fromCredentials('Alice Liddell',
            password, {createdAt: 1e12});
        assert.equal(identity.entropy.toString('hex'),
            '6b648e70478402aff342374f1ea02b951c4d4b397013c71f1694d92d364318af');
        assert.equal(identity.address,
            'hh21plj59s5zh6nwax5gvxmt3wv90ft2hq6k2g65whjef9xmw5m45vkqyrc0n9');
    });
