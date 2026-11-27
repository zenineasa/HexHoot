/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L1 tests of the keyring (docs/design/keyring.md) with a fake OS keyring.
// scrypt runs at N=2^14 here; the real cost (2^20) runs once, in CI or with
// HEXHOOT_SLOW_TESTS=1. test/e2e/keyring.e2e.mjs uses the real safeStorage.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Keyring = require('../../modules/Crypto/Keyring');
const createSealer = require('../../modules/Main/sealer');

const fast = {N: 2 ** 14, r: 8, p: 1};
const passphrase = 'correct horse battery staple';

/**
 * A fake OS keyring
 * @param {Object} [status] what status() reports
 * @return {Object} a Sealer, with 'calls' and a 'tamper' switch
 */
function fakeSealer(status = {available: true, backend: 'test',
    strong: true}) {
    const key = crypto.randomBytes(32);
    const sealer = {
        status: async () => status,
        calls: 0,
        tamper: false,
        async seal(text) {
            const iv = crypto.randomBytes(16);
            const c = crypto.createCipheriv('aes-256-ctr', key, iv);
            return Buffer.concat([iv, c.update(text), c.final()]);
        },
        async unseal(sealed) {
            sealer.calls++;
            const d = crypto.createDecipheriv('aes-256-ctr', key,
                sealed.subarray(0, 16));
            const text = Buffer.concat([d.update(sealed.subarray(16)),
                d.final()]).toString();
            return sealer.tamper ? text.replace(/^./, (c) =>
                c === 'A' ? 'B' : 'A') : text;
        },
    };
    return sealer;
}

/**
 * A fresh keyring path
 * @param {Object} t test context, for cleanup
 * @return {string} the path; the directory is removed after the test
 */
function tempFile(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexhoot-keyring-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    return path.join(dir, 'keyring.json');
}

/**
 * Encrypt a record, lock, reopen, unlock and decrypt it
 * @param {Keyring} keyring an unlocked keyring
 * @param {Object} options for Keyring.open
 * @param {Object} unlock for unlock()
 * @return {string} the decrypted record
 */
async function roundTrip(keyring, options, unlock) {
    const blob = keyring.cipher('db').encrypt('Friends', 'a', 'secret');
    keyring.lock();
    const reopened = Keyring.open(options);
    assert.equal(reopened.unlocked, false);
    await reopened.unlock(unlock);
    return reopened.cipher('db').decrypt('Friends', 'a', blob).toString();
}

test('With a strong OS keyring, no passphrase is needed', async (t) => {
    const options = {file: tempFile(t), sealer: fakeSealer(),
        scryptParams: fast};
    const keyring = await Keyring.create(options);
    assert.deepEqual(keyring.info(), {unlocked: true,
        unlockers: ['os-keyring'], passphraseRequired: false});
    assert.equal(await roundTrip(keyring, options, {}), 'secret');
    // Only the owner may read it. Windows has no such mode bits (files in
    // the user's profile are protected by its ACL instead).
    if (process.platform !== 'win32') {
        assert.equal((fs.statSync(options.file).mode & 0o777), 0o600);
    }
    await assert.rejects(Keyring.create(options), {code: 'EXISTS'});
});

test('The vault key is never stored in plaintext', async (t) => {
    const options = {file: tempFile(t), sealer: fakeSealer(),
        passphrase, scryptParams: fast};
    const keyring = await Keyring.create(options);
    const file = fs.readFileSync(options.file);
    for (const encoding of ['hex', 'base64', 'base64url']) {
        assert.ok(!file.includes(keyring.vk.toString(encoding)), encoding);
    }
    assert.ok(!file.includes(keyring.vk));
});

test('A weak OS keyring (Linux basic_text) requires a passphrase',
    async (t) => {
        const sealer = fakeSealer({available: true, backend: 'basic_text',
            strong: false});
        const options = {file: tempFile(t), sealer, scryptParams: fast};
        await assert.rejects(Keyring.create(options),
            {code: 'PASSPHRASE_REQUIRED'});
        assert.equal(Keyring.exists(options.file), false);

        const keyring = await Keyring.create({...options, passphrase});
        assert.deepEqual(keyring.info().unlockers, ['passphrase']);
        keyring.lock();
        const reopened = Keyring.open(options);
        await assert.rejects(reopened.unlock(),
            {code: 'PASSPHRASE_REQUIRED'});
        await assert.rejects(reopened.unlock({passphrase: 'wrong'}),
            {code: 'BAD_PASSPHRASE'});
        assert.equal(reopened.unlocked, false);
        await reopened.unlock({passphrase});
        assert.equal(await roundTrip(reopened, options, {passphrase}),
            'secret');
        assert.equal(sealer.calls, 0, 'basic_text is never used');
    });

test('Without any OS keyring a passphrase is required', async (t) => {
    await assert.rejects(Keyring.create({file: tempFile(t),
        scryptParams: fast}), {code: 'PASSPHRASE_REQUIRED'});
});

test('Either unlocker opens the same vault', async (t) => {
    const options = {file: tempFile(t), sealer: fakeSealer(), passphrase,
        scryptParams: fast};
    const keyring = await Keyring.create(options);
    assert.deepEqual(keyring.info().unlockers, ['os-keyring', 'passphrase']);
    const blob = keyring.cipher('secrets').encrypt('Identity', 0, 'seed');
    for (const unlock of [{}, {passphrase}]) {
        const reopened = Keyring.open(options);
        await reopened.unlock(unlock);
        assert.equal(reopened.cipher('secrets')
            .decrypt('Identity', 0, blob).toString(), 'seed');
    }
    // The purposes have separate keys
    assert.throws(() => keyring.cipher('db').decrypt('Identity', 0, blob),
        {code: 'DECRYPT_FAILED'});
    assert.throws(() => keyring.cipher('other'), {code: 'BAD_PARAMS'});
});

test('A wrong key from the OS keyring is detected', async (t) => {
    const sealer = fakeSealer();
    const options = {file: tempFile(t), sealer, scryptParams: fast};
    (await Keyring.create(options)).lock();
    sealer.tamper = true;
    await assert.rejects(Keyring.open(options).unlock(),
        {code: 'OS_KEYRING_FAILED'});
    sealer.tamper = false;
    const unavailable = {...options, sealer: {...sealer,
        status: async () => ({available: false, strong: false})}};
    await assert.rejects(Keyring.open(unavailable).unlock(),
        {code: 'OS_KEYRING_FAILED'});
});

test('Tampered KDF parameters or wrapped key are rejected', async (t) => {
    const options = {file: tempFile(t), passphrase, scryptParams: fast};
    (await Keyring.create(options)).lock();
    const original = fs.readFileSync(options.file, 'utf8');
    const edit = (change) => {
        const data = JSON.parse(original);
        change(data.unlockers[0]);
        fs.writeFileSync(options.file, JSON.stringify(data));
    };

    // The parameters are bound to the wrapped key as associated data
    edit((u) => u.r = 4);
    await assert.rejects(Keyring.open(options).unlock({passphrase}),
        {code: 'BAD_PASSPHRASE'});
    // A parameter that would crash Electron never reaches scrypt
    edit((u) => u.N = 2 ** 21);
    await assert.rejects(Keyring.open(options).unlock({passphrase}),
        {code: 'BAD_PARAMS'});
    edit((u) => u.wrapped = Buffer.from(u.wrapped, 'base64')
        .map((b, i) => i === 20 ? b ^ 1 : b).toString('base64'));
    await assert.rejects(Keyring.open(options).unlock({passphrase}),
        {code: 'BAD_PASSPHRASE'});

    fs.writeFileSync(options.file, '{"format":"other"}');
    assert.throws(() => Keyring.open(options), {code: 'CORRUPT'});
    fs.writeFileSync(options.file, 'not json');
    assert.throws(() => Keyring.open(options), {code: 'CORRUPT'});
    Keyring.reset(options.file);
    assert.throws(() => Keyring.open(options), {code: 'NOT_FOUND'});
});

test('Locking zeroes the vault key and derived keys', async (t) => {
    const keyring = await Keyring.create({file: tempFile(t),
        sealer: fakeSealer(), scryptParams: fast});
    const vk = keyring.vk;
    const cipher = keyring.cipher('db');
    const derived = cipher.key;
    keyring.lock();
    assert.deepEqual(vk, Buffer.alloc(32));
    assert.deepEqual(derived, Buffer.alloc(32));
    assert.throws(() => cipher.encrypt('Chat', 1, 'x'), {code: 'LOCKED'});
    assert.throws(() => keyring.cipher('db'), {code: 'LOCKED'});
    await assert.rejects(keyring.setPassphrase('x'), {code: 'LOCKED'});
});

test('The passphrase can be changed, and removed only with a strong OS ' +
    'keyring', async (t) => {
    const status = {available: true, backend: 'test', strong: true};
    const options = {file: tempFile(t), sealer: fakeSealer(status),
        passphrase, scryptParams: fast};
    const keyring = await Keyring.create(options);
    await keyring.setPassphrase('a new passphrase');
    await assert.rejects(Keyring.open(options).unlock({passphrase}),
        {code: 'BAD_PASSPHRASE'});
    await Keyring.open(options).unlock({passphrase: 'a new passphrase'});

    status.strong = false;
    await assert.rejects(keyring.removePassphrase(),
        {code: 'PASSPHRASE_REQUIRED'});
    status.strong = true;
    await keyring.removePassphrase();
    assert.deepEqual(keyring.info().unlockers, ['os-keyring']);

    const passphraseOnly = await Keyring.create({file: tempFile(t),
        passphrase, scryptParams: fast});
    await assert.rejects(passphraseOnly.removePassphrase(),
        {code: 'PASSPHRASE_REQUIRED'});
});

test('Weaker scrypt parameters are upgraded on unlock', async (t) => {
    const options = {file: tempFile(t), passphrase, scryptParams: fast};
    (await Keyring.create(options)).lock();
    const stronger = {...options, scryptParams: {...fast, N: 2 ** 15}};
    await Keyring.open(stronger).unlock({passphrase});
    const unlocker = JSON.parse(fs.readFileSync(options.file, 'utf8'))
        .unlockers[0];
    assert.equal(unlocker.N, 2 ** 15);
    await Keyring.open(stronger).unlock({passphrase});
});

test('The safeStorage sealer reports weak backends', async () => {
    const fake = (available, backend) => ({
        isEncryptionAvailable: () => available,
        getSelectedStorageBackend: () => backend,
    });
    const status = async (...args) => (await createSealer(...args).status());
    assert.equal((await status(fake(true), 'darwin')).strong, true);
    assert.equal((await status(fake(true), 'win32')).strong, true);
    assert.equal((await status(fake(false), 'darwin')).strong, false);
    assert.equal((await status(fake(true, 'gnome_libsecret'), 'linux'))
        .strong, true);
    assert.equal((await status(fake(true, 'basic_text'), 'linux')).strong,
        false);
    assert.equal((await status(fake(true, 'unknown'), 'linux')).strong,
        false);
});

// The real cost: about 8 s and 1 GiB on Apple Silicon, minutes under memory
// pressure (Q14)
const runSlow = Boolean(process.env.CI || process.env.HEXHOOT_SLOW_TESTS);
test('A passphrase keyring at the default cost (N=2^20)',
    {skip: runSlow ? false : 'set HEXHOOT_SLOW_TESTS=1 to run'},
    async (t) => {
        const options = {file: tempFile(t), passphrase};
        const keyring = await Keyring.create(options);
        assert.equal(keyring.data.unlockers[0].N, 2 ** 20);
        assert.equal(await roundTrip(keyring, options, {passphrase}),
            'secret');
    });
