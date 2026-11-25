/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L2 tests: two Cores in one process exchange a friend request and chat over
// the real transports, the LAN carrier on 127.0.0.1 and Hyperswarm on a
// private DHT testnet (never the public DHT).

const test = require('node:test');
const createTestnet = require('hyperdht/testnet');
const DhtTransport = require('../../modules/Core/DhtTransport');
const LanTransport = require('../../modules/Core/LanTransport');
const {createCore, befriendAndChat, waitFor} = require('./helpers');

const quiet = function() {};

test('Two Cores befriend and chat over the LAN carrier', async () => {
    const aliceLan = new LanTransport({port: 0, peers: [], log: quiet});
    const alice = await createCore('alice', [aliceLan]);
    const bobLan = new LanTransport({
        port: 0, peers: ['127.0.0.1:' + aliceLan.port], log: quiet});
    const bob = await createCore('bob', [bobLan]);
    try {
        // The LAN carrier drops envelopes for peers it has not discovered
        await waitFor(() => Object.keys(aliceLan.peers).length === 1 &&
            Object.keys(bobLan.peers).length === 1, 'LAN discovery');
        await befriendAndChat(alice, bob);
    } finally {
        await alice.stop();
        await bob.stop();
    }
});

test('Two Cores befriend and chat over a DHT testnet', async () => {
    const testnet = await createTestnet(3);
    const options = {bootstrap: testnet.bootstrap, log: quiet};
    const aliceDht = new DhtTransport(options);
    const bobDht = new DhtTransport(options);
    const alice = await createCore('alice', [aliceDht]);
    const bob = await createCore('bob', [bobDht]);
    try {
        // Peers can only be found once their announce has completed
        await Promise.all([aliceDht.announced, bobDht.announced]);
        await befriendAndChat(alice, bob);
    } finally {
        await alice.stop();
        await bob.stop();
        await testnet.destroy();
    }
});
