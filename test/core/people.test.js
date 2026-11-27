/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L2 tests of the Core additions the Hive UI needs (docs/design/ui-hive.md):
// withdrawing a request, removing and blocking, not sending a waiting
// message, events in a conversation, and how contacts were last heard from.

const test = require('node:test');
const assert = require('node:assert/strict');
const {MemoryNetwork} = require('../protocol/memoryNetwork');
const {makeCore, signedIn, waitFor, befriendAndChat, password} =
    require('./helpers');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const kinds = (conversation) => conversation.map((m) =>
    m.kind === 'event' ? 'event:' + m.event.kind : m.kind);

test('A withdrawn request disappears from the other side', async (t) => {
    const network = new MemoryNetwork();
    const alice = await signedIn('Alice Liddell', {t, network});
    const bob = await signedIn('Bobby Tables', {t, network});
    const aliceAddress = await alice.getMyAddress();
    const bobAddress = await bob.getMyAddress();
    await alice.addFriend(bobAddress);
    await waitFor(async () => (await bob.getPendingFriendRequests())[
        aliceAddress], 'the request');
    await alice.withdrawFriendRequest(bobAddress);
    assert.equal(await alice.getUserInfo(bobAddress), undefined);
    await waitFor(async () => !(await bob.getPendingFriendRequests())[
        aliceAddress], 'the withdrawal');
    await assert.rejects(alice.withdrawFriendRequest(bobAddress),
        {code: 'NOT_PENDING'});
});

test('A request withdrawn before it left is never sent', async (t) => {
    const alice = await signedIn('Alice Liddell', {t});
    const bob = await makeCore({t});
    t.after(() => bob.stop());
    await bob.writeLoggedInUserInfo({displayName: 'Bobby Tables', password});
    const bobAddress = await bob.getMyAddress();
    await alice.addFriend(bobAddress);
    await alice.withdrawFriendRequest(bobAddress);
    // Only the withdrawal waits; the request itself is gone
    assert.deepEqual([...alice.messenger.outbox.values()].map((i) => i.type),
        ['friend_withdraw']);
});

test('Removing a friend forgets them; they can knock again', async (t) => {
    const network = new MemoryNetwork();
    const alice = await signedIn('Alice Liddell', {t, network});
    const bob = await signedIn('Bobby Tables', {t, network});
    await befriendAndChat(alice, bob);
    const aliceAddress = await alice.getMyAddress();
    const bobAddress = await bob.getMyAddress();
    await alice.removeContact(bobAddress);
    assert.equal(await alice.getUserInfo(bobAddress), undefined);
    assert.deepEqual(await alice.getConversation(bobAddress), []);
    assert.equal(alice.messenger.sessions.has(bobAddress), false);
    // bob still thinks they are friends; his chat is dropped
    await bob.sendChatMessage(aliceAddress, {message: 'still there?'});
    await pause(300);
    assert.deepEqual(await alice.getConversation(bobAddress), []);
    // but he can knock again
    await bob.removeContact(aliceAddress);
    await bob.addFriend(aliceAddress);
    await waitFor(async () => (await alice.getPendingFriendRequests())[
        bobAddress], 'a new request');
});

test('A blocked address gets nothing through until unblocked', async (t) => {
    const network = new MemoryNetwork();
    const alice = await signedIn('Alice Liddell', {t, network});
    const bob = await signedIn('Bobby Tables', {t, network});
    await befriendAndChat(alice, bob);
    const aliceAddress = await alice.getMyAddress();
    const bobAddress = await bob.getMyAddress();
    await alice.blockAddress(bobAddress);
    assert.deepEqual((await alice.getBlocked()).map((b) =>
        [b.address, b.displayName]), [[bobAddress, 'Bobby Tables']]);
    await bob.sendChatMessage(aliceAddress, {message: 'let me in'});
    await bob.removeContact(aliceAddress);
    await bob.addFriend(aliceAddress);
    await pause(600);
    assert.deepEqual(await alice.getConversation(bobAddress), []);
    assert.deepEqual(await alice.getPendingFriendRequests(), {});
    await alice.unblockAddress(bobAddress);
    await bob.removeContact(aliceAddress);
    await bob.addFriend(aliceAddress);
    await waitFor(async () => (await alice.getPendingFriendRequests())[
        bobAddress], 'a request after unblocking', 15000);
});

test('Don\'t send: a waiting message leaves; a delivered one stays',
    async (t) => {
        const network = new MemoryNetwork();
        const alice = await signedIn('Alice Liddell', {t, network});
        const bob = await signedIn('Bobby Tables', {t, network});
        await befriendAndChat(alice, bob);
        const bobAddress = await bob.getMyAddress();
        const delivered = await alice.sendChatMessage(bobAddress,
            {message: 'arrives'});
        await waitFor(async () => (await alice.getConversation(bobAddress))
            .find((m) => m.id === delivered)?.delivered, 'delivery');
        assert.equal(await alice.cancelUnsent(bobAddress, delivered), false);
        // bob goes offline; the next message waits, and is taken back
        await bob.messenger.stop();
        const waiting = await alice.sendChatMessage(bobAddress,
            {message: 'never mind'});
        assert.equal(await alice.cancelUnsent(bobAddress, waiting), true);
        assert.ok(!(await alice.getConversation(bobAddress))
            .some((m) => m.id === waiting));
        assert.ok(![...alice.messenger.outbox.keys()].includes(waiting));
    });

test('Conversations carry events: let in, verified, renamed, photo',
    async (t) => {
        const network = new MemoryNetwork();
        const alice = await signedIn('Alice Liddell', {t, network});
        const bob = await signedIn('Bobby Tables', {t, network});
        await befriendAndChat(alice, bob);
        const aliceAddress = await alice.getMyAddress();
        const bobAddress = await bob.getMyAddress();
        assert.deepEqual(kinds(await bob.getConversation(aliceAddress)),
            ['event:accepted', 'received', 'sent']);
        assert.equal((await bob.getConversation(aliceAddress))[0].event.by,
            'me');
        assert.equal((await alice.getConversation(bobAddress))[0].event.by,
            'them');
        await alice.setVerified(bobAddress, true);
        await alice.setVerified(bobAddress, true); // no second event
        await bob.updateProfile({displayName: 'Bob T.',
            photo: 'data:image/png;base64,iVBORw0KGgo='});
        await waitFor(async () => (await alice.getUserInfo(bobAddress))
            .displayName === 'Bob T.', 'the new name');
        const events = (await alice.getConversation(bobAddress))
            .filter((m) => m.kind === 'event').map((m) => m.event);
        assert.deepEqual(events.map((e) => e.kind),
            ['accepted', 'verified', 'renamed', 'photo']);
        assert.deepEqual([events[2].from, events[2].to],
            ['Bobby Tables', 'Bob T.']);
        // The old message list leaves events out
        assert.equal((await alice.getAllMessages(bobAddress)).length, 2);
    });

test('Adding each other is recorded as a mutual let-in', async (t) => {
    const network = new MemoryNetwork();
    const alice = await signedIn('Alice Liddell', {t, network});
    const bob = await signedIn('Bobby Tables', {t, network});
    const aliceAddress = await alice.getMyAddress();
    const bobAddress = await bob.getMyAddress();
    await alice.addFriend(bobAddress);
    await bob.addFriend(aliceAddress);
    await waitFor(async () =>
        (await alice.getUserInfo(bobAddress))?.status === 'friend' &&
        (await bob.getUserInfo(aliceAddress))?.status === 'friend', 'friends');
    const all = [...await alice.getConversation(bobAddress),
        ...await bob.getConversation(aliceAddress)];
    assert.ok(all.some((m) => m.kind === 'event' && m.event.by === 'both'));
});

test('Contacts are known by how they were last heard from', async (t) => {
    const network = new MemoryNetwork();
    const alice = await signedIn('Alice Liddell', {t, network});
    const bob = await signedIn('Bobby Tables', {t, network});
    const links = [];
    alice.onEvent((e) => e.type === 'link' && links.push(e));
    await befriendAndChat(alice, bob);
    const bobAddress = await bob.getMyAddress();
    const known = await alice.getContactLinks();
    assert.equal(known[bobAddress].via, 'memory');
    assert.ok(known[bobAddress].at > 0);
    assert.ok(links.some((e) => e.senderPublicKey === bobAddress));
});

test('Blocked addresses survive a backup', async (t) => {
    const network = new MemoryNetwork();
    const alice = await signedIn('Alice Liddell', {t, network});
    const bob = await signedIn('Bobby Tables', {t, network});
    const bobAddress = await bob.getMyAddress();
    await alice.blockAddress(bobAddress);
    const file = await alice.exportBackup('a long backup passphrase');
    await alice.stop();
    const restored = await makeCore({t});
    t.after(() => restored.stop());
    await restored.importBackup(file, 'a long backup passphrase');
    assert.deepEqual((await restored.getBlocked()).map((b) => b.address),
        [bobAddress]);
});
