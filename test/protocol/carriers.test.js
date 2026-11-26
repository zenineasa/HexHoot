/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L2 tests: Messengers over the real carriers. The LAN carrier runs on
// 127.0.0.1; Hyperswarm runs on a private testnet, never the public DHT.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const createTestnet = require('hyperdht/testnet');
const {Messenger} = require('../../modules/Protocol/Messenger');
const DhtCarrier = require('../../modules/Protocol/DhtCarrier');
const LanCarrier = require('../../modules/Protocol/LanCarrier');
const {randomIdentity} = require('../crypto/helpers');

/**
 * @param {function} check returns truthy when done
 * @param {string} what for the error
 * @param {number} [timeout] ms
 */
async function waitFor(check, what, timeout = 30000) {
    const end = Date.now() + timeout;
    while (!await check()) {
        if (Date.now() > end) {
            throw new Error('Timed out waiting for ' + what);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

/**
 * @param {Array} carriers carriers for one peer
 * @return {Promise<Object>} {messenger, received, address}
 */
async function peer(carriers) {
    const identity = randomIdentity();
    const messenger = new Messenger({identity, carriers, retryMs: 1000});
    const received = [];
    messenger.onMessage((m) => received.push(m.body.text));
    await messenger.start();
    return {messenger, received, address: identity.address};
}

/**
 * Chat both ways and check everything arrives once
 * @param {Object} alice a peer
 * @param {Object} bob a peer
 */
async function chat(alice, bob) {
    for (let i = 0; i < 5; i++) {
        await alice.messenger.send(bob.address, 'chat', {text: 'a' + i});
    }
    await waitFor(() => bob.received.length === 5, 'alice\'s messages');
    for (let i = 0; i < 5; i++) {
        await bob.messenger.send(alice.address, 'chat', {text: 'b' + i});
    }
    await waitFor(() => alice.received.length === 5 &&
        alice.messenger.outbox.size === 0 &&
        bob.messenger.outbox.size === 0, 'bob\'s messages and receipts');
    assert.deepEqual(bob.received.sort(), ['a0', 'a1', 'a2', 'a3', 'a4']);
    assert.deepEqual(alice.received.sort(), ['b0', 'b1', 'b2', 'b3', 'b4']);
}

test('Over the LAN carrier', async (t) => {
    const aliceLan = new LanCarrier({port: 0, peers: []});
    const alice = await peer([aliceLan]);
    const bobLan = new LanCarrier({port: 0,
        peers: ['127.0.0.1:' + aliceLan.port]});
    const bob = await peer([bobLan]);
    t.after(() => Promise.all([alice.messenger.stop(),
        bob.messenger.stop()]));
    await waitFor(() => bobLan.peers.size === 1, 'discovery');
    await chat(alice, bob);

    // GET / says nothing about who is here (finding T2)
    const info = await new Promise((resolve) => http.get(
        `http://127.0.0.1:${aliceLan.port}/`, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        }));
    assert.deepEqual(info, {application: 'hexhoot', protocol: 2});
});

test('Over a Hyperswarm testnet', async (t) => {
    const testnet = await createTestnet(3);
    const aliceDht = new DhtCarrier({bootstrap: testnet.bootstrap});
    const bobDht = new DhtCarrier({bootstrap: testnet.bootstrap});
    const alice = await peer([aliceDht]);
    const bob = await peer([bobDht]);
    // Swarms leave before the testnet goes, or they wait for it
    t.after(async () => {
        await Promise.all([alice.messenger.stop(), bob.messenger.stop()]);
        await testnet.destroy();
    });
    await Promise.all([aliceDht.announced, bobDht.announced]);
    await chat(alice, bob);
});

test('Over both at once, with duplicates dropped', async (t) => {
    const testnet = await createTestnet(3);
    const aliceLan = new LanCarrier({port: 0, peers: []});
    const aliceDht = new DhtCarrier({bootstrap: testnet.bootstrap});
    const alice = await peer([aliceDht, aliceLan]);
    const bobLan = new LanCarrier({port: 0,
        peers: ['127.0.0.1:' + aliceLan.port]});
    const bobDht = new DhtCarrier({bootstrap: testnet.bootstrap});
    const bob = await peer([bobDht, bobLan]);
    // Swarms leave before the testnet goes, or they wait for it
    t.after(async () => {
        await Promise.all([alice.messenger.stop(), bob.messenger.stop()]);
        await testnet.destroy();
    });
    await Promise.all([aliceDht.announced, bobDht.announced]);
    await waitFor(() => bobLan.peers.size === 1, 'LAN discovery');
    await chat(alice, bob);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(bob.received.length, 5);
    assert.equal(alice.received.length, 5);
});
