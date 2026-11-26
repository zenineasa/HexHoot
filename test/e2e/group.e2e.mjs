/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L3: three people, three conversations at the same time. Over the LAN the
// first frames go to every instance, so this also checks that nobody gets
// or shows what was meant for someone else.

import {describe} from 'node:test';
import assert from 'node:assert/strict';
import {useNetwork, befriend} from './orchestrator.mjs';

const names = {alice: 'Alice Liddell', bob: 'Bobby Tables',
    carol: 'Carol Singer'};

for (const transport of ['lan', 'dht']) {
    describe(`alice, bob and carol over ${transport}`, () => {
        const network = useNetwork({transport,
            peers: ['alice', 'bob', 'carol']});

        network.test('Everyone befriends everyone', async (peers) => {
            const {alice, bob, carol} = peers;
            await Promise.all(Object.entries(names).map(([peer, name]) =>
                peers[peer].login(name)));
            await Promise.all([alice, bob, carol].map((app) =>
                app.waitForTransports()));
            // Three requests in flight at once
            await Promise.all([
                befriend(alice, bob, names.alice, names.bob),
                befriend(bob, carol, names.bob, names.carol),
                befriend(carol, alice, names.carol, names.alice),
            ]);
        });

        network.test('Three conversations at once, no cross-talk',
            async (peers) => {
                const order = ['alice', 'bob', 'carol'];
                // Each talks to the next one, all at the same time
                await Promise.all(order.map(async (name, i) => {
                    const me = peers[name];
                    const next = peers[order[(i + 1) % 3]];
                    await me.openChat(next.key);
                    for (let n = 0; n < 5; n++) {
                        await me.send(`${name}->${order[(i + 1) % 3]} ${n}`);
                    }
                }));
                for (const [i, name] of order.entries()) {
                    const me = peers[name];
                    const nextName = order[(i + 1) % 3];
                    const prevName = order[(i + 2) % 3];
                    const texts = async (other) => (await me.core(
                        'getAllMessages', peers[other].key))
                        .map((m) => m.message.message).sort();
                    const want = (from, to) => [0, 1, 2, 3, 4].map((n) =>
                        `${from}->${to} ${n}`);
                    await me.waitFor(`window.hexhoot.core.call(
                        'getAllMessages', [${JSON.stringify(
        peers[prevName].key)}]).then((all) => all.length === 5)`, 60000);
                    assert.deepEqual(await texts(nextName),
                        want(name, nextName));
                    assert.deepEqual(await texts(prevName),
                        want(prevName, name));
                }
                // The open chats show only their own conversation
                for (const [i, name] of order.entries()) {
                    const to = order[(i + 1) % 3];
                    assert.deepEqual((await peers[name].messages())
                        .map((m) => m.text), [0, 1, 2, 3, 4].map((n) =>
                        `${name}->${to} ${n}`));
                }
            });

        network.test('No errors were logged', (peers) => {
            for (const app of Object.values(peers)) {
                assert.deepEqual(app.errors, [], app.name);
                assert.deepEqual(app.dialogs, [], app.name);
            }
        });
    });
}
