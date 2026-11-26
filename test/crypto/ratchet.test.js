/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L1 tests of the Double Ratchet with ML-KEM turns
// (docs/design/session-and-ratchet.md, "Properties to prove").

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {Identity} = require('../../modules/Crypto/Identity');
const {Initiator, Responder} = require('../../modules/Crypto/handshake');
const {Ratchet, sizes, internals} = require('../../modules/Crypto/Ratchet');
const RecordCipher = require('../../modules/Crypto/RecordCipher');

const aliceId = Identity.generate();
const bobId = Identity.generate();

/**
 * A fresh session between alice and bob
 * @param {Object} [options] ratchet options
 * @return {Promise<Object>} {alice, bob}: two Ratchets
 */
async function pair(options) {
    const initiator = new Initiator({identity: aliceId,
        expected: bobId.address});
    const responder = new Responder({identity: bobId});
    const m2 = responder.handleM1(initiator.start());
    const {message, session} = initiator.handleM2(m2);
    return {
        alice: Ratchet.fromHandshake(session, options),
        bob: Ratchet.fromHandshake(await responder.handleM3(message),
            options),
    };
}

const text = (buffer) => buffer.toString('utf8');

/**
 * @param {Ratchet} ratchet a ratchet
 * @return {Ratchet} an independent copy, as an attacker who stole the
 * stored state would have
 */
function steal(ratchet) {
    return Ratchet.deserialize(JSON.parse(JSON.stringify(
        ratchet.serialize())));
}

/**
 * A small seeded random generator, so failures can be reproduced
 * @param {number} seed seed
 * @return {function} () => number in [0, 1)
 */
function seeded(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 2 ** 32;
    };
}

test('Messages flow both ways, and the responder waits for the first',
    async () => {
        const {alice, bob} = await pair();
        assert.equal(bob.canSend, false);
        assert.throws(() => bob.encrypt('too early'), {code: 'NOT_READY'});
        const first = alice.encrypt('hello bob');
        assert.equal(first.length, sizes.headerBytes + 9 + sizes.tagBytes);
        assert.equal(text(bob.decrypt(first)), 'hello bob');
        assert.equal(bob.canSend, true);
        assert.equal(text(alice.decrypt(bob.encrypt('hello alice ✓'))),
            'hello alice ✓');
        for (let i = 0; i < 5; i++) {
            assert.equal(text(bob.decrypt(alice.encrypt('a' + i))), 'a' + i);
            assert.equal(text(bob.decrypt(alice.encrypt('b' + i))), 'b' + i);
            assert.equal(text(alice.decrypt(bob.encrypt('c' + i))), 'c' + i);
        }
        assert.equal(text(bob.decrypt(alice.encrypt(''))), '');
        assert.equal(bob.peer.address, aliceId.address);
        assert.equal(alice.peer.address, bobId.address);
    });

test('Every turn uses fresh P-521 and ML-KEM keys', async () => {
    const {alice, bob} = await pair();
    const turnKeys = new Set();
    for (let i = 0; i < 4; i++) {
        const fromAlice = alice.encrypt('x');
        turnKeys.add(fromAlice.subarray(1, 1 + 1701).toString('hex'));
        bob.decrypt(fromAlice);
        const fromBob = bob.encrypt('y');
        turnKeys.add(fromBob.subarray(1, 1 + 1701).toString('hex'));
        alice.decrypt(fromBob);
    }
    assert.equal(turnKeys.size, 8);
    // Within one chain the turn keys stay the same
    const a = alice.encrypt('1');
    const b = alice.encrypt('2');
    assert.deepEqual(a.subarray(1, 1 + 3269), b.subarray(1, 1 + 3269));
});

test('The root key needs both the P-521 and the ML-KEM secret', () => {
    const rk = crypto.randomBytes(64);
    const dhOut = crypto.randomBytes(66);
    const ssK = crypto.randomBytes(32);
    const base = internals.kdfRk(rk, dhOut, ssK);
    const otherDh = internals.kdfRk(rk, crypto.randomBytes(66), ssK);
    const otherKem = internals.kdfRk(rk, dhOut, crypto.randomBytes(32));
    assert.notDeepEqual(otherDh.rk, base.rk);
    assert.notDeepEqual(otherKem.rk, base.rk);
    assert.notDeepEqual(otherDh.ck, base.ck);
    assert.notDeepEqual(otherKem.ck, base.ck);
});

test('Out-of-order and lost messages, across turns', async () => {
    const {alice, bob} = await pair();
    const a = ['a0', 'a1', 'a2', 'a3'].map((m) => [m, alice.encrypt(m)]);
    // bob gets a2 first, then a0; a1 and a3 are late
    assert.equal(text(bob.decrypt(a[2][1])), 'a2');
    assert.equal(text(bob.decrypt(a[0][1])), 'a0');
    // A new turn from bob, and another from alice
    alice.decrypt(bob.encrypt('b0'));
    const a4 = alice.encrypt('a4');
    assert.equal(text(bob.decrypt(a4)), 'a4');
    // The late ones from the old chain still open, once each
    assert.equal(text(bob.decrypt(a[3][1])), 'a3');
    assert.equal(text(bob.decrypt(a[1][1])), 'a1');
    assert.throws(() => bob.decrypt(a[1][1]), {code: 'DECRYPT_FAILED'});
});

test('Replays are rejected', async () => {
    const {alice, bob} = await pair();
    const m0 = alice.encrypt('m0');
    const m1 = alice.encrypt('m1');
    bob.decrypt(m0);
    bob.decrypt(m1);
    assert.throws(() => bob.decrypt(m0), {code: 'DECRYPT_FAILED'});
    assert.throws(() => bob.decrypt(m1), {code: 'DECRYPT_FAILED'});
    // An old chain's message after the turn moved on
    alice.decrypt(bob.encrypt('b'));
    bob.decrypt(alice.encrypt('m2'));
    assert.throws(() => bob.decrypt(m0), {code: 'DECRYPT_FAILED'});
    // Still in sync afterwards
    assert.equal(text(bob.decrypt(alice.encrypt('ok'))), 'ok');
});

test('A forged or corrupted message changes nothing', async () => {
    const {alice, bob} = await pair();
    bob.decrypt(alice.encrypt('start'));
    alice.decrypt(bob.encrypt('turn')); // alice's next message is a new turn
    const genuine = alice.encrypt('genuine');
    const regions = {version: 0, dh: 50, kemPub: 900, kemCt: 2500,
        pn: 3272, n: 3276, body: 3280, tag: genuine.length - 1};
    for (const [name, offset] of Object.entries(regions)) {
        const bad = Buffer.from(genuine);
        bad[offset] ^= 1;
        assert.throws(() => bob.decrypt(bad), (err) => ['DECRYPT_FAILED',
            'BAD_KEY', 'UNSUPPORTED_VERSION', 'TOO_MANY_SKIPPED']
            .includes(err.code), name);
    }
    // An invalid ML-KEM key in a new turn is refused before it is stored
    const badKem = Buffer.from(genuine);
    badKem.fill(0xff, 134, 134 + 1568);
    assert.throws(() => bob.decrypt(badKem));
    assert.throws(() => bob.decrypt(genuine.subarray(0, 100)),
        {code: 'BAD_MESSAGE'});
    // Random garbage of the right length
    assert.throws(() => bob.decrypt(Buffer.concat([Buffer.from([1]),
        crypto.randomBytes(genuine.length - 1)])));

    assert.equal(text(bob.decrypt(genuine)), 'genuine');
    assert.equal(text(alice.decrypt(bob.encrypt('reply'))), 'reply');
});

test('Too many missing messages are refused', async () => {
    const {alice, bob} = await pair({maxSkip: 5});
    const messages = Array.from({length: 8}, (_, i) => alice.encrypt('' + i));
    assert.throws(() => bob.decrypt(messages[7]),
        {code: 'TOO_MANY_SKIPPED'});
    assert.equal(text(bob.decrypt(messages[5])), '5');
    assert.equal(text(bob.decrypt(messages[7])), '7');
    assert.equal(text(bob.decrypt(messages[0])), '0');
});

test('Skipped keys expire after 7 days', async () => {
    let now = 0;
    const {alice, bob} = await pair({now: () => now});
    const late = alice.encrypt('late');
    bob.decrypt(alice.encrypt('on time'));
    now = 8 * 24 * 3600 * 1000;
    assert.throws(() => bob.decrypt(late), {code: 'DECRYPT_FAILED'});
    assert.equal(bob.skipped.size, 0);
});

test('Forward secrecy: a stolen state cannot read earlier messages',
    async () => {
        const {alice, bob} = await pair();
        const old = alice.encrypt('before the theft');
        bob.decrypt(old);
        alice.decrypt(bob.encrypt('reply'));
        bob.decrypt(alice.encrypt('more'));
        const stolen = steal(bob);
        assert.throws(() => stolen.decrypt(old), {code: 'DECRYPT_FAILED'});
    });

test('Healing: a stolen state stops working once alice starts a new turn',
    async () => {
        const {alice, bob} = await pair();
        bob.decrypt(alice.encrypt('hello'));
        alice.decrypt(bob.encrypt('hi'));

        const stolen = steal(alice);
        // Until alice makes new keys, the thief reads along: bob's current
        // chain, alice's current chain, and bob's next turn (which goes to
        // keys alice made before the theft)
        const exposed = bob.encrypt('exposed');
        assert.equal(text(stolen.decrypt(exposed)), 'exposed');
        alice.decrypt(exposed);
        bob.decrypt(alice.encrypt('still exposed'));
        const answer = bob.encrypt('answer');
        assert.equal(text(stolen.decrypt(answer)), 'answer');

        // Receiving bob's turn makes alice create fresh P-521 and ML-KEM
        // keys, which the thief does not have
        assert.equal(text(alice.decrypt(answer)), 'answer');
        const healed = alice.encrypt('healed');
        assert.throws(() => stolen.decrypt(healed),
            {code: 'DECRYPT_FAILED'});
        assert.equal(text(bob.decrypt(healed)), 'healed');
        // bob's next turn goes to alice's fresh ML-KEM key
        const after = bob.encrypt('after');
        assert.throws(() => stolen.decrypt(after),
            {code: 'DECRYPT_FAILED'});
        assert.equal(text(alice.decrypt(after)), 'after');
    });

test('Sessions survive storage in the keyring\'s record cipher',
    async () => {
        const {alice, bob} = await pair();
        bob.decrypt(alice.encrypt('one'));
        const cipher = new RecordCipher(crypto.randomBytes(32));
        const save = (r) => cipher.encrypt('Sessions', 'bob',
            JSON.stringify(r.serialize()));
        const load = (blob) => Ratchet.deserialize(JSON.parse(text(
            cipher.decrypt('Sessions', 'bob', blob))));

        const pending = alice.encrypt('sent while bob was closed');
        const restored = load(save(bob));
        bob.destroy();
        assert.equal(text(restored.decrypt(pending)),
            'sent while bob was closed');
        assert.equal(restored.peer.address, aliceId.address);
        assert.equal(text(alice.decrypt(restored.encrypt('back'))), 'back');
        assert.throws(() => Ratchet.deserialize({version: 9}),
            {code: 'CORRUPT'});
    });

test('destroy() zeroes the keys', async () => {
    const {alice, bob} = await pair();
    bob.decrypt(alice.encrypt('x'));
    const keys = [bob.rk, bob.cks, bob.ckr];
    bob.destroy();
    for (const key of keys) {
        assert.ok(key.every((b) => b === 0));
    }
    assert.throws(() => bob.encrypt('x'), {code: 'NOT_READY'});
});

test('A long random conversation with reordering and loss', async () => {
    const random = seeded(20261126);
    const {alice, bob} = await pair();
    const peers = {alice, bob};
    const inFlight = {alice: [], bob: []}; // messages on their way to …
    const delivered = new Set();
    let sent = 0;
    let lost = 0;
    // bob cannot send until alice's first message arrives
    inFlight.bob.push(['m-first', alice.encrypt('m-first')]);
    sent++;
    for (let step = 0; step < 400; step++) {
        const from = random() < 0.5 ? 'alice' : 'bob';
        const to = from === 'alice' ? 'bob' : 'alice';
        if (random() < 0.5 && peers[from].canSend) {
            const body = `m${step}`;
            inFlight[to].push([body, peers[from].encrypt(body)]);
            sent++;
        } else if (inFlight[to].length > 0) {
            // Deliver a random one of the pending messages
            const index = Math.floor(random() * inFlight[to].length);
            const [body, message] = inFlight[to].splice(index, 1)[0];
            if (random() < 0.05) {
                lost++;
                continue;
            }
            assert.equal(text(peers[to].decrypt(message)), body);
            assert.ok(!delivered.has(body));
            delivered.add(body);
        }
    }
    for (const to of ['alice', 'bob']) {
        for (const [body, message] of inFlight[to]) {
            assert.equal(text(peers[to].decrypt(message)), body);
            delivered.add(body);
        }
    }
    assert.equal(delivered.size + lost, sent);
    assert.ok(sent > 100 && lost > 0);
});
