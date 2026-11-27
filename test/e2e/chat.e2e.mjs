/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L3: alice and bob send 50 messages each way, interleaved, over the DHT,
// over the LAN with lost, duplicated, delayed and reordered frames, and
// over both transports at once. Every message arrives exactly once, and
// every one is marked delivered.

import {describe} from 'node:test';
import assert from 'node:assert/strict';
import {useNetwork, befriend} from './orchestrator.mjs';

const COUNT = 50;
const FAULTS = 'drop:0.1,dup:0.05,reorder:0.1,delay:0-200';

const setups = [
    {transport: 'dht', label: 'over the DHT'},
    {transport: 'lan', label: 'over a faulty LAN',
        env: {HEXHOOT_TEST_FAULTS: FAULTS, HEXHOOT_TEST_RETRY_MS: '1000'}},
    {transport: 'dht,lan', label: 'over the DHT and the LAN at once'},
];

/**
 * @param {Array} list texts
 * @param {string} prefix 'a' or 'b'
 * @return {Array} the texts that start with prefix
 */
const only = (list, prefix) => list.filter((text) => text.startsWith(prefix));
const expected = (prefix) => Array.from({length: COUNT}, (_, i) =>
    `${prefix}${i}`);

for (const setup of setups) {
    describe(`50 messages each way ${setup.label}`, () => {
        const network = useNetwork({transport: setup.transport,
            env: setup.env, peers: ['alice', 'bob']});

        network.test('alice and bob become friends', async ({alice, bob}) => {
            await alice.login('Alice Liddell');
            await bob.login('Bobby Tables');
            await Promise.all([alice.waitForTransports(),
                bob.waitForTransports()]);
            await befriend(alice, bob, 'Alice Liddell', 'Bobby Tables');
        });

        network.test('Interleaved messages arrive once each, all delivered',
            async ({alice, bob}) => {
                await alice.openChat(bob.key);
                await bob.openChat(alice.key);
                for (let i = 0; i < COUNT; i++) {
                    await alice.send(`a${i}`);
                    await bob.send(`b${i}`);
                }
                const shown = (app) => app.evaluate(`document
                    .querySelectorAll('#chainBody .msg').length`);
                for (const app of [alice, bob]) {
                    await app.waitFor(`document.querySelectorAll(
                        '#chainBody .msg').length >= ${2 * COUNT}`,
                    120000);
                }
                await new Promise((resolve) => setTimeout(resolve, 1000));
                assert.equal(await shown(alice), 2 * COUNT);
                assert.equal(await shown(bob), 2 * COUNT);

                for (const [app, mine, theirs] of [[alice, 'a', 'b'],
                    [bob, 'b', 'a']]) {
                    const messages = await app.messages();
                    const sent = messages.filter((m) => m.type === 'sent')
                        .map((m) => m.text);
                    const received = messages.filter((m) =>
                        m.type === 'received').map((m) => m.text);
                    // Our own appear as we sent them
                    assert.deepEqual(sent, expected(mine));
                    assert.deepEqual(only(received, theirs), received);
                    if (setup.env?.HEXHOOT_TEST_FAULTS) {
                        // Reordered frames may be shown in arrival order
                        assert.deepEqual([...received].sort(),
                            expected(theirs).sort());
                    } else {
                        assert.deepEqual(received, expected(theirs));
                    }
                }

                // Core agrees, and receipts came back for everything
                for (const [app, other] of [[alice, bob], [bob, alice]]) {
                    await app.waitFor(`window.hexhoot.core.call(
                        'getAllMessages', [${JSON.stringify(other.key)}])
                        .then((all) => all.length === ${2 * COUNT} &&
                            all.filter((m) => m.message.type === 'sent')
                                .every((m) => m.message.delivered))`, 60000);
                }
            });

        network.test('No errors were logged', ({alice, bob}) => {
            assert.deepEqual(alice.errors, []);
            assert.deepEqual(bob.errors, []);
            assert.deepEqual([...alice.dialogs, ...bob.dialogs], []);
        });
    });
}
