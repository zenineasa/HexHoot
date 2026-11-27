/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L3: restarts. bob closes mid-conversation, alice's messages wait in her
// outbox, and bob gets them when he is back. Sessions, contacts and the
// "verified" mark survive restarts on both sides.

import {describe} from 'node:test';
import assert from 'node:assert/strict';
import {useNetwork, befriend} from './orchestrator.mjs';

/**
 * @param {Object} app an app handle
 * @param {string} key the contact
 * @return {Array} [type, text, delivered] from Core
 */
async function stored(app, key) {
    return (await app.core('getAllMessages', key)).map((m) =>
        [m.message.type, m.message.message, m.message.delivered]);
}

describe('Restarts over the LAN', () => {
    const network = useNetwork({transport: 'lan', peers: ['alice', 'bob']});

    network.test('alice and bob are friends and chat', async ({alice, bob}) => {
        await alice.login('Alice Liddell');
        await bob.login('Bobby Tables');
        await Promise.all([alice.waitForTransports(),
            bob.waitForTransports()]);
        await befriend(alice, bob, 'Alice Liddell', 'Bobby Tables');
        await alice.openChat(bob.key);
        await bob.openChat(alice.key);
        await alice.send('before');
        await bob.waitForMessage('before');
    });

    network.test('bob marks alice verified', async ({bob, alice}) => {
        await bob.openContact();
        await bob.verify();
        await bob.press('Escape');
        await bob.waitFor(`document.getElementById('contactPanel').hidden`);
    });

    network.test('Messages sent while bob is away reach him when he is back',
        async ({alice, bob}) => {
            await bob.restart(async () => {
                for (const text of ['while', 'you', 'were', 'out']) {
                    await alice.send(text);
                }
                await new Promise((resolve) => setTimeout(resolve, 1000));
                // Nothing delivered yet
                assert.deepEqual((await stored(alice, bob.key)).slice(1)
                    .map(([, , delivered]) => delivered),
                [false, false, false, false]);
            });
            // The OS keyring signs bob in (or, without one, his password)
            await bob.ready();
            await bob.waitForTransports();
            await bob.openChat(alice.key);
            await bob.waitForMessage('out', 60000);
            assert.deepEqual((await bob.messages()).map((m) => m.text),
                ['before', 'while', 'you', 'were', 'out']);
            await alice.waitFor(`window.hexhoot.core.call('getAllMessages',
                [${JSON.stringify(bob.key)}]).then((all) =>
                    all.every((m) => m.message.delivered))`, 30000);
            // The mark survived, and shows in the chat header
            assert.equal(await bob.evaluate(`document.querySelector(
                '#chainHeader .verified')?.textContent`), '✓');
        });

    network.test('Both restart; the conversation goes on', async ({alice,
        bob}) => {
        await alice.restart();
        await bob.restart();
        for (const app of [alice, bob]) {
            await app.ready();
            await app.waitForTransports();
        }
        await alice.openChat(bob.key);
        await bob.openChat(alice.key);
        await bob.send('still here');
        await alice.waitForMessage('still here', 60000);
        await alice.send('me too');
        await bob.waitForMessage('me too', 60000);
        assert.equal((await stored(bob, alice.key)).length, 7);
    });

    network.test('No errors were logged', ({alice, bob}) => {
        assert.deepEqual(alice.errors, []);
        assert.deepEqual(bob.errors, []);
        assert.deepEqual([...alice.dialogs, ...bob.dialogs], []);
    });
});
