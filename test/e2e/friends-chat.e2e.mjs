/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L3: alice and bob, each a separate app with its own profile, exchange a
// friend request and chat through the UI. Once over a private DHT testnet
// and once over the LAN carrier on 127.0.0.1.

import {describe} from 'node:test';
import assert from 'node:assert/strict';
import {useNetwork} from './orchestrator.mjs';

for (const transport of ['dht', 'lan']) {
    describe(`alice and bob over ${transport}`, () => {
        const network = useNetwork({transport, peers: ['alice', 'bob']});

        network.test('Both create accounts and can be reached',
            async ({alice, bob}) => {
                await alice.login('Alice Liddell');
                await bob.login('Bobby Tables');
                assert.notEqual(alice.key, bob.key);
                await Promise.all([alice.waitForTransports(),
                    bob.waitForTransports()]);
            });

        network.test('alice adds bob; bob sees a request and accepts',
            async ({alice, bob}) => {
                await alice.addFriend(bob.key);
                await bob.acceptFriendRequest(alice.key);
                // bob's acceptance carries his profile to alice
                await alice.waitForFriend(bob.key, 'Bobby Tables');
                await bob.waitForFriend(alice.key, 'Alice Liddell');
            });

        network.test('They chat both ways', async ({alice, bob}) => {
            await alice.openChat(bob.key);
            await bob.openChat(alice.key);

            await alice.send('Hello Bobby');
            await bob.waitForMessage('Hello Bobby');
            await bob.send('Hi Alice <b>!</b>');
            await alice.waitForMessage('Hi Alice <b>!</b>');

            const conversation = [
                {type: 'sent', text: 'Hello Bobby'},
                {type: 'received', text: 'Hi Alice <b>!</b>'},
            ];
            assert.deepEqual(await alice.messages(), conversation);
            assert.deepEqual(await bob.messages(), conversation.map((m) =>
                ({...m, type: m.type === 'sent' ? 'received' : 'sent'})));

            // Core stored the same conversation
            const stored = (await bob.core('getAllMessages', alice.key))
                .map((m) => [m.message.type, m.message.message]);
            assert.deepEqual(stored, [['received', 'Hello Bobby'],
                ['sent', 'Hi Alice <b>!</b>']]);
        });

        network.test('No errors were logged', ({alice, bob}) => {
            assert.deepEqual(alice.errors, []);
            assert.deepEqual(bob.errors, []);
            assert.deepEqual([...alice.dialogs, ...bob.dialogs], []);
        });
    });
}

// mallory's display name is an XSS payload; bob sees it as plain text in the
// friend request, the friends list, the chat header and the profile (S1)
const XSS_NAME = '<img src=x onerror="window.__hexhootPwned=true">';

describe('A hostile display name stays text (S1)', () => {
    const network = useNetwork({transport: 'lan', peers: ['bob', 'mallory']});

    network.test('mallory\'s friend request and profile render as text',
        async ({bob, mallory}) => {
            await bob.login('Bobby Tables');
            await mallory.login(XSS_NAME);
            await Promise.all([bob.waitForTransports(),
                mallory.waitForTransports()]);
            await mallory.addFriend(bob.key);

            assert.deepEqual(await bob.waitForKnock(mallory.key),
                {name: XSS_NAME, images: 0});
            await bob.click(`.cell[data-key="${mallory.key}"]`);
            await bob.waitFor(`document.querySelector('#request .name')`);
            assert.equal(await bob.evaluate(`document.querySelector(
                '#request .name').textContent`), `${XSS_NAME} is knocking`);

            await bob.acceptFriendRequest(mallory.key);
            await bob.waitForFriend(mallory.key, XSS_NAME);
            await bob.openChat(mallory.key);
            assert.equal(await bob.evaluate(`document.querySelector(
                '#chainHeader .name').textContent`), XSS_NAME);
            await bob.openContact();
            assert.equal(await bob.evaluate(`document.querySelector(
                '#contact .who .name').textContent`), XSS_NAME);
            // Both sides see the same safety number
            const number = await bob.evaluate(`document.querySelector(
                '[data-testid="safety-number"]').dataset.value`);
            assert.match(number, /^(\d{5} ){15}\d{5}$/);
            assert.equal(number, await mallory.core('getSafetyNumber',
                bob.key));
            // Shown in 16 groups of five digits
            assert.equal(await bob.evaluate(`document.querySelectorAll(
                '[data-testid="safety-number"] span').length`), 16);
            // bob marks the numbers as compared; Core keeps it
            await bob.verify();
            assert.equal((await bob.core('getUserInfo', mallory.key))
                .verified, true);
            assert.equal(await bob.evaluate('window.__hexhootPwned'),
                undefined);
        });

    network.test('No errors were logged', ({bob, mallory}) => {
        assert.deepEqual(bob.errors, []);
        assert.deepEqual(mallory.errors, []);
    });
});
