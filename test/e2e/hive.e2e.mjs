/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Two apps over the LAN carrier, through the Hive UI (docs/design/ui-hive.md):
// long, emoji-only and link messages, the "N new" button, the length
// counter, "Don't send", unread marks, Core restarting, and blocking.

import {describe} from 'node:test';
import assert from 'node:assert/strict';
import {useNetwork, befriend} from './orchestrator.mjs';

const LONG = Array.from({length: 40}, (_, i) => `line ${i + 1}`).join('\n');
const LINK_MESSAGE = 'See https://example.com/path?q=1. Thanks';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('The Hive between alice and bob', () => {
    const network = useNetwork({transport: 'lan', peers: ['alice', 'bob']});
    const q = (selector) =>
        `document.querySelector(${JSON.stringify(selector)})`;

    network.test('They become friends and open the chat', async ({alice,
        bob}) => {
        await alice.login('Alice Liddell');
        await bob.login('Bobby Tables');
        await Promise.all([alice.waitForTransports(),
            bob.waitForTransports()]);
        await befriend(alice, bob, 'Alice Liddell', 'Bobby Tables');
        await alice.openChat(bob.key);
        await bob.openChat(alice.key);
    });

    network.test('Long messages fold, emoji show large, links ask first',
        async ({alice, bob}) => {
            await alice.send(LONG);
            await alice.send('🎉🦉');
            await alice.send(LINK_MESSAGE);
            await bob.waitForMessage(LINK_MESSAGE);
            assert.deepEqual(await bob.evaluate(`({
                long: document.querySelectorAll('#chainBody .bubble.long')
                    .length,
                emoji: document.querySelector('#chainBody .bubble.emoji')
                    ?.textContent.trim(),
                url: document.querySelector('#chainBody .text .link')
                    ?.dataset.url,
            })`), {long: 1, emoji: '🎉🦉', url: 'https://example.com/path?q=1'});
            // The whole text is still the message
            assert.equal((await bob.messages()).at(-1).text, LINK_MESSAGE);
            await bob.click('#chainBody .bubble.long .more');
            assert.equal(await bob.evaluate(`${q('#chainBody .bubble.long')}
                .classList.contains('open')`), true);
            // A link shows where it goes and opens nothing by itself
            await bob.click('#chainBody .text .link');
            await bob.waitFor(q('#linkDialog'));
            assert.equal(await bob.evaluate(
                `${q('#linkDialog .url')}.textContent`),
            'https://example.com/path?q=1');
            assert.match(await bob.evaluate(
                `${q('#linkDialog h2')}.textContent`), /example\.com/);
            await bob.click('#linkDialog [name=cancel]');
            await bob.waitFor(`!${q('#linkDialog')}`);
        });

    network.test('Reading further up, "1 new" points down', async ({alice,
        bob}) => {
        await bob.resize(1000, 480);
        await bob.evaluate(`(() => {
            const body = document.getElementById('chainBody');
            body.scrollTop = 0;
            body.dispatchEvent(new Event('scroll'));
        })()`);
        await alice.send('ping');
        await bob.waitFor(`!${q('#newBelow')}.hidden`);
        assert.match(await bob.evaluate(`${q('#newBelow')}.textContent`),
            /^1 /);
        await bob.click('#newBelow');
        await bob.waitFor(`${q('#newBelow')}.hidden`);
        await bob.resize(1280, 800);
    });

    network.test('Near the length limit, a counter appears', async ({
        alice}) => {
        const count = () => alice.evaluate(`({
            hidden: ${q('#composer .count')}.hidden,
            text: ${q('#composer .count')}.textContent})`);
        await alice.type('#composerInput', 'x'.repeat(100));
        assert.equal((await count()).hidden, true);
        await alice.type('#composerInput', 'x'.repeat(64000));
        assert.deepEqual(await count(), {hidden: false,
            text: '1,536 characters left'});
        await alice.type('#composerInput', '');
    });

    network.test('"Don\'t send" takes back a message that is waiting',
        async ({alice, bob}) => {
            await bob.restart(async () => {
                await alice.send('never mind');
                const row = '#chainBody .msg.sent[data-delivered=false]';
                await alice.waitFor(q(row + ' .cancel'));
                await alice.click(row + ' .cancel');
                await alice.waitFor(`!${q(row)}`);
                assert.ok(!(await alice.core('getConversation', bob.key))
                    .some((m) => m.text === 'never mind'));
            });
            await bob.ready();
            await bob.waitForTransports();
            await bob.openChat(alice.key);
            await alice.send('this one goes');
            await bob.waitForMessage('this one goes', 60000);
            assert.ok(!(await bob.messages()).some((m) =>
                m.text === 'never mind'));
        });

    network.test('A message for a closed chat marks the cell and Latest',
        async ({alice, bob}) => {
            await alice.press('Escape');
            await alice.waitFor(`document.getElementById('home')`);
            await bob.send('are you there?');
            const cell = `.cell[data-key="${bob.key}"]`;
            await alice.waitFor(`${q(cell)}?.parentElement
                .querySelector('.badge')`, 30000);
            assert.equal(await alice.evaluate(`${q(
                `.now[data-key="${bob.key}"] .who`)}.classList
                .contains('unread')`), true);
            await alice.openChat(bob.key);
            await alice.waitFor(`!${q(cell)}.parentElement
                .querySelector('.badge')`);
        });

    network.test('If Core stops, it restarts: a banner, the draft kept',
        async ({alice, bob}, t) => {
            if (process.platform === 'win32') {
                t.skip('killCore needs ps');
                return;
            }
            await alice.type('#composerInput', 'half a thought');
            assert.equal(alice.killCore(), true);
            await alice.waitFor(`${q('#banner')}?.dataset.kind ===
                'restarted' && !${q('#banner')}.hidden`, 30000);
            // Back in the same chat, with the draft
            await alice.waitFor(`${q('#chain')}?.dataset.chat ===
                ${JSON.stringify(bob.key)}`);
            await alice.waitForTransports();
            assert.equal(await alice.evaluate(
                `${q('#composerInput')}.value`), 'half a thought');
            await alice.type('#composerInput', '');
            await alice.send('back again');
            await bob.waitForMessage('back again', 60000);
            assert.deepEqual(alice.errors, []);
        });

    network.test('Blocking removes them and stops their messages; unblock',
        async ({alice, bob}) => {
            await alice.openChat(bob.key);
            await alice.openContact();
            await alice.click('#contact [name=block]');
            await alice.click('#contact .confirm [name=confirm]');
            await alice.waitFor(`document.getElementById('home') &&
                !${q(`.cell[data-key="${bob.key}"]`)}`);
            assert.deepEqual((await alice.core('getBlocked')).map((b) =>
                b.address), [bob.key]);
            // bob still thinks they are friends; nothing gets through
            await bob.send('let me in');
            await pause(1500);
            assert.deepEqual(await alice.core('getConversation', bob.key),
                []);
            // Settings lists them, and unblocks
            await alice.press(',', {ctrlKey: true});
            await alice.click('.nav[data-section=blocked]');
            await alice.waitFor(q(`#settings-blocked [data-key="${bob.key}"]`));
            await alice.click(`#settings-blocked [data-key="${bob.key}"] ` +
                '[name=unblock]');
            await alice.waitFor(`!${q(`#settings-blocked [data-key=` +
                `"${bob.key}"]`)}`);
            assert.deepEqual(await alice.core('getBlocked'), []);
        });

    network.test('No errors were logged', ({alice, bob}) => {
        assert.deepEqual(alice.errors, []);
        assert.deepEqual(bob.errors, []);
        assert.deepEqual([...alice.dialogs, ...bob.dialogs], []);
    });
});
