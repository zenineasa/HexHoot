/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L4: alice runs the real app with the UI open; "evil" is a headless peer
// (test/peers/evilPeer.js) that speaks protocol v2 and misbehaves: hostile
// profiles, spoofed fields, messages from a stranger, malformed bodies,
// unknown types, replayed and tampered envelopes, and malformed or
// oversized frames. Regression tests for S1-S3 and T2
// (docs/assessment/crypto-findings.md). After all of it alice still chats.

import {describe} from 'node:test';
import assert from 'node:assert/strict';
import {useNetwork} from './orchestrator.mjs';

const XSS = '<img src=x onerror="window.__hexhootPwned=true">';
const MAX_CHAT = 64 * 1024;
const MAX_FRAME = 1024 * 1024;

/**
 * Wait until evil's outbox is empty: alice acknowledged everything
 * @param {Object} evil the evil peer
 */
async function settled(evil) {
    for (let i = 0; i < 300 && !await evil.call('outboxEmpty'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(await evil.call('outboxEmpty'), 'evil\'s outbox drained');
}

describe('An adversarial peer (L4)', () => {
    const network = useNetwork({transport: 'lan', peers: ['alice'],
        evil: ['evil']});

    network.test('T2: the LAN port tells nothing about who is there',
        async ({alice, evil}) => {
            await alice.login('Alice Liddell');
            await alice.waitForTransports();
            const [home] = await evil.call('request', 'GET', '/');
            assert.deepEqual(JSON.parse(home.body),
                {application: 'hexhoot', protocol: 2});
            for (const [method, url] of [['GET', '/peers'],
                ['GET', '/channels'], ['POST', '/frame'],
                ['POST', '/hello']]) {
                // Without x-hexhoot-port, or not a route at all
                const [answer] = await evil.call('request', method, url);
                assert.equal(answer.status, 404, `${method} ${url}`);
                assert.equal(answer.body, '');
            }
        });

    network.test('S1, S3: a hostile request renders as text; a stranger ' +
        'cannot chat; nothing answers automatically',
    async ({alice, evil}) => {
        await evil.call('core', 'updateProfile', {displayName: XSS,
            about: '<script>window.__hexhootPwned=true</script>',
            photo: 'javascript:alert(1)'});
        await evil.call('core', 'addFriend', alice.key);
        assert.deepEqual(await alice.waitForKnock(evil.key),
            {name: XSS, images: 0});
        assert.equal(await alice.evaluate(
            `document.getElementsByTagName('script').length`), 1);
        assert.equal((await alice.core('getUserInfo', evil.key)).photo, '');

        // A chat from someone who is not a friend is dropped
        await evil.call('send', alice.key, 'chat', {text: 'buy now'});
        await settled(evil);
        assert.deepEqual(await alice.core('getAllMessages', evil.key), []);
        // alice has not answered anything (no automatic reply)
        assert.deepEqual(await evil.call('events'), []);
    });

    network.test('S2: a spoofed profile changes only its sender\'s name',
        async ({alice, evil}) => {
            await alice.acceptFriendRequest(evil.key);
            await alice.openChat(evil.key);
            await evil.call('send', alice.key, 'profile', {
                key: alice.key, displayName: 'Totally Alice',
                status: 'pending-in', verified: true, isRead: true,
                photo: 'javascript:alert(1)'});
            await alice.waitFor(`window.hexhoot.core.call('getUserInfo',
                [${JSON.stringify(evil.key)}]).then((c) =>
                    c.displayName === 'Totally Alice')`, 30000);
            const contact = await alice.core('getUserInfo', evil.key);
            assert.deepEqual([contact.key, contact.status, contact.verified,
                contact.photo], [evil.key, 'friend', undefined, '']);
            assert.equal((await alice.core('getLoggedInUserInfoPublic'))
                .displayName, 'Alice Liddell');
            assert.equal((await alice.core('getAllFriends')).length, 1);
        });

    network.test('Malformed bodies and unknown types are ignored',
        async ({alice, evil}) => {
            for (const [type, body] of [
                ['chat', {text: 'x'.repeat(MAX_CHAT + 1)}],
                ['chat', {text: 42}],
                ['chat', null],
                ['chat', ['not', 'an', 'object']],
                ['self_destruct', {now: true}],
                ['profile', 'just a string'],
            ]) {
                await evil.call('send', alice.key, type, body);
            }
            // alice refused those, so no receipts will come for them
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await evil.call('dropOutbox');
            await evil.call('send', alice.key, 'chat', {text: 'marker 1'});
            await alice.waitForMessage('marker 1');
            await settled(evil);
            assert.deepEqual(await alice.messages(),
                [{type: 'received', text: 'marker 1'}]);
        });

    network.test('Replayed and tampered envelopes change nothing',
        async ({alice, evil}) => {
            const sent = await evil.call('sent');
            const last = (kind) => sent.filter((e) => e.kind === kind).at(-1);
            const msg = last(4).index;
            const hs1 = last(1).index;
            for (let i = 0; i < 3; i++) {
                await evil.call('replay', msg);
            }
            await evil.call('replay', hs1);
            for (const offset of [1, 2, 20, 40, 100, -1, -20]) {
                await evil.call('tamper', msg, offset);
                await evil.call('tamper', hs1, offset);
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await evil.call('send', alice.key, 'chat', {text: 'marker 2'});
            await alice.waitForMessage('marker 2', 30000);
            await settled(evil);
            assert.deepEqual((await alice.messages()).map((m) => m.text),
                ['marker 1', 'marker 2']);
            assert.equal((await alice.core('getAllMessages', evil.key))
                .length, 2);
        });

    network.test('Malformed and oversized frames are dropped',
        async ({alice, evil}) => {
            const to = Buffer.alloc(32, 7);
            const frames = [
                Buffer.alloc(0),
                Buffer.from([2]),
                Buffer.from([2, 4]),
                Buffer.concat([Buffer.from([3, 4]), to, Buffer.alloc(100)]),
                Buffer.concat([Buffer.from([2, 99]), to, Buffer.alloc(100)]),
                Buffer.concat([Buffer.from([2, 4]), to,
                    Buffer.from('random body bytes')]),
                Buffer.concat([Buffer.from([2, 1]), to, Buffer.alloc(10)]),
                Buffer.from('{"type":"UserInformation","key":"x"}'),
            ];
            for (const frame of frames) {
                assert.deepEqual(await evil.call('raw',
                    frame.toString('base64')), [200]);
            }
            assert.deepEqual(await evil.call('oversized', MAX_FRAME + 1),
                [413]);
            await evil.call('send', alice.key, 'chat', {text: 'marker 3'});
            await alice.waitForMessage('marker 3', 30000);
            assert.deepEqual((await alice.messages()).map((m) => m.text),
                ['marker 1', 'marker 2', 'marker 3']);
        });

    network.test('alice is unharmed and still chats', async ({alice, evil}) => {
        await alice.send('still here');
        for (let i = 0; i < 300; i++) {
            if ((await evil.call('events')).some((e) =>
                e.message?.message?.message === 'still here')) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok((await evil.call('events')).some((e) =>
            e.message?.message?.message === 'still here'));
        assert.equal(await alice.evaluate('window.__hexhootPwned'),
            undefined);
        assert.deepEqual(alice.errors, []);
        assert.deepEqual(alice.dialogs, []);
    });
});
