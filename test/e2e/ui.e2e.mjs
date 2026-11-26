/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Single-app UI scenarios against the real app. Core runs with no
// transports, so nothing touches the network.

import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launchApp} from './driver.mjs';

const XSS_NAME = '<img src=x onerror="window.__hexhootPwned=true">';

let app;

/**
 * Wait until the app has shown more than 'count' dialogs
 * @param {number} count dialogs seen before
 */
async function waitForDialog(count) {
    for (let i = 0; i < 100 && app.dialogs.length <= count; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(app.dialogs.length, count + 1, 'Expected a dialog');
}

before(async () => {
    app = await launchApp({name: 'ui', env: {HEXHOOT_TRANSPORTS: 'none'}});
});

after(async () => {
    await app?.close();
});

test('The renderer is locked down', async () => {
    await app.waitFor(`document.getElementById('loginButton')`);
    assert.deepEqual(await app.evaluate(`({
        require: typeof require,
        process: typeof process,
        module: typeof module,
        bridge: Object.keys(window.hexhoot).join(),
        core: Object.keys(window.hexhoot.core).sort().join(),
        origin: location.origin,
    })`), {
        require: 'undefined',
        process: 'undefined',
        module: 'undefined',
        bridge: 'core',
        core: 'call,onEvent',
        origin: 'app://hexhoot',
    });
    // The CSP blocks string code and inline handlers. (Code sent through
    // DevTools is exempt from CSP, so this runs it from timers in the page.)
    assert.deepEqual(await app.evaluate(`new Promise((resolve) => {
        setTimeout('window.__stringTimer = 1', 0);
        const button = document.createElement('button');
        button.setAttribute('onclick', 'window.__inlineHandler = 1');
        document.body.append(button);
        button.click();
        button.remove();
        setTimeout(() => resolve({
            stringTimer: window.__stringTimer ?? null,
            inlineHandler: window.__inlineHandler ?? null,
        }), 200);
    })`), {stringTimer: null, inlineHandler: null});
    app.errors.length = 0; // the blocked attempts are logged as errors
    // Only the listed Core methods are reachable
    await assert.rejects(app.core('messageReceivedCallback', {}),
        /Unknown method/);
    await assert.rejects(app.core('constructor'), /Unknown method/);
});

test('The login screen, social links and copyright are shown', async () => {
    await app.waitFor(`document.getElementById('loginButton')`);
    assert.deepEqual(await app.evaluate(`({
        logos: document.querySelectorAll('#logoWithText svg').length,
        logoText: document.querySelector('#logoWithText').innerText
            .includes('HexHoot'),
        inputs: document.querySelectorAll('#login input').length,
        buttons: document.querySelectorAll('#login button').length,
        copyright: document.getElementById('copyright').textContent
            .includes('Copyright'),
        languages: document.querySelectorAll('#languages option').length > 1,
    })`), {
        logos: 1, logoText: true, inputs: 2, buttons: 2, copyright: true,
        languages: true,
    });

    // Each social icon links to the page its image names
    const icons = await app.evaluate(`[...document.querySelectorAll(
        '#social img')].map((img) => [img.src, img.dataset.href])`);
    assert.ok(icons.length > 1);
    for (const [src, href] of icons) {
        const name = src.split('/').pop().split('.')[0].toLowerCase();
        assert.ok(name === 'blogger' ? href === 'https://blog.hexhoot.com' :
            href.includes(name), `${name} -> ${href}`);
    }
});

test('A short password is rejected', async () => {
    await app.type('[name=displayName]', 'ZatMan');
    await app.type('[name=password]', 'short');
    await app.click('#loginButton');
    await waitForDialog(0);
    assert.equal(await app.core('getPublicKeyOfLoggedInUser'), undefined);
});

test('Logging in shows the chat screen', async () => {
    await app.type('[name=displayName]', 'ZatMan');
    await app.type('[name=password]', 'ThisIsProbablyAGoodPassword');
    await app.click('#loginButton');
    await app.waitFor(`document.getElementById('friendsList')`);
    assert.deepEqual(await app.evaluate(`({
        layout: ['iconbar', 'sidebar', 'mainContent', 'messageSenderInfo',
            'messageReader'].every((id) => document.getElementById(id)),
        logo: document.querySelectorAll('#sidebar #logoWithText svg').length,
        textarea: document.querySelectorAll('#messageComposer textarea')
            .length,
        send: document.querySelectorAll('#messageComposer .send').length,
    })`), {layout: true, logo: 1, textarea: 1, send: 1});
    const user = await app.core('getLoggedInUserInfoPublic');
    assert.equal(user.displayName, 'ZatMan');
    assert.match(user.key, /^[0-9a-f]{64}$/);
});

test('Add friend: tabs, invalid key, back', async () => {
    await app.click('#addFriendButton');
    await app.waitFor(`document.getElementById('theirPublicKey')`);
    assert.deepEqual(await app.evaluate(`(() => {
        const tabs = document.querySelectorAll('.tab');
        const contents = document.querySelectorAll('.tabContent');
        return {
            tabs: tabs.length,
            contents: contents.length,
            hidden: [...contents].every((c) =>
                getComputedStyle(c).display === 'none'),
            myKey: document.querySelector('[name=myPublicKey]').value
                .length,
        };
    })()`), {tabs: 2, contents: 2, hidden: true, myKey: 64});

    await app.type('#theirPublicKey', 'not a key');
    const dialogs = app.dialogs.length;
    await app.click('#mainContent #addFriendButton');
    await waitForDialog(dialogs);

    await app.click('#backButton');
    await app.waitFor(`document.getElementById('friendsList')`);
});

test('A malicious display name renders as text (S1)', async () => {
    const evil = 'ab'.repeat(32);
    await app.core('updateFriendInformation', {key: evil,
        displayName: XSS_NAME, photo: 'x);background:url(https://evil/'});
    await app.evaluate(`window.reload()`);
    const li = `document.getElementById('sidebar_li_${evil}')`;
    await app.waitFor(li);
    assert.equal(await app.evaluate(`${li}.querySelector('.name')
        .textContent`), XSS_NAME);
    assert.equal(await app.evaluate(`${li}.getElementsByTagName('img')
        .length`), 0);
    assert.ok(!await app.evaluate(`${li}.querySelector('.photo').style
        .backgroundImage.includes('evil')`));

    // Opening the chat and the profile must not create elements either
    await app.click(`#sidebar_li_${evil}`);
    await app.waitFor(`document.querySelector('#messageSenderInfo .name')`);
    await app.click('#messageSenderInfo');
    await app.waitFor(`document.querySelector('#viewProfile')`);
    assert.equal(await app.evaluate(`document.querySelector(
        '#viewProfile [name=displayName]').value`), XSS_NAME);
    await app.click('#backButton');
    await app.waitFor(`document.getElementById('friendsList')`);
    assert.equal(await app.evaluate(`window.__hexhootPwned`), undefined);
});

test('Editing the profile keeps the key (S4)', async () => {
    const before = await app.core('getPublicKeyOfLoggedInUser');
    await app.click('#ownProfilePic');
    await app.waitFor(`document.getElementById('editProfile')`);
    await app.type('#editProfile [name=about]', 'Hello <b>there</b>');
    await app.click('#editButton');
    await app.waitFor(`document.getElementById('friendsList')`);
    assert.equal(await app.core('getPublicKeyOfLoggedInUser'), before);
    assert.equal((await app.core('getLoggedInUserInfoPublic')).about,
        'Hello <b>there</b>');
});

test('Changing the language re-renders the UI', async () => {
    const english = await app.evaluate(
        `document.getElementById('addFriendButton').textContent.trim()`);
    await app.evaluate(`(() => {
        const select = document.getElementById('languages');
        select.value = 'de';
        select.dispatchEvent(new Event('change'));
    })()`);
    await app.waitFor(`document.getElementById('addFriendButton')
        .textContent.trim() !== ${JSON.stringify(english)}`);
    assert.equal((await app.core('getPreference', 'language')).value, 'de');
});

test('No errors were logged', () => {
    assert.deepEqual(app.errors, []);
});
