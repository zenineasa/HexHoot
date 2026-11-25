/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const Core = require('../../modules/Core');
const Storage = require('../../modules/Core/Storage');
const {messageType} = require('../../modules/Core/constants');

/**
 * A random hex string that looks like a v1 public key
 * @return {string} hex key
 */
function randomKey() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a Core with in-memory storage, logged in as 'name'
 * @param {string} name display name; also seeds the password
 * @param {Array} transports transports
 * @param {string} [file] database file; in memory if omitted
 * @return {Core} a started Core
 */
async function createCore(name, transports = [], file = ':memory:') {
    const core = new Core({
        storage: new Storage(file),
        transports: transports,
        log: function() {},
    });
    await core.start();
    if (name) {
        await core.writeLoggedInUserInfo(
            {displayName: name, password: name + '-password-123'});
    }
    return core;
}

/**
 * Collect a Core's events
 * @param {Core} core the core
 * @return {Array} list that receives the events
 */
function collectEvents(core) {
    const events = [];
    core.onEvent((event) => events.push(event));
    return events;
}

/**
 * Wait until a condition holds
 * @param {function} condition async or sync predicate
 * @param {string} what description for the timeout error
 * @param {number} timeout milliseconds
 */
async function waitFor(condition, what, timeout = 20000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        if (await condition()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Timed out waiting for ' + what);
}

/**
 * In-memory transport; every transport created from one hub can reach the
 * others.
 */
class MemoryHub {
    /** constructor */
    constructor() {
        this.listeners = new Map();
    }

    /**
     * @return {Object} a transport connected to this hub
     */
    transport() {
        const hub = this;
        return {
            name: 'memory',
            callback: function() {},
            onMessage(func) {
                this.callback = func;
            },
            async start(publicKey) {
                hub.listeners.set(publicKey, this);
                this.publicKey = publicKey;
            },
            async stop() {
                hub.listeners.delete(this.publicKey);
            },
            async send(recipient, envelope) {
                const target = hub.listeners.get(recipient);
                if (target) {
                    setImmediate(() => target.callback(envelope));
                }
            },
        };
    }
}

/**
 * The friend request and chat flow between two started Cores
 * @param {Core} alice the requester
 * @param {Core} bob the recipient
 */
async function befriendAndChat(alice, bob) {
    const aliceKey = await alice.getPublicKeyOfLoggedInUser();
    const bobKey = await bob.getPublicKeyOfLoggedInUser();
    const bobEvents = collectEvents(bob);
    const aliceEvents = collectEvents(alice);

    // alice adds bob, as AddFriend does
    await alice.updateFriendInformation({key: bobKey});
    await alice.sendRequestOrResponse({key: bobKey},
        messageType.friendRequest);
    await waitFor(async () =>
        (await bob.getPendingFriendRequests())[aliceKey],
    'bob to receive the friend request');
    assert.equal((await bob.getPendingFriendRequests())[aliceKey]
        .displayName, 'alice');

    // bob accepts; alice receives bob's profile
    await bob.acceptFriendRequest(aliceKey);
    await waitFor(async () =>
        (await alice.getUserInfo(bobKey)).displayName === 'bob',
    'alice to receive bob\'s profile');

    // Chat both ways
    await alice.sendChatMessage(bobKey, {timestamp: 1, message: 'hi bob'});
    await bob.sendChatMessage(aliceKey, {timestamp: 2, message: 'hi alice'});
    await waitFor(async () =>
        (await bob.getAllMessages(aliceKey)).length === 2 &&
        (await alice.getAllMessages(bobKey)).length === 2,
    'both chats to arrive');
    assert.deepEqual(
        (await bob.getAllMessages(aliceKey)).map((m) => m.message),
        [{timestamp: 1, message: 'hi bob', type: 'received'},
            {timestamp: 2, message: 'hi alice', type: 'sent'}]);
    assert.ok(bobEvents.some((e) => e.message.type === messageType.chat &&
        e.isFromFriend));
    assert.ok(aliceEvents.some((e) =>
        e.message.type === messageType.userInfoResponse));
}

module.exports = {
    randomKey, createCore, collectEvents, waitFor, MemoryHub, befriendAndChat,
};
