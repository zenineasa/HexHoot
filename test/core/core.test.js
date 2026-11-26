/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L2 tests of Core without Electron or a network. The receive-path tests are
// regression tests for findings S1-S3 (docs/assessment/crypto-findings.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {messageType, tableNames} = require('../../modules/Core/constants.mjs');
const v1Crypto = require('../../modules/Core/v1Crypto');
const {
    randomKey, createCore, collectEvents, MemoryHub, befriendAndChat,
} = require('./helpers');

/**
 * Replace a Core's network send with a recorder
 * @param {Core} core the core
 * @return {Array} list that receives [otherUserInfo, requestType] entries
 */
function recordSends(core) {
    const sent = [];
    core.sendRequestOrResponse = async function(info, type) {
        sent.push([info, type]);
    };
    return sent;
}

test('Profile from an unknown sender is ignored', async () => {
    const core = await createCore('alice');
    recordSends(core);
    const stranger = randomKey();
    await core.messageReceivedCallback({
        senderPublicKey: stranger,
        message: {
            type: messageType.userInfoResponse,
            senderInfo: {key: stranger, displayName: 'Stranger'},
        },
    });
    assert.equal(await core.getUserInfo(stranger), undefined);
    await core.stop();
});

test('A friend cannot overwrite another friend\'s profile', async () => {
    const core = await createCore('alice');
    recordSends(core);
    const bob = randomKey();
    const mallory = randomKey();
    await core.updateFriendInformation({key: bob, displayName: 'Bob'});
    await core.updateFriendInformation(
        {key: mallory, displayName: 'Mallory'});
    await core.messageReceivedCallback({
        senderPublicKey: mallory,
        message: {
            type: messageType.userInfoResponse,
            senderInfo: {key: bob, displayName: 'Evil Bob'},
        },
    });
    assert.equal((await core.getUserInfo(bob)).displayName, 'Bob');
    assert.equal((await core.getUserInfo(mallory)).displayName, 'Mallory');
    await core.stop();
});

test('A friend\'s own profile update is sanitized', async () => {
    const core = await createCore('alice');
    recordSends(core);
    const bob = randomKey();
    await core.updateFriendInformation({key: bob});
    await core.messageReceivedCallback({
        senderPublicKey: bob,
        message: {
            type: messageType.userInfoResponse,
            senderInfo: {
                key: bob,
                displayName: 'Bob',
                photo: 'https://evil.example/track.png',
                isRead: true,
            },
        },
    });
    const stored = await core.getUserInfo(bob);
    assert.equal(stored.displayName, 'Bob');
    assert.equal(stored.photo, '', 'Remote photo URLs must be dropped.');
    assert.notEqual(stored.isRead, true, 'Peers must not set local fields.');
    await core.stop();
});

test('Friend requests wait for the user instead of auto-replying',
    async () => {
        const core = await createCore('alice');
        const sent = recordSends(core);
        const carol = randomKey();
        await core.messageReceivedCallback({
            senderPublicKey: carol,
            message: {
                type: messageType.friendRequest,
                senderInfo: {key: carol, displayName: 'Carol'},
            },
        });
        assert.equal(sent.length, 0);
        assert.equal(await core.getUserInfo(carol), undefined);
        assert.equal(
            (await core.getPendingFriendRequests())[carol].displayName,
            'Carol');

        await core.acceptFriendRequest(carol);
        assert.equal((await core.getUserInfo(carol)).displayName, 'Carol');
        assert.deepEqual(sent,
            [[{key: carol}, messageType.userInfoResponse]]);
        assert.equal((await core.getPendingFriendRequests())[carol],
            undefined);
        await core.stop();
    });

test('Declining a friend request sends nothing', async () => {
    const core = await createCore('alice');
    const sent = recordSends(core);
    const dave = randomKey();
    await core.messageReceivedCallback({
        senderPublicKey: dave,
        message: {
            type: messageType.friendRequest,
            senderInfo: {displayName: 'Dave'},
        },
    });
    await core.declineFriendRequest(dave);
    assert.equal(sent.length, 0);
    assert.equal((await core.getPendingFriendRequests())[dave], undefined);
    assert.equal(await core.getUserInfo(dave), undefined);
    await core.stop();
});

test('Malformed messages and envelopes are dropped', async () => {
    const core = await createCore('alice');
    recordSends(core);
    const events = collectEvents(core);
    const bad = [
        null,
        {},
        {senderPublicKey: '__proto__', message: {type: 'ChatMessage'}},
        {senderPublicKey: randomKey(), message: null},
        {senderPublicKey: randomKey(), message: {type: 'Unknown'}},
        {senderPublicKey: randomKey(),
            message: {type: 'ChatMessage', message: {message: 1}}},
    ];
    for (const messageObj of bad) {
        await core.messageReceivedCallback(messageObj);
    }
    for (const envelope of ['', 'null', '{}', '[1]', '{"iv":{}}',
        JSON.stringify({senderPublicKey: randomKey(), message: '00',
            iv: {type: 'Buffer', data: new Array(16).fill(0)}})]) {
        await core.receiveEnvelope(envelope);
    }
    assert.equal(events.length, 0);
    await core.stop();
});

test('Chat from a stranger is dropped; duplicates are stored once',
    async () => {
        const core = await createCore('alice');
        const events = collectEvents(core);
        const bob = randomKey();
        const chat = {
            senderPublicKey: bob,
            message: {
                type: messageType.chat,
                message: {timestamp: 1000, message: 'hi'},
            },
        };
        await core.messageReceivedCallback(chat);
        assert.deepEqual(await core.getAllMessages(bob), []);

        await core.updateFriendInformation({key: bob, displayName: 'Bob'});
        await core.messageReceivedCallback(structuredClone(chat));
        await core.messageReceivedCallback(structuredClone(chat));
        const messages = await core.getAllMessages(bob);
        assert.equal(messages.length, 1);
        assert.deepEqual(messages[0].message,
            {timestamp: 1000, message: 'hi', type: 'received'});
        assert.equal(events.length, 1);
        assert.equal(events[0].isFromFriend, true);
        assert.equal((await core.getUserInfo(bob)).isRead, false);
        await core.stop();
    });

test('Renderer-facing calls reject bad input', async () => {
    const core = await createCore('alice');
    await assert.rejects(core.sendRequestOrResponse(
        {key: randomKey()}, 'ChatMessage'));
    await assert.rejects(core.sendChatMessage('not-hex',
        {timestamp: 1, message: 'x'}));
    await assert.rejects(core.updateFriendInformation({key: '<b>'}));
    assert.throws(() => core.storage.get('sqlite_master', 'x'));
    await core.stop();
});

test('Backup export and import round-trip', async () => {
    const alice = await createCore('alice');
    const bob = v1Crypto.getPublicKeyFromPrivateKey(
        v1Crypto.generatePrivateKey());
    await alice.updateFriendInformation({key: bob, displayName: 'Bob'});
    await alice.sendChatMessage(bob, {timestamp: 5, message: 'hello'});
    await alice.setPreference('language', 'de');
    const backup = await alice.exportBackup();
    assert.deepEqual(Object.keys(JSON.parse(backup)).sort(),
        Object.values(tableNames).sort());

    const restored = await createCore(null);
    await assert.rejects(restored.importBackup('{"Friends": [{}]}'));
    assert.equal(await restored.getLoggedInUserInfoPrivate(), undefined,
        'A rejected backup must change nothing.');
    await restored.importBackup(backup);
    assert.equal(await restored.getPublicKeyOfLoggedInUser(),
        await alice.getPublicKeyOfLoggedInUser());
    assert.equal((await restored.getUserInfo(bob)).displayName, 'Bob');
    assert.equal((await restored.getAllMessages(bob))[0].message.message,
        'hello');
    assert.equal((await restored.getPreference('language')).value, 'de');
    await alice.stop();
    await restored.stop();
});

test('Data survives a restart', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexhoot-core-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const file = path.join(dir, 'HexHoot.sqlite');
    const first = await createCore('alice', [], file);
    const key = await first.getPublicKeyOfLoggedInUser();
    await first.setPreference('language', 'ml');
    await first.stop();

    const second = await createCore(null, [], file);
    assert.equal(await second.getPublicKeyOfLoggedInUser(), key);
    assert.equal((await second.getPreference('language')).value, 'ml');
    await second.stop();
});

test('Two Cores befriend and chat over an in-memory transport', async () => {
    const hub = new MemoryHub();
    const alice = await createCore('alice', [hub.transport()]);
    const bob = await createCore('bob', [hub.transport()]);
    await befriendAndChat(alice, bob);
    await alice.stop();
    await bob.stop();
});

test('Editing the profile keeps the private key (finding S4)', async () => {
    const alice = await createCore('alice');
    const bob = await createCore('bob');
    const aliceKey = await alice.getPublicKeyOfLoggedInUser();
    await alice.writeLoggedInUserInfo({displayName: 'Alice', about: 'hi',
        privateKey: '11111111111111111111111111111111'});
    await bob.writeLoggedInUserInfo({displayName: 'Bob'});
    assert.equal(await alice.getPublicKeyOfLoggedInUser(), aliceKey,
        'A profile edit must not change the key.');
    assert.notEqual(await alice.getPublicKeyOfLoggedInUser(),
        await bob.getPublicKeyOfLoggedInUser(),
        'Two users who edit their profile must not share a key.');
    const info = await alice.getLoggedInUserInfoPublic();
    assert.equal(info.displayName, 'Alice');
    assert.equal(info.about, 'hi');

    const fresh = await createCore(null);
    await assert.rejects(fresh.writeLoggedInUserInfo({displayName: 'x'}));
    await alice.stop();
    await bob.stop();
    await fresh.stop();
});
