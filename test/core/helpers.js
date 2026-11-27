/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Core = require('../../modules/Core');
const EncryptedStore = require('../../modules/Core/EncryptedStore');

// The Cores using each test folder, so cleanup can stop them all first
const coresIn = new Map();

// Logging in derives keys with scrypt; tests use a cheap setting
const fastScrypt = {N: 2 ** 14, r: 8, p: 1};
const password = 'correct horse battery staple';

/**
 * A fake OS keyring
 * @param {boolean} [strong] false acts like Linux basic_text
 * @return {Object} a Sealer
 */
function fakeSealer(strong = true) {
    const key = crypto.randomBytes(32);
    return {
        status: async () => ({available: true, backend: 'test', strong}),
        async seal(text) {
            const iv = crypto.randomBytes(16);
            const c = crypto.createCipheriv('aes-256-ctr', key, iv);
            return Buffer.concat([iv, c.update(text), c.final()]);
        },
        async unseal(sealed) {
            const d = crypto.createDecipheriv('aes-256-ctr', key,
                sealed.subarray(0, 16));
            return Buffer.concat([d.update(sealed.subarray(16)), d.final()])
                .toString();
        },
    };
}

/**
 * A Core with its own folder ("computer")
 * @param {Object} [options]
 * @param {MemoryNetwork} [options.network] carriers come from here
 * @param {string} [options.dir] reuse a folder (a restart)
 * @param {Object} [options.sealer] the OS keyring; strong by default
 * @param {function} [options.now] clock
 * @param {number} [options.retryMs] Messenger resend interval
 * @param {Object} [options.t] test context; the folder is removed after it
 * @return {Promise<Core>} a started Core, with .dir and .sealer
 */
async function makeCore(options = {}) {
    const dir = options.dir ||
        fs.mkdtempSync(path.join(os.tmpdir(), 'hexhoot-core-'));
    if (!coresIn.has(dir)) {
        coresIn.set(dir, []);
    }
    if (!options.dir && options.t) {
        // after() hooks run in the order they were added, so this one runs
        // before any core.stop() a test adds later. Windows cannot delete a
        // database that is still open: stop every Core in the folder first.
        options.t.after(async () => {
            for (const core of coresIn.get(dir)) {
                await core.stop().catch(() => {});
            }
            coresIn.delete(dir);
            fs.rmSync(dir, {recursive: true, force: true, maxRetries: 10});
        });
    }
    const sealer = options.sealer || fakeSealer();
    const core = new Core({
        store: new EncryptedStore(path.join(dir, 'HexHoot2.sqlite')),
        keyringFile: path.join(dir, 'keyring.json'),
        sealer,
        scryptParams: fastScrypt,
        retryMs: options.retryMs,
        now: options.now,
        log: function() {},
        carriers: () => options.network ? [options.network.carrier()] : [],
    });
    coresIn.get(dir).push(core);
    await core.start();
    core.dir = dir;
    core.sealer = sealer;
    return core;
}

/**
 * A signed-in Core
 * @param {string} name account name
 * @param {Object} [options] see makeCore
 * @return {Promise<Core>} the Core
 */
async function signedIn(name, options = {}) {
    const core = await makeCore(options);
    await core.writeLoggedInUserInfo({displayName: name, password});
    options.t?.after(() => core.stop().catch(() => {}));
    return core;
}

/**
 * @param {function} check returns truthy when done
 * @param {string} what for the error
 * @param {number} [timeout] ms
 */
async function waitFor(check, what, timeout = 10000) {
    const end = Date.now() + timeout;
    while (!await check()) {
        if (Date.now() > end) {
            throw new Error('Timed out waiting for ' + what);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

/**
 * @param {Core} core a Core
 * @return {Array} its events, as they come
 */
function collectEvents(core) {
    const events = [];
    core.onEvent((event) => events.push(event));
    return events;
}

/**
 * alice adds bob, bob accepts, and they chat both ways
 * @param {Core} alice a signed-in Core
 * @param {Core} bob another
 */
async function befriendAndChat(alice, bob) {
    const assert = require('node:assert/strict');
    const aliceAddress = await alice.getMyAddress();
    const bobAddress = await bob.getMyAddress();
    await alice.addFriend(bobAddress);
    await waitFor(async () => (await bob.getPendingFriendRequests())[
        aliceAddress], 'the friend request');
    await bob.acceptFriendRequest(aliceAddress);
    await waitFor(async () => (await alice.getUserInfo(bobAddress))
        ?.status === 'friend', 'the acceptance');
    await alice.sendChatMessage(bobAddress, {message: 'hi bob'});
    await waitFor(async () => (await bob.getAllMessages(aliceAddress))
        .length === 1, 'alice\'s message');
    await bob.sendChatMessage(aliceAddress, {message: 'hi alice'});
    await waitFor(async () => (await alice.getAllMessages(bobAddress))
        .length === 2, 'bob\'s answer');
    assert.deepEqual((await alice.getAllMessages(bobAddress))
        .map((m) => [m.message.type, m.message.message]),
    [['sent', 'hi bob'], ['received', 'hi alice']]);
}

module.exports = {
    fakeSealer, makeCore, signedIn, waitFor, collectEvents, befriendAndChat,
    fastScrypt, password,
};
