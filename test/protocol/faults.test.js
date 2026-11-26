/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// The fault-injecting carrier wrapper used by HEXHOOT_TEST_FAULTS (L3)

const test = require('node:test');
const assert = require('node:assert/strict');
const {parseFaults, withFaults} = require('../../modules/Protocol/faults');
const {Messenger, MemoryMessengerStore} =
    require('../../modules/Protocol/Messenger');
const {MemoryNetwork, seeded} = require('./memoryNetwork');
const {randomIdentity} = require('../crypto/helpers');

test('Fault specs are parsed and checked', () => {
    assert.deepEqual(parseFaults('drop:0.1,dup:0.05,reorder:0.1,delay:0-500'),
        {drop: 0.1, dup: 0.05, reorder: 0.1, delay: [0, 500]});
    assert.deepEqual(parseFaults('delay:20'),
        {drop: 0, dup: 0, reorder: 0, delay: [20, 20]});
    assert.deepEqual(parseFaults(''),
        {drop: 0, dup: 0, reorder: 0, delay: [0, 0]});
    for (const bad of ['drop:1', 'drop:-0.1', 'dup:x', 'delay:5-1',
        'flip:0.1']) {
        assert.throws(() => parseFaults(bad), /fault/, bad);
    }
});

test('The wrapper runs everything else on the carrier itself', async () => {
    const network = new MemoryNetwork();
    const carrier = network.carrier();
    const faulty = withFaults(carrier, parseFaults(''));
    await faulty.start(Buffer.alloc(32, 1));
    assert.equal(carrier.topic.length, 32);
    assert.equal(faulty.name, 'memory');
    await faulty.stop();
    assert.equal(carrier.topic, null);
});

test('Over a faulty carrier each message still arrives once', async (t) => {
    const network = new MemoryNetwork();
    const random = seeded(3);
    const faults = parseFaults('drop:0.2,dup:0.2,reorder:0.2,delay:0-30');
    const peers = [];
    for (let i = 0; i < 2; i++) {
        const identity = randomIdentity();
        const carrier = withFaults(network.carrier(), faults, random);
        const messenger = new Messenger({identity,
            store: new MemoryMessengerStore(), carriers: [carrier],
            retryMs: 150, handshakeTimeoutMs: 1000});
        const received = [];
        messenger.onMessage((m) => received.push(m.body.text));
        await messenger.start();
        peers.push({identity, carrier, messenger, received});
    }
    const [alice, bob] = peers;
    t.after(() => Promise.all(peers.map((p) => p.messenger.stop())));
    const sent = [];
    for (let i = 0; i < 20; i++) {
        sent.push('m' + i);
        await alice.messenger.send(bob.identity.address, 'chat',
            {text: 'm' + i});
    }
    const end = Date.now() + 30000;
    while (bob.received.length < 20 || alice.messenger.outbox.size > 0) {
        assert.ok(Date.now() < end, 'Timed out');
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.deepEqual([...bob.received].sort(), sent.sort());
    // The faults happened
    const {dropped, duplicated, reordered} = alice.carrier.stats;
    assert.ok(dropped > 0 && duplicated > 0 && reordered > 0,
        JSON.stringify(alice.carrier.stats));
});
