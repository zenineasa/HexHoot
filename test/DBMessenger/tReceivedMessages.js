/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

// Regression tests for findings S1-S3 (docs/assessment/crypto-findings.md):
// peer-controlled profile data must never be rendered as HTML, profiles may
// only be updated by their owner, and friend requests must not be answered
// automatically.

const utils = require('./../../../test/utils');
const dbMessenger = require('./../../../modules/DBMessenger')();
const dbWrapper = require('./../../../modules/DBMessenger/DBWrapper')();
const Chat = require('./../../../modules/Chat');

const XSS_NAME = '<img src=x onerror="window.__hexhootPwned=true">';

/**
 * Generate a random hex string that looks like a public key.
 * @return {string} hex key
 */
function randomKey() {
    const bytes = new Uint8Array(33);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Replace the network send with a recorder for the duration of a test.
 * @return {Array} list that receives [otherUserInfo, requestType] entries
 */
function recordSends() {
    const sent = [];
    dbMessenger.sendRequestOrResponse = async function(info, type) {
        sent.push([info, type]);
    };
    return sent;
}

const originalSend = dbMessenger.sendRequestOrResponse;

QUnit.module('DBMessenger received messages', {
    afterEach: function() {
        dbMessenger.sendRequestOrResponse = originalSend;
    },
});

QUnit.test('Profile from an unknown sender is ignored', async function(assert) {
    recordSends();
    const stranger = randomKey();
    await dbMessenger.messageReceivedCallback({
        senderPublicKey: stranger,
        message: {
            type: dbMessenger.messageType.userInfoResponse,
            senderInfo: {key: stranger, displayName: 'Stranger'},
        },
    });
    assert.strictEqual(await dbMessenger.getUserInfo(stranger), undefined,
        'A stranger must not be added to the friends list.');
});

QUnit.test('A friend cannot overwrite another friend\'s profile',
    async function(assert) {
        recordSends();
        const bob = randomKey();
        const mallory = randomKey();
        await dbMessenger.updateFriendInformation(
            {key: bob, displayName: 'Bob'});
        await dbMessenger.updateFriendInformation(
            {key: mallory, displayName: 'Mallory'});

        await dbMessenger.messageReceivedCallback({
            senderPublicKey: mallory,
            message: {
                type: dbMessenger.messageType.userInfoResponse,
                senderInfo: {key: bob, displayName: 'Evil Bob'},
            },
        });

        assert.strictEqual((await dbMessenger.getUserInfo(bob)).displayName,
            'Bob', 'Bob\'s profile must be unchanged.');
        assert.strictEqual(
            (await dbMessenger.getUserInfo(mallory)).displayName,
            'Mallory', 'Mallory\'s profile must be unchanged.');
    });

QUnit.test('A friend\'s own profile update is sanitized',
    async function(assert) {
        recordSends();
        const bob = randomKey();
        await dbMessenger.updateFriendInformation({key: bob});
        await dbMessenger.messageReceivedCallback({
            senderPublicKey: bob,
            message: {
                type: dbMessenger.messageType.userInfoResponse,
                senderInfo: {
                    key: bob,
                    displayName: 'Bob',
                    photo: 'https://evil.example/track.png',
                    isRead: true,
                },
            },
        });
        const stored = await dbMessenger.getUserInfo(bob);
        assert.strictEqual(stored.displayName, 'Bob');
        assert.strictEqual(stored.photo, '',
            'Remote photo URLs must be dropped.');
        assert.notStrictEqual(stored.isRead, true,
            'Peers must not set local fields.');
    });

QUnit.test('Friend requests wait for the user instead of auto-replying',
    async function(assert) {
        const sent = recordSends();
        const carol = randomKey();
        await dbMessenger.messageReceivedCallback({
            senderPublicKey: carol,
            message: {
                type: dbMessenger.messageType.friendRequest,
                senderInfo: {key: carol, displayName: 'Carol'},
            },
        });

        assert.strictEqual(sent.length, 0,
            'Nothing may be sent before the user accepts.');
        assert.strictEqual(await dbMessenger.getUserInfo(carol), undefined,
            'The requester must not be a friend yet.');
        const pending = await dbMessenger.getPendingFriendRequests();
        assert.strictEqual(pending[carol].displayName, 'Carol');

        await dbMessenger.acceptFriendRequest(carol);
        assert.strictEqual(
            (await dbMessenger.getUserInfo(carol)).displayName, 'Carol');
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0][0].key, carol);
        assert.strictEqual(sent[0][1],
            dbMessenger.messageType.userInfoResponse);
        assert.strictEqual(
            (await dbMessenger.getPendingFriendRequests())[carol], undefined);
    });

QUnit.test('Declining a friend request sends nothing', async function(assert) {
    const sent = recordSends();
    const dave = randomKey();
    await dbMessenger.messageReceivedCallback({
        senderPublicKey: dave,
        message: {
            type: dbMessenger.messageType.friendRequest,
            senderInfo: {displayName: 'Dave'},
        },
    });
    await dbMessenger.declineFriendRequest(dave);
    assert.strictEqual(sent.length, 0);
    assert.strictEqual(
        (await dbMessenger.getPendingFriendRequests())[dave], undefined);
    assert.strictEqual(await dbMessenger.getUserInfo(dave), undefined);
});

QUnit.test('Malformed messages are dropped without throwing',
    async function(assert) {
        recordSends();
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
            await dbMessenger.messageReceivedCallback(messageObj);
        }
        assert.ok(true, 'No exception escaped.');
    });

QUnit.test('A malicious display name renders as text', async function(assert) {
    recordSends();
    const evil = randomKey();
    // Store it directly, bypassing sanitization, as data saved by an older
    // version of the app would be.
    await dbWrapper.addOrEditEntry(dbMessenger.tableNames.friends, {
        key: evil,
        displayName: XSS_NAME,
        photo: 'x);background:url(https://evil.example/',
        lastMessageTimestamp: Date.now(),
    });

    await utils.setFixtureWithContainerDOMElemenent();
    await new Chat().render();

    await utils.waitAndTryAgain(async function(assert) {
        const li = document.getElementById('sidebar_li_' + evil);
        assert.ok(li !== null, 'The friend should be listed.');
        assert.strictEqual(li.querySelector('.name').textContent, XSS_NAME,
            'The name must be shown literally.');
        assert.strictEqual(li.getElementsByTagName('img').length, 0,
            'No element may be created from the name.');
        assert.ok(!li.querySelector('.photo').style.backgroundImage
            .includes('evil.example'), 'Unsafe photos must not be used.');
    }, assert);

    // Give a potential onerror handler time to fire
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(window.__hexhootPwned, undefined,
        'Injected handlers must not run.');
});
