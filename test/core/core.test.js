/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L2 tests of Core on the v2 stack: the account (ADR-004), encrypted
// storage, contacts and friend requests, chat, password checks and backup.
// Several are regression tests for findings S1-S5 and F6
// (docs/assessment/crypto-findings.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {MemoryNetwork} = require('../protocol/memoryNetwork');
const {rendererMethods} = require('../../modules/Core/constants.mjs');
const {
    fakeSealer, makeCore, signedIn, waitFor, collectEvents, befriendAndChat,
    password,
} = require('./helpers');

test('Logging in creates the account; a restart opens it by itself',
    async (t) => {
        const core = await makeCore({t});
        assert.equal((await core.getAccountState()).state, 'none');
        await core.writeLoggedInUserInfo({displayName: 'Alice Liddell',
            password});
        const address = await core.getMyAddress();
        assert.match(address, /^hh21/);
        assert.equal((await core.getLoggedInUserInfoPublic()).displayName,
            'Alice Liddell');
        await core.setPreference('language', 'de');
        await core.stop();

        const again = await makeCore({dir: core.dir, sealer: core.sealer});
        t.after(() => again.stop());
        assert.equal((await again.getAccountState()).state, 'ready');
        assert.equal(await again.getMyAddress(), address);
        assert.equal((await again.getPreference('language')).value, 'de');
    });

test('The same name and password give the same account elsewhere',
    async (t) => {
        const here = await signedIn('Alice Liddell', {t});
        const there = await makeCore({t});
        t.after(() => there.stop());
        await there.writeLoggedInUserInfo({displayName: ' alice  LIDDELL',
            password});
        assert.equal(await there.getMyAddress(), await here.getMyAddress());
    });

test('Weak names and passwords are refused, with the reasons',
    async (t) => {
        const core = await makeCore({t});
        t.after(() => core.stop());
        await assert.rejects(core.writeLoggedInUserInfo(
            {displayName: 'Alice Liddell', password: 'short'}),
        (err) => err.code === 'WEAK_CREDENTIALS' &&
            err.problems.includes('passwordTooShort'));
        assert.equal((await core.getAccountState()).state, 'none');
        assert.equal(fs.existsSync(path.join(core.dir, 'keyring.json')),
            false);
    });

test('Without a strong OS keyring the password unlocks the account',
    async (t) => {
        const sealer = fakeSealer(false);
        const core = await signedIn('Alice Liddell', {t, sealer});
        const address = await core.getMyAddress();
        await core.stop();
        const again = await makeCore({dir: core.dir, sealer});
        t.after(() => again.stop());
        assert.equal((await again.getAccountState()).state, 'locked');
        await assert.rejects(again.unlock('wrong password, long enough'),
            {code: 'WRONG_PASSWORD'});
        await again.unlock(password);
        assert.equal(await again.getMyAddress(), address);
    });

test('Nothing readable is stored on disk', async (t) => {
    const network = new MemoryNetwork();
    const alice = await signedIn('Alice Liddell', {t, network});
    const bob = await signedIn('Bobby Tables', {t, network});
    await befriendAndChat(alice, bob);
    await alice.updateProfile({about: 'curiouser and curiouser'});
    const bobAddress = await bob.getMyAddress();
    await alice.stop();
    const disk = Buffer.concat(fs.readdirSync(alice.dir).map((f) =>
        fs.readFileSync(path.join(alice.dir, f))));
    for (const secret of ['hi bob', 'hi alice', 'Bobby', 'Alice',
        'curiouser', bobAddress, 'hh21']) {
        assert.ok(!disk.includes(Buffer.from(secret)), secret);
    }
});

test('Friend requests wait for a decision; accepting makes friends',
    async (t) => {
        const network = new MemoryNetwork();
        const alice = await signedIn('Alice Liddell', {t, network});
        const bob = await signedIn('Bobby Tables', {t, network});
        const aliceAddress = await alice.getMyAddress();
        const bobAddress = await bob.getMyAddress();
        const bobEvents = collectEvents(bob);
        await alice.addFriend(bobAddress);
        assert.equal((await alice.getAllFriends())[0].pending, true);
        await waitFor(async () => (await bob.getPendingFriendRequests())[
            aliceAddress], 'the request');
        assert.equal((await bob.getPendingFriendRequests())[aliceAddress]
            .displayName, 'Alice Liddell');
        assert.ok(bobEvents.some((e) => e.message?.type === 'FriendRequest'));
        // No automatic reply (S3): alice still waits
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal((await alice.getUserInfo(bobAddress)).status,
            'pending-out');
        await assert.rejects(alice.sendChatMessage(bobAddress,
            {message: 'too early'}), {code: 'NOT_A_FRIEND'});

        await bob.acceptFriendRequest(aliceAddress);
        await waitFor(async () => (await alice.getUserInfo(bobAddress))
            .displayName === 'Bobby Tables', 'bob\'s profile');
        assert.equal((await alice.getUserInfo(bobAddress)).status, 'friend');
        assert.equal(await alice.getSafetyNumber(bobAddress),
            await bob.getSafetyNumber(aliceAddress));
    });

test('Chat both ways, with delivery marked', async (t) => {
    const network = new MemoryNetwork();
    const alice = await signedIn('Alice Liddell', {t, network});
    const bob = await signedIn('Bobby Tables', {t, network});
    await befriendAndChat(alice, bob);
    const bobAddress = await bob.getMyAddress();
    await waitFor(async () => (await alice.getAllMessages(bobAddress))[0]
        .message.delivered, 'the receipt');
    assert.equal((await alice.getAllFriends())[0].isRead, false);
    await alice.markChatRead(bobAddress);
    assert.equal((await alice.getAllFriends())[0].isRead, true);
});

test('Adding each other makes friends without accepting', async (t) => {
    const network = new MemoryNetwork();
    const alice = await signedIn('Alice Liddell', {t, network});
    const bob = await signedIn('Bobby Tables', {t, network});
    const aliceAddress = await alice.getMyAddress();
    const bobAddress = await bob.getMyAddress();
    await alice.addFriend(bobAddress);
    await bob.addFriend(aliceAddress);
    await waitFor(async () =>
        (await alice.getUserInfo(bobAddress))?.status === 'friend' &&
        (await bob.getUserInfo(aliceAddress))?.status === 'friend',
    'both to be friends');
});

test('Declining sends nothing; strangers cannot chat', async (t) => {
    const network = new MemoryNetwork();
    const bob = await signedIn('Bobby Tables', {t, network});
    const mallory = await signedIn('Mallory Evil', {t, network});
    const bobAddress = await bob.getMyAddress();
    const malloryAddress = await mallory.getMyAddress();
    await mallory.addFriend(bobAddress);
    await waitFor(async () => (await bob.getPendingFriendRequests())[
        malloryAddress], 'the request');
    await bob.declineFriendRequest(malloryAddress);
    assert.deepEqual(await bob.getPendingFriendRequests(), {});
    // mallory can still reach bob, but a chat from a stranger is dropped
    await mallory.messenger.send(bobAddress, 'chat', {text: 'spam'});
    await waitFor(() => mallory.messenger.outbox.size === 0, 'delivery');
    assert.deepEqual(await bob.getAllMessages(malloryAddress), []);
    assert.equal((await mallory.getUserInfo(bobAddress)).status,
        'pending-out');
});

test('Profiles: only the sender\'s own is updated (S2), and sanitized',
    async (t) => {
        const network = new MemoryNetwork();
        const alice = await signedIn('Alice Liddell', {t, network});
        const bob = await signedIn('Bobby Tables', {t, network});
        await befriendAndChat(alice, bob);
        const aliceAddress = await alice.getMyAddress();
        const bobAddress = await bob.getMyAddress();
        await bob.messenger.send(aliceAddress, 'profile', {
            key: 'hh21someoneelse', displayName: 'B'.repeat(500),
            photo: 'javascript:alert(1)', status: 'pending-in',
            isRead: true, verified: true});
        await waitFor(async () => (await alice.getUserInfo(bobAddress))
            .displayName.length === 64, 'the profile');
        const contact = await alice.getUserInfo(bobAddress);
        assert.equal(contact.key, bobAddress);
        assert.equal(contact.status, 'friend');
        assert.equal(contact.photo, '');
        assert.equal(contact.verified, undefined);
        assert.equal((await alice.getAllFriends()).length, 1);
    });

test('Only the user marks a contact verified; profiles keep the mark',
    async (t) => {
        const network = new MemoryNetwork();
        const alice = await signedIn('Alice Liddell', {t, network});
        const bob = await signedIn('Bobby Tables', {t, network});
        await befriendAndChat(alice, bob);
        const bobAddress = await bob.getMyAddress();
        await alice.setVerified(bobAddress, true);
        await bob.updateProfile({about: 'new about'});
        await waitFor(async () => (await alice.getUserInfo(bobAddress))
            .about === 'new about', 'the profile update');
        assert.equal((await alice.getUserInfo(bobAddress)).verified, true);
        await alice.setVerified(bobAddress, false);
        assert.equal((await alice.getUserInfo(bobAddress)).verified, false);
        await assert.rejects(alice.setVerified('hh21nobody', true),
            {code: 'NOT_A_CONTACT'});
    });

test('A message id cannot overwrite another message (F6)', async (t) => {
    const network = new MemoryNetwork();
    const alice = await signedIn('Alice Liddell', {t, network});
    const bob = await signedIn('Bobby Tables', {t, network});
    await befriendAndChat(alice, bob);
    const bobAddress = await bob.getMyAddress();
    const [sent] = await alice.getAllMessages(bobAddress);
    await alice.receive({from: bob.identity.public, id: sent.key,
        ts: 1, type: 'chat', body: {text: 'rewritten'}});
    const messages = await alice.getAllMessages(bobAddress);
    assert.equal(messages.find((m) => m.message.type === 'sent').message
        .message, 'hi bob');
});

test('Editing the profile keeps the identity (S4) and tells friends',
    async (t) => {
        const network = new MemoryNetwork();
        const alice = await signedIn('Alice Liddell', {t, network});
        const bob = await signedIn('Bobby Tables', {t, network});
        await befriendAndChat(alice, bob);
        const address = await alice.getMyAddress();
        await alice.writeLoggedInUserInfo({about: 'new about',
            privateKey: '11'.repeat(32)});
        assert.equal(await alice.getMyAddress(), address);
        await waitFor(async () => (await bob.getUserInfo(address)).about ===
            'new about', 'the profile update');
    });

test('Password checks: due later, right and wrong answers', async (t) => {
    let offset = 0;
    const core = await signedIn('Alice Liddell', {t,
        now: () => Date.now() + offset});
    assert.equal((await core.getPasswordCheck()).due, false);
    offset = 4 * 24 * 3600 * 1000;
    assert.equal((await core.getPasswordCheck()).due, true);
    const wrong = await core.checkPassword('not the password at all');
    assert.equal(wrong.correct, false);
    assert.equal((await core.getPasswordCheck()).due, false);
    const right = await core.checkPassword(password);
    assert.deepEqual([right.correct, right.afterMiss], [true, true]);
    await core.skipPasswordCheck();
});

test('A backup restores the account, contacts and chat elsewhere',
    async (t) => {
        const network = new MemoryNetwork();
        const alice = await signedIn('Alice Liddell', {t, network});
        const bob = await signedIn('Bobby Tables', {t, network});
        await befriendAndChat(alice, bob);
        const passphrase = 'a long backup passphrase';
        const file = await alice.exportBackup(passphrase);
        await assert.rejects(alice.exportBackup('short'),
            {code: 'WEAK_CREDENTIALS'});
        const aliceAddress = await alice.getMyAddress();
        const bobAddress = await bob.getMyAddress();
        await alice.stop();

        const restored = await makeCore({t, network});
        t.after(() => restored.stop());
        await assert.rejects(restored.importBackup(file,
            'wrong passphrase!!'), {code: 'BAD_PASSPHRASE'});
        await restored.importBackup(file, passphrase);
        assert.equal(await restored.getMyAddress(), aliceAddress);
        assert.equal((await restored.getAllMessages(bobAddress)).length, 2);
        // No session came along: a new handshake, and chat goes on
        await restored.sendChatMessage(bobAddress, {message: 'restored'});
        await waitFor(async () => (await bob.getAllMessages(aliceAddress))
            .some((m) => m.message.message === 'restored'), 'delivery');
    });

test('Deleting the account removes everything', async (t) => {
    const core = await signedIn('Alice Liddell', {t});
    await core.deleteDatabaseContent();
    assert.equal((await core.getAccountState()).state, 'none');
    assert.equal(fs.existsSync(path.join(core.dir, 'keyring.json')), false);
    await assert.rejects(core.getAllFriends(), {code: 'NOT_SIGNED_IN'});
});

test('Every renderer method exists', () => {
    const Core = require('../../modules/Core');
    for (const method of rendererMethods) {
        assert.equal(typeof Core.prototype[method], 'function', method);
    }
});
