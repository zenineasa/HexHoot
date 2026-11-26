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
