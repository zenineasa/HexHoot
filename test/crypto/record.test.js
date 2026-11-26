/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L1 tests of the record cipher and the primitives it is built on. Runs in
// Electron's Node (npm run test:crypto), so only BoringSSL is used.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const RecordCipher = require('../../modules/Crypto/RecordCipher');
const {
    encodeParts, scrypt, checkScryptParams, scryptOutlook,
} = require('../../modules/Crypto/primitives');

const key = Buffer.alloc(32, 7);
// Ciphertext ‖ tag of the record vector below
const RECORD_VECTOR_TAIL = 'df9b4e9d38b979d0bae103d826754f7b42d457e51dd028';

/**
 * A randomBytes replacement that counts up from 'start', for vectors
 * @param {number} start first byte value
 * @return {function} (n) => Buffer
 */
function counter(start) {
    let next = start;
    return (n) => Buffer.from(Array.from({length: n}, () => next++ & 0xff));
}

test('encodeParts is unambiguous', () => {
    assert.notDeepEqual(encodeParts('ab', 'c'), encodeParts('a', 'bc'));
    assert.notDeepEqual(encodeParts('a', ''), encodeParts('a'));
    assert.equal(encodeParts('ab', Buffer.from([1])).toString('hex'),
        '000000026162' + '0000000101');
});

test('Records round-trip and every blob is different', () => {
    const cipher = new RecordCipher(Buffer.from(key));
    const a = cipher.encrypt('Chat', 'k1', 'hello ✓');
    const b = cipher.encrypt('Chat', 'k1', 'hello ✓');
    assert.notDeepEqual(a, b);
    assert.equal(cipher.decrypt('Chat', 'k1', a).toString(), 'hello ✓');
    assert.equal(cipher.decrypt('Chat', 'k1', b).toString(), 'hello ✓');
    assert.equal(a.length, 1 + 32 + 12 + Buffer.byteLength('hello ✓') + 16);
});

test('A record cannot be altered or moved to another slot', () => {
    const cipher = new RecordCipher(Buffer.from(key));
    const blob = cipher.encrypt('Friends', 'alice', '{"name":"Alice"}');
    for (let i = 0; i < blob.length; i++) {
        const bad = Buffer.from(blob);
        bad[i] ^= 1;
        assert.throws(() => cipher.decrypt('Friends', 'alice', bad),
            {code: 'DECRYPT_FAILED'}, 'byte ' + i);
    }
    assert.throws(() => cipher.decrypt('Friends', 'bob', blob),
        {code: 'DECRYPT_FAILED'});
    assert.throws(() => cipher.decrypt('Chat', 'alice', blob),
        {code: 'DECRYPT_FAILED'});
    assert.throws(() => cipher.decrypt('Friend', 'salice', blob),
        {code: 'DECRYPT_FAILED'});
    assert.throws(() => cipher.decrypt('Friends', 'alice',
        blob.subarray(0, 40)), {code: 'DECRYPT_FAILED'});
    const other = new RecordCipher(Buffer.alloc(32, 8));
    assert.throws(() => other.decrypt('Friends', 'alice', blob),
        {code: 'DECRYPT_FAILED'});
});

test('Record format vector, checked with WebCrypto', async () => {
    // A fixed vector guards the format; WebCrypto's independent HKDF and
    // AES-GCM code path confirms the spec in docs/design/keyring.md.
    const cipher = new RecordCipher(Buffer.from(key), {random: counter(0)});
    const blob = cipher.encrypt('Chat', 42, 'hexhoot');
    assert.equal(blob.toString('hex'),
        '01' +
        '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f' +
        '202122232425262728292a2b' +
        RECORD_VECTOR_TAIL);

    const subtle = crypto.webcrypto.subtle;
    const base = await subtle.importKey('raw', key, 'HKDF', false,
        ['deriveKey']);
    const recordKey = await subtle.deriveKey({name: 'HKDF', hash: 'SHA-512',
        salt: blob.subarray(1, 33),
        info: encodeParts('hexhoot/v2/rec', 'Chat', '42')},
    base, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
    const plain = await subtle.decrypt({name: 'AES-GCM',
        iv: blob.subarray(33, 45),
        additionalData: encodeParts('hexhoot/v2/rec', Buffer.from([1]),
            'Chat', '42')}, recordKey, blob.subarray(45));
    assert.equal(Buffer.from(plain).toString(), 'hexhoot');
});

test('A destroyed cipher zeroes its key and refuses to work', () => {
    const own = Buffer.from(key);
    const cipher = new RecordCipher(own);
    cipher.destroy();
    assert.deepEqual(own, Buffer.alloc(32));
    assert.throws(() => cipher.encrypt('Chat', 1, 'x'), {code: 'LOCKED'});
});

test('scrypt parameters are capped before scrypt runs', async () => {
    // N=2^21 crashes Electron with SIGTRAP, so it must never reach scrypt
    for (const N of [2 ** 21, 2 ** 13, 3 * 2 ** 14, 1.5]) {
        assert.throws(() => checkScryptParams({N, r: 8, p: 1}),
            {code: 'BAD_PARAMS'});
        await assert.rejects(scrypt('pw', Buffer.alloc(32), {N, r: 8, p: 1}),
            {code: 'BAD_PARAMS'});
    }
    assert.throws(() => checkScryptParams({N: 2 ** 14, r: 16, p: 1}),
        {code: 'BAD_PARAMS'});
});

test('scrypt refuses only machines with too little memory', async () => {
    const params = {N: 2 ** 20, r: 8, p: 1};
    await assert.rejects(scrypt('pw', Buffer.alloc(32), params,
        {totalMemory: () => 1.5 * 2 ** 30}), {code: 'LOW_MEMORY'});
    const outlook = scryptOutlook(params);
    assert.equal(outlook.needBytes, 2 ** 30);
    assert.equal(typeof outlook.likelySlow, 'boolean');
});

test('scrypt normalizes the passphrase (NFKC)', async () => {
    const params = {N: 2 ** 14, r: 8, p: 1};
    const salt = Buffer.alloc(32, 1);
    const composed = await scrypt('café', salt, params);
    const decomposed = await scrypt('café', salt, params);
    assert.deepEqual(composed, decomposed);
    assert.notDeepEqual(composed, await scrypt('cafe', salt, params));
});
