/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L1 tests of the encrypted .hexhoot2 backup (docs/design/keyring.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const {exportBackup, importBackup} = require('../../modules/Crypto/backup');
const {Initiator, Responder} = require('../../modules/Crypto/handshake');
const {Ratchet} = require('../../modules/Crypto/Ratchet');
const {randomIdentity} = require('./helpers');

const fast = {scryptParams: {N: 2 ** 14, r: 8, p: 1}};
const passphrase = 'a long backup passphrase';
const tables = {
    Friends: [{key: 'hh21abc', displayName: 'Bobby Tables'}],
    Chat: [{timestamp: 1, message: 'hello ✓', type: 'sent'}],
    Preferences: [{key: 'language', value: 'de'}],
};

/**
 * Change one byte
 * @param {Buffer} file a file
 * @param {number} offset the byte
 * @return {Buffer} a changed copy
 */
function flip(file, offset) {
    const copy = Buffer.from(file);
    copy[offset] ^= 1;
    return copy;
}

test('A backup restores the identity and the data', async () => {
    const identity = randomIdentity('alice liddell');
    const file = await exportBackup({identity, tables}, passphrase,
        {...fast, now: () => 42});
    assert.equal(file.subarray(0, 8).toString(), 'HEXHOOT2');
    const restored = await importBackup(file, passphrase);
    assert.equal(restored.identity.address, identity.address);
    assert.equal(restored.identity.name, 'alice liddell');
    assert.deepEqual(restored.tables, tables);
    assert.equal(restored.createdAt, 42);
});

test('Nothing readable is in the file', async () => {
    const identity = randomIdentity('alice liddell');
    const file = await exportBackup({identity, tables}, passphrase, fast);
    for (const secret of ['Bobby Tables', 'hello', 'alice liddell',
        'language', identity.entropy.toString('base64')]) {
        assert.ok(!file.includes(Buffer.from(secret)), secret);
    }
    assert.ok(!file.includes(identity.entropy));
    // Two backups of the same data differ (fresh salt and nonce)
    const again = await exportBackup({identity, tables}, passphrase, fast);
    assert.notDeepEqual(again, file);
});

test('A wrong passphrase or any change is refused', async () => {
    const identity = randomIdentity();
    const file = await exportBackup({identity, tables}, passphrase, fast);
    await assert.rejects(importBackup(file, passphrase + '!'),
        {code: 'BAD_PASSPHRASE'});
    await assert.rejects(importBackup(flip(file, file.length - 1),
        passphrase), {code: 'BAD_PASSPHRASE'});
    await assert.rejects(importBackup(flip(file, file.length - 40),
        passphrase), {code: 'BAD_PASSPHRASE'});
    await assert.rejects(importBackup(flip(file, 0), passphrase),
        {code: 'NOT_A_BACKUP'});
    await assert.rejects(importBackup(flip(file, 8), passphrase),
        {code: 'UNSUPPORTED_VERSION'});
    await assert.rejects(importBackup(file.subarray(0, 20), passphrase),
        {code: 'CORRUPT'});
    await assert.rejects(importBackup(Buffer.from('{"json": true}'),
        passphrase), {code: 'NOT_A_BACKUP'});

    // The KDF parameters are bound to the ciphertext, so editing them to
    // something weaker only makes the file unreadable
    const text = file.toString('latin1');
    const weaker = Buffer.from(text.replace('"r":8', '"r":4'), 'latin1');
    await assert.rejects(importBackup(weaker, passphrase),
        {code: 'BAD_PASSPHRASE'});
    // and a value that would crash Electron never reaches scrypt
    const length = file.readUInt32BE(9);
    const header = JSON.parse(file.subarray(13, 13 + length));
    const crashHeader = Buffer.from(JSON.stringify({...header, N: 2 ** 21}));
    const crashLength = Buffer.alloc(4);
    crashLength.writeUInt32BE(crashHeader.length);
    const crash = Buffer.concat([file.subarray(0, 9), crashLength,
        crashHeader, file.subarray(13 + length)]);
    await assert.rejects(importBackup(crash, passphrase),
        {code: 'BAD_PARAMS'});
});

test('Short passphrases and session state are refused', async () => {
    const identity = randomIdentity();
    await assert.rejects(exportBackup({identity, tables}, 'too short',
        fast), {code: 'WEAK_CREDENTIALS'});
    await assert.rejects(exportBackup({identity, tables: {...tables,
        Sessions: [{}]}}, passphrase, fast), {code: 'BAD_PARAMS'});
    await assert.rejects(exportBackup({identity, tables: {sessions: []}},
        passphrase, fast), {code: 'BAD_PARAMS'});
});

test('After a restore, contacts start a fresh session', async () => {
    const alice = randomIdentity('alice liddell');
    const bob = randomIdentity('bobby tables');

    // alice and bob talk; then alice's computer is lost
    const handshake = async (initiator, responder) => {
        const i = new Initiator({identity: initiator,
            expected: responder.address});
        const r = new Responder({identity: responder});
        const {message, session} = i.handleM2(r.handleM1(i.start()));
        return [Ratchet.fromHandshake(session),
            Ratchet.fromHandshake(await r.handleM3(message))];
    };
    const [aliceOld, bobOld] = await handshake(alice, bob);
    bobOld.decrypt(aliceOld.encrypt('before'));
    const file = await exportBackup({identity: alice, tables}, passphrase,
        fast);

    // On the new computer: same identity, no session; a new handshake
    const {identity} = await importBackup(file, passphrase);
    const [aliceNew, bobNew] = await handshake(identity, bob);
    assert.equal(bobNew.peer.address, alice.address);
    assert.equal(bobNew.decrypt(aliceNew.encrypt('after')).toString(),
        'after');
    // The old session cannot read the new one
    assert.throws(() => bobOld.decrypt(aliceNew.encrypt('x')));
});

// The real cost, as users get it: about 5-8 s and 1 GiB for each of export
// and import
const runSlow = Boolean(process.env.CI || process.env.HEXHOOT_SLOW_TESTS);
test('A backup at the default cost (N=2^20)',
    {skip: runSlow ? false : 'set HEXHOOT_SLOW_TESTS=1 to run'},
    async () => {
        const identity = randomIdentity();
        const file = await exportBackup({identity, tables}, passphrase);
        assert.match(file.toString('latin1'), /"N":1048576/);
        const restored = await importBackup(file, passphrase);
        assert.equal(restored.identity.address, identity.address);
    });
