/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

// Regression test for finding S1 (docs/assessment/crypto-findings.md):
// peer-controlled profile data must never be rendered as HTML. The rest of
// the received-message checks run against Core in test/core/core.test.js.

const utils = require('./../../../test/utils');
const dbMessenger = require('./../../../modules/DBMessenger')();
const Chat = require('./../../../modules/Chat');

const XSS_NAME = '<img src=x onerror="window.__hexhootPwned=true">';

/**
 * Generate a random hex string that looks like a public key.
 * @return {string} hex key
 */
function randomKey() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

QUnit.test('A malicious display name renders as text', async function(assert) {
    const evil = randomKey();
    // Names are stored as given and escaped when rendered
    await dbMessenger.updateFriendInformation({
        key: evil,
        displayName: XSS_NAME,
        photo: 'x);background:url(https://evil.example/',
    });

    await utils.setFixtureWithContainerDOMElemenent();
    await new Chat().render();

    await utils.waitAndTryAgain(async function(assert) {
        const li = document.getElementById('sidebar_li_' + evil);
        assert.ok(li !== null, 'The friend should be listed.');
        assert.strictEqual(li.querySelector('.name').textContent, XSS_NAME,
            'The name must be shown literally.');
        assert.strictEqual(li.getElementsByTagName('img').length, 0,
            'No element may be created from the name.');
        assert.ok(!li.querySelector('.photo').style.backgroundImage
            .includes('evil.example'), 'Unsafe photos must not be used.');
    }, assert);

    // Give a potential onerror handler time to fire
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(window.__hexhootPwned, undefined,
        'Injected handlers must not run.');
});
