/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L2 tests: two Cores befriend and chat over the real carriers, the LAN
// carrier on 127.0.0.1 and Hyperswarm on a private testnet.

const test = require('node:test');
const createTestnet = require('hyperdht/testnet');
const DhtCarrier = require('../../modules/Protocol/DhtCarrier');
const LanCarrier = require('../../modules/Protocol/LanCarrier');
const {parseFaults, withFaults} = require('../../modules/Protocol/faults');
const {signedIn, befriendAndChat, waitFor} = require('./helpers');

/**
 * @param {Array} carriers carriers to hand out
 * @return {Object} a network-like object for makeCore
 */
function fixed(carriers) {
    return {carrier: () => carriers.shift()};
}

test('Two Cores befriend and chat over the LAN carrier', async (t) => {
    const aliceLan = new LanCarrier({port: 0, peers: []});
    const alice = await signedIn('Alice Liddell', {t,
        network: fixed([aliceLan])});
    const bobLan = new LanCarrier({port: 0,
        peers: ['127.0.0.1:' + aliceLan.port]});
    const bob = await signedIn('Bobby Tables', {t,
        network: fixed([bobLan])});
    await waitFor(() => aliceLan.peers.size === 1 && bobLan.peers.size === 1,
        'LAN discovery');
    await befriendAndChat(alice, bob);
});

test('Over a LAN that loses, repeats and reorders frames', async (t) => {
    const faults = parseFaults('drop:0.1,dup:0.05,reorder:0.1,delay:0-200');
    const aliceLan = new LanCarrier({port: 0, peers: []});
    const alice = await signedIn('Alice Liddell', {t, retryMs: 1000,
        network: fixed([withFaults(aliceLan, faults)])});
    const bobLan = new LanCarrier({port: 0,
        peers: ['127.0.0.1:' + aliceLan.port]});
    const bob = await signedIn('Bobby Tables', {t, retryMs: 1000,
        network: fixed([withFaults(bobLan, faults)])});
    await waitFor(() => aliceLan.peers.size === 1 && bobLan.peers.size === 1,
        'LAN discovery');
    await befriendAndChat(alice, bob);
});

test('Two Cores befriend and chat over a DHT testnet', async (t) => {
    const testnet = await createTestnet(3);
    const options = {bootstrap: testnet.bootstrap};
    const aliceDht = new DhtCarrier(options);
    const bobDht = new DhtCarrier(options);
    const alice = await signedIn('Alice Liddell', {network: fixed([aliceDht])});
    const bob = await signedIn('Bobby Tables', {network: fixed([bobDht])});
    t.after(async () => {
        await Promise.all([alice.stop(), bob.stop()]);
        await testnet.destroy();
    });
    await Promise.all([aliceDht.announced, bobDht.announced]);
    await befriendAndChat(alice, bob);
});
