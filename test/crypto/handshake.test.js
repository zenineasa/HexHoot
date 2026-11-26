/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L1 tests of the hybrid KEM and the SIGMA-I handshake
// (docs/design/session-and-ratchet.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {randomIdentity} = require('./helpers');
const hk = require('../../modules/Crypto/hybridKem');
const {Initiator, Responder, resolveSimultaneous, sizes} =
    require('../../modules/Crypto/handshake');
const {encodeParts} = require('../../modules/Crypto/primitives');

const alice = randomIdentity();
const bob = randomIdentity();
const mallory = randomIdentity();

/**
 * Run a handshake, optionally changing messages on the way
 * @param {Object} [options]
 * @param {Identity} [options.initiator] alice by default
 * @param {Identity} [options.responder] bob by default
 * @param {string} [options.expected] address dialled; bob's by default
 * @param {function} [options.authorize] the responder's check
 * @param {Object} [options.tamper] {m1, m2, m3}: functions that return a
 * changed copy of the message
 * @return {Promise<Object>} {a, b, m1, m2, m3}: both sessions
 */
async function run(options = {}) {
    const tamper = options.tamper || {};
    const same = (m) => m;
    const initiator = new Initiator({identity: options.initiator || alice,
        expected: options.expected || bob.address});
    const responder = new Responder({identity: options.responder || bob,
        authorize: options.authorize});
    const m1 = (tamper.m1 || same)(initiator.start());
    const m2 = (tamper.m2 || same)(responder.handleM1(m1));
    const {message, session: a} = initiator.handleM2(m2);
    const m3 = (tamper.m3 || same)(message);
    const b = await responder.handleM3(m3);
    return {a, b, m1, m2, m3, initiator, responder};
}

/**
 * @param {number} offset byte to change
 * @return {function} returns a copy of a message with one bit flipped
 */
function flip(offset) {
    return (message) => {
        const copy = Buffer.from(message);
        copy[offset] ^= 1;
        return copy;
    };
}

test('HK: both sides get the same 64-byte secret', () => {
    const keyPair = new hk.HybridKeyPair();
    assert.equal(keyPair.publicKey.length, 1701);
    const {ciphertext, sharedSecret} = hk.encapsulate(keyPair.publicKey);
    assert.equal(ciphertext.length, 1701);
    assert.equal(sharedSecret.length, 64);
    assert.deepEqual(keyPair.decapsulate(ciphertext), sharedSecret);
    assert.notDeepEqual(hk.encapsulate(keyPair.publicKey).sharedSecret,
        sharedSecret);
});

test('HK: a changed ciphertext gives a different secret or an error', () => {
    const keyPair = new hk.HybridKeyPair();
    const {ciphertext, sharedSecret} = hk.encapsulate(keyPair.publicKey);
    // The ML-KEM half: implicit rejection, so a different secret
    for (const offset of [133, 900, 1700]) {
        assert.notDeepEqual(keyPair.decapsulate(flip(offset)(ciphertext)),
            sharedSecret);
    }
    // The P-521 half: almost always off the curve
    assert.throws(() => keyPair.decapsulate(flip(50)(ciphertext)),
        {code: 'BAD_KEY'});
    assert.throws(() => keyPair.decapsulate(ciphertext.subarray(1)),
        {code: 'BAD_KEY'});
    keyPair.destroy();
    assert.throws(() => keyPair.decapsulate(ciphertext), {code: 'BAD_STATE'});
});

test('HK: invalid public keys are rejected before use', () => {
    const good = new hk.HybridKeyPair().publicKey;
    const offCurve = Buffer.from(good);
    offCurve.fill(7, 1, 133);
    const badKem = Buffer.from(good);
    badKem.fill(0xff, 133); // coefficients out of range (FIPS 203 check)
    for (const key of [offCurve, badKem, good.subarray(1),
        Buffer.concat([Buffer.from([2]), good.subarray(1)])]) {
        assert.throws(() => hk.encapsulate(key), {code: 'BAD_KEY'});
    }
});

test('HK: the combiner matches an independent WebCrypto HKDF', async () => {
    const parts = [32, 66, 133, 133, 1568, 1568]
        .map((n) => crypto.randomBytes(n));
    const subtle = crypto.webcrypto.subtle;
    const expected = Buffer.from(await subtle.deriveBits({name: 'HKDF',
        hash: 'SHA-512', salt: Buffer.alloc(64),
        info: Buffer.from('hexhoot/v2/hk')}, await subtle.importKey('raw',
        encodeParts(...parts), 'HKDF', false, ['deriveBits']), 512));
    assert.deepEqual(hk.combine(...parts), expected);
});

test('Handshake: both sides agree and know who they talk to', async () => {
    const {a, b, m1, m2, m3, initiator, responder} = await run();
    assert.deepEqual([m1.length, m2.length, m3.length],
        [sizes.m1Bytes, sizes.m2Bytes, sizes.m3Bytes]);
    assert.deepEqual(a.rootKey, b.rootKey);
    assert.equal(a.rootKey.length, 64);
    assert.deepEqual(a.sessionAd, b.sessionAd);
    assert.equal(a.peer.address, bob.address);
    assert.equal(b.peer.address, alice.address);
    assert.equal(a.role, 'initiator');
    assert.equal(b.role, 'responder');
    // bob's ephemeral key from M2 seeds the ratchet
    assert.deepEqual(a.theirRatchetKey, b.ourRatchetKeyPair.publicKey);
    // Handshake-only secrets are gone
    assert.equal(initiator.keyPair.kemPrivate, null);
    assert.equal(responder.keys, null);

    const again = await run();
    assert.notDeepEqual(again.a.rootKey, a.rootKey);
    assert.notDeepEqual(again.a.sessionAd, a.sessionAd);
});

test('Handshake: identities are never sent in the clear', async () => {
    const {m1, m2, m3} = await run();
    for (const [message, who] of [[m1, alice], [m1, bob], [m2, bob],
        [m3, alice]]) {
        assert.ok(!message.includes(who.fingerprint));
        assert.ok(!message.includes(who.public.ikEc));
        assert.ok(!message.includes(who.public.ikPq.subarray(0, 64)));
        assert.ok(!message.includes(Buffer.from(who.address)));
    }
});

test('Handshake: the initiator only accepts the address it dialled',
    async () => {
        // mallory answers a call meant for bob
        await assert.rejects(run({responder: mallory}),
            {code: 'FINGERPRINT_MISMATCH'});
        // dialling mallory's address reaches mallory, and only her
        const {a} = await run({responder: mallory,
            expected: mallory.address});
        assert.equal(a.peer.address, mallory.address);
    });

test('Handshake: the responder decides once it knows the initiator',
    async () => {
        const seen = [];
        await assert.rejects(run({authorize: (peer) => {
            seen.push(peer.address);
            return false;
        }}), {code: 'UNAUTHORIZED'});
        assert.deepEqual(seen, [alice.address]);
        await assert.rejects(run({authorize: async () => false}),
            {code: 'UNAUTHORIZED'});
        // A handshake with ourselves is refused
        await assert.rejects(run({initiator: bob}),
            {code: 'HANDSHAKE_FAILED'});
    });

test('Handshake: any changed byte is rejected', async () => {
    const rejected = ['BAD_MESSAGE', 'UNSUPPORTED_VERSION', 'BAD_KEY',
        'HANDSHAKE_FAILED'];
    // One offset in every field of every message
    const offsets = {
        m1: [0, 1, 2, 40, 300, 1734],
        m2: [0, 1, 50, 500, 1750, 2500, 3440, 9000, 15778],
        m3: [0, 5, 7000, 12344],
    };
    for (const [name, list] of Object.entries(offsets)) {
        for (const offset of list) {
            await assert.rejects(run({tamper: {[name]: flip(offset)}}),
                (err) => rejected.includes(err.code),
                `${name} byte ${offset}`);
        }
    }
    await assert.rejects(run({tamper: {m1: (m) => m.subarray(0, 100)}}),
        {code: 'BAD_MESSAGE'});
    await assert.rejects(run({tamper: {m1: (m) => {
        const copy = Buffer.from(m);
        copy[1] = 3;
        return copy;
    }}}), {code: 'UNSUPPORTED_VERSION'});
});

test('Handshake: messages cannot be replayed into another run',
    async () => {
        const first = await run();
        // An old M3 against a fresh answer to the same M1
        const responder = new Responder({identity: bob});
        responder.handleM1(first.m1);
        await assert.rejects(responder.handleM3(first.m3),
            {code: 'HANDSHAKE_FAILED'});
        // An old M2 against a fresh M1
        const initiator = new Initiator({identity: alice,
            expected: bob.address});
        initiator.start();
        assert.throws(() => initiator.handleM2(first.m2),
            {code: 'HANDSHAKE_FAILED'});
    });

test('Handshake: steps run once, in order', async () => {
    const initiator = new Initiator({identity: alice,
        expected: bob.address});
    const responder = new Responder({identity: bob});
    await assert.rejects(responder.handleM3(Buffer.alloc(sizes.m3Bytes)),
        {code: 'BAD_STATE'});
    const m1 = initiator.start();
    assert.throws(() => initiator.start(), {code: 'BAD_STATE'});
    const m2 = responder.handleM1(m1);
    assert.throws(() => responder.handleM1(m1), {code: 'BAD_STATE'});
    initiator.handleM2(m2);
    assert.throws(() => initiator.handleM2(m2), {code: 'BAD_STATE'});

    // A failed step ends the handshake
    const failing = new Initiator({identity: alice, expected: bob.address});
    failing.start();
    assert.throws(() => failing.handleM2(flip(9000)(m2)));
    assert.throws(() => failing.handleM2(m2), {code: 'BAD_STATE'});
});

test('Handshake: simultaneous starts end in one session', async () => {
    const aliceInit = new Initiator({identity: alice,
        expected: bob.address});
    const bobInit = new Initiator({identity: bob, expected: alice.address});
    const fromAlice = aliceInit.start();
    const fromBob = bobInit.start();
    const sid = (m1) => m1.subarray(2, 34);

    // Each side compares its own sid with the one in the M1 it received
    const aliceChoice = resolveSimultaneous(sid(fromAlice), sid(fromBob));
    const bobChoice = resolveSimultaneous(sid(fromBob), sid(fromAlice));
    assert.notEqual(aliceChoice, bobChoice);

    const [winner, loserIdentity, winnerM1] = aliceChoice === 'ours' ?
        [aliceInit, bob, fromAlice] : [bobInit, alice, fromBob];
    const responder = new Responder({identity: loserIdentity});
    const {message, session} = winner.handleM2(responder.handleM1(winnerM1));
    const other = await responder.handleM3(message);
    assert.deepEqual(session.rootKey, other.rootKey);
});
