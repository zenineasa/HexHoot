/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L2 tests of the session layer over an in-memory network with faults.

const test = require('node:test');
const assert = require('node:assert/strict');
const {Messenger, MemoryMessengerStore} =
    require('../../modules/Protocol/Messenger');
const wire = require('../../modules/Protocol/wire');
const {Ratchet} = require('../../modules/Crypto/Ratchet');
const {MemoryNetwork} = require('./memoryNetwork');
const {randomIdentity} = require('../crypto/helpers');

/**
 * Wait until a condition holds
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
 * A peer: identity, store, messenger, and what it received
 * @param {MemoryNetwork} network the network
 * @param {Object} [options] {identity, store, authorize, retryMs}
 * @return {Promise<Object>} the peer
 */
async function peer(network, options = {}) {
    const identity = options.identity || randomIdentity();
    const store = options.store || new MemoryMessengerStore();
    const messenger = new Messenger({identity, store,
        carriers: [network.carrier()], authorize: options.authorize,
        retryMs: options.retryMs ?? 200,
        handshakeTimeoutMs: options.handshakeTimeoutMs ?? 1000});
    const received = [];
    const delivered = [];
    messenger.onMessage((m) => received.push(m));
    messenger.onDelivered((d) => delivered.push(d.id));
    await messenger.start();
    return {identity, store, messenger, received, delivered,
        address: identity.address,
        texts: () => received.map((m) => m.body.text)};
}

test('A friend request, receipts, and chat both ways', async (t) => {
    const network = new MemoryNetwork();
    const alice = await peer(network);
    const bob = await peer(network);
    t.after(() => Promise.all([alice.messenger.stop(), bob.messenger.stop()]));

    const id = await alice.messenger.send(bob.address, 'friend_request',
        {displayName: 'Alice'});
    await waitFor(() => bob.received.length === 1, 'the request');
    const [request] = bob.received;
    assert.equal(request.type, 'friend_request');
    assert.equal(request.id, id);
    // The sender is who the session authenticated, not what the body says
    assert.equal(request.from.address, alice.address);
    await waitFor(() => alice.delivered.includes(id), 'the receipt');
    assert.equal(alice.messenger.outbox.size, 0);

    await bob.messenger.send(alice.address, 'friend_accept', {});
    for (let i = 0; i < 5; i++) {
        await alice.messenger.send(bob.address, 'chat', {text: 'a' + i});
        await bob.messenger.send(alice.address, 'chat', {text: 'b' + i});
    }
    await waitFor(() => bob.texts().filter(Boolean).length === 5 &&
        alice.texts().filter(Boolean).length === 5, 'the chat');
    assert.deepEqual(bob.texts().filter(Boolean), ['a0', 'a1', 'a2', 'a3',
        'a4']);
    assert.equal(alice.messenger.sessionInfo(bob.address).safetyNumber,
        bob.messenger.sessionInfo(alice.address).safetyNumber);
});

test('Messages wait in the outbox until the contact is online',
    async (t) => {
        const network = new MemoryNetwork();
        // A long handshake timeout: the first HS1 reaches nobody, so this
        // only passes if HS1 is sent again on the retry ticks
        const alice = await peer(network, {handshakeTimeoutMs: 60000});
        const bobIdentity = randomIdentity();
        t.after(() => alice.messenger.stop());
        await alice.messenger.send(bobIdentity.address, 'chat',
            {text: 'are you there?'});
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(alice.messenger.outbox.size, 1);

        const bob = await peer(network, {identity: bobIdentity});
        t.after(() => bob.messenger.stop());
        await waitFor(() => bob.texts().includes('are you there?'),
            'delivery after bob comes online');
        await waitFor(() => alice.messenger.outbox.size === 0, 'the receipt');
    });

test('Lost, duplicated and reordered frames: each message arrives once',
    async (t) => {
        const network = new MemoryNetwork({drop: 0.2, duplicate: 0.2,
            delayMs: 40, seed: 7});
        const alice = await peer(network, {retryMs: 150});
        const bob = await peer(network, {retryMs: 150});
        t.after(() => Promise.all([alice.messenger.stop(),
            bob.messenger.stop()]));
        const sent = [];
        for (let i = 0; i < 30; i++) {
            sent.push('a' + i);
            await alice.messenger.send(bob.address, 'chat', {text: 'a' + i});
            if (i % 3 === 0) {
                await bob.messenger.send(alice.address, 'chat',
                    {text: 'b' + i});
            }
        }
        await waitFor(() => bob.received.length >= 30 &&
            alice.received.length >= 10 && alice.messenger.outbox.size === 0 &&
            bob.messenger.outbox.size === 0, 'everything', 30000);
        assert.deepEqual(bob.texts().sort(), sent.sort());
        assert.equal(new Set(bob.received.map((m) => m.id)).size, 30);
        assert.equal(alice.received.length, 10);
    });

test('A contact that lost its session gets a new handshake (RESET)',
    async (t) => {
        const network = new MemoryNetwork();
        const alice = await peer(network);
        const bob = await peer(network);
        t.after(() => alice.messenger.stop());
        await alice.messenger.send(bob.address, 'chat', {text: 'one'});
        await waitFor(() => bob.received.length === 1, 'the first message');
        await waitFor(() => alice.messenger.outbox.size === 0, 'its receipt');

        // bob's computer is replaced: same identity, nothing stored
        await bob.messenger.stop();
        const newBob = await peer(network, {identity: bob.identity});
        t.after(() => newBob.messenger.stop());
        await alice.messenger.send(bob.address, 'chat', {text: 'two'});
        await waitFor(() => newBob.texts().includes('two'),
            'delivery after the reset');
        // and newBob can answer at once
        await newBob.messenger.send(alice.address, 'chat', {text: 'back'});
        await waitFor(() => alice.texts().includes('back'), 'the answer');
    });

test('A restart with the stored sessions needs no new handshake',
    async (t) => {
        const network = new MemoryNetwork();
        const alice = await peer(network);
        const bob = await peer(network);
        t.after(() => alice.messenger.stop());
        await alice.messenger.send(bob.address, 'chat', {text: 'one'});
        await waitFor(() => alice.messenger.outbox.size === 0, 'a receipt');
        await bob.messenger.stop();

        const handshakes = () => network.log.filter((e) =>
            e[1] === wire.kinds.hs1).length;
        const before = handshakes();
        const bobAgain = await peer(network, {identity: bob.identity,
            store: bob.store});
        t.after(() => bobAgain.messenger.stop());
        await bobAgain.messenger.send(alice.address, 'chat', {text: 'back'});
        await alice.messenger.send(bob.address, 'chat', {text: 'two'});
        await waitFor(() => alice.texts().includes('back') &&
            bobAgain.texts().includes('two'), 'both messages');
        assert.equal(handshakes(), before);
    });

test('Simultaneous first messages end in one session per side',
    async (t) => {
        const network = new MemoryNetwork({delayMs: 20, seed: 3});
        const alice = await peer(network);
        const bob = await peer(network);
        t.after(() => Promise.all([alice.messenger.stop(),
            bob.messenger.stop()]));
        await Promise.all([
            alice.messenger.send(bob.address, 'chat', {text: 'hi bob'}),
            bob.messenger.send(alice.address, 'chat', {text: 'hi alice'}),
        ]);
        await waitFor(() => alice.texts().includes('hi alice') &&
            bob.texts().includes('hi bob'), 'both greetings');
        await waitFor(() => alice.messenger.outbox.size === 0 &&
            bob.messenger.outbox.size === 0, 'receipts');
        // Both send on the same session from now on
        const current = (p, other) => p.messenger.sessions.get(other)[0].tag;
        assert.deepEqual(current(alice, bob.address),
            current(bob, alice.address));
        await alice.messenger.send(bob.address, 'chat', {text: 'after'});
        await waitFor(() => bob.texts().includes('after'), 'a later message');
    });

test('Someone the responder refuses gets nothing through', async (t) => {
    const network = new MemoryNetwork();
    const mallory = await peer(network);
    const bob = await peer(network, {authorize: () => false});
    t.after(() => Promise.all([mallory.messenger.stop(),
        bob.messenger.stop()]));
    await mallory.messenger.send(bob.address, 'chat', {text: 'spam'});
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(bob.received.length, 0);
    assert.equal(bob.messenger.sessions.size, 0);
});

test('Nothing on the wire identifies the people talking', async (t) => {
    const network = new MemoryNetwork();
    const alice = await peer(network);
    const bob = await peer(network);
    t.after(() => Promise.all([alice.messenger.stop(), bob.messenger.stop()]));
    await alice.messenger.send(bob.address, 'chat', {text: 'secret words'});
    await waitFor(() => bob.received.length === 1, 'the first message');
    await bob.messenger.send(alice.address, 'chat', {text: 'more secrets'});
    await waitFor(() => bob.received.length === 1 &&
        alice.received.length === 1, 'the messages');
    const wireBytes = Buffer.concat(network.log);
    for (const who of [alice.identity, bob.identity]) {
        assert.ok(!wireBytes.includes(who.fingerprint));
        assert.ok(!wireBytes.includes(Buffer.from(who.address)));
        assert.ok(!wireBytes.includes(who.public.ikEc));
    }
    assert.ok(!wireBytes.includes(Buffer.from('secret')));
    // Only the first frame names a topic: the one the message is for
    const topics = network.log.filter((e) => e[1] === wire.kinds.hs1)
        .map((e) => e.subarray(2, 34).toString('hex'));
    assert.deepEqual(topics, [bob.identity.public.topic.toString('hex')]);
});

test('Ratchet state is stored before its ciphertext leaves', async (t) => {
    const network = new MemoryNetwork();
    const aliceStore = new MemoryMessengerStore();
    const alice = await peer(network, {store: aliceStore});
    const bob = await peer(network);
    t.after(() => Promise.all([alice.messenger.stop(), bob.messenger.stop()]));
    const violations = [];
    const deliver = network.deliver.bind(network);
    network.deliver = (from, to, envelope) => {
        const decoded = wire.decodeEnvelope(envelope);
        if (decoded?.kind === wire.kinds.msg &&
            from === alice.messenger.carriers[0]) {
            // The stored state must already be past this message: same
            // sending key, and a counter beyond its number
            const body = decoded.body;
            const dh = body.subarray(1, 1 + 133);
            const n = body.readUInt32BE(1 + 133 + 1568 + 1568 + 4);
            const stored = aliceStore.sessions.get(bob.address) || [];
            const ok = stored.some((s) => {
                const ratchet = Ratchet.deserialize(s.state);
                return ratchet.dhs.publicKey.subarray(0, 133).equals(dh) &&
                    ratchet.ns > n;
            });
            if (!ok) {
                violations.push(n);
            }
        }
        deliver(from, to, envelope);
    };
    for (let i = 0; i < 10; i++) {
        await alice.messenger.send(bob.address, 'chat', {text: 'm' + i});
    }
    await waitFor(() => bob.received.length === 10, 'the messages');
    assert.deepEqual(violations, []);
});

test('Bad addresses and our own address are refused', async (t) => {
    const network = new MemoryNetwork();
    const alice = await peer(network);
    t.after(() => alice.messenger.stop());
    await assert.rejects(alice.messenger.send('hh21nope', 'chat', {}),
        {code: 'BAD_ADDRESS'});
    await assert.rejects(alice.messenger.send(alice.address, 'chat', {}),
        {code: 'BAD_PARAMS'});
    await assert.rejects(alice.messenger.send(randomIdentity().address,
        'receipt', {}), {code: 'BAD_PARAMS'});
});
