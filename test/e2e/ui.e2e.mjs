/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Single-app UI scenarios against the real app. Core runs with no
// transports, so nothing touches the network.

import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {launchApp} from './driver.mjs';

let app;
// Kept across a restart of the app
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hexhoot-ui-'));
const launch = (days = 0) => launchApp({name: 'ui', userData,
    env: {HEXHOOT_TRANSPORTS: 'none',
        HEXHOOT_TEST_CLOCK_OFFSET_DAYS: String(days)}});
const PASSWORD = 'ThisIsProbablyAGoodPassword';
const texts = JSON.parse(fs.readFileSync(new URL(
    '../../modules/I18n/lang.json', import.meta.url)));

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
    app = await launch();
});

after(async () => {
    await app?.close();
    fs.rmSync(userData, {recursive: true, force: true});
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

test('Weak passwords are rejected, with the reason', async () => {
    await app.type('[name=displayName]', 'ZatMan');
    await app.type('[name=password]', 'only15 chars!!!');
    await app.click('#loginButton');
    await waitForDialog(0);
    assert.equal(await app.core('getMyAddress'), undefined);
    // Core gives the reason, and the UI shows it
    await app.type('[name=password]', 'zatman is my password');
    await app.click('#loginButton');
    await waitForDialog(1);
    assert.match(app.dialogs[1], /name/);
    assert.equal(await app.core('getMyAddress'), undefined);
});

test('Logging in shows the chat screen', async () => {
    await app.type('[name=displayName]', 'ZatMan');
    await app.type('[name=password]', PASSWORD);
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
    assert.match(user.key, /^hh21[0-9a-z]{58}$/);
});

test('Add friend: tabs, invalid key, back', async () => {
    await app.click('#addFriendButton');
    await app.waitFor(`document.getElementById('theirPublicKey')`);
    const tabs = `(() => {
        const shown = [...document.querySelectorAll('.tabContent')]
            .filter((c) => getComputedStyle(c).display !== 'none');
        return {
            tabs: document.querySelectorAll('.tab').length,
            shown: shown.map((c) => c.id),
            active: document.querySelector('.tab.active').getAttribute('name'),
            myKey: document.querySelector('[name=myPublicKey]').value
                .length,
        };
    })()`;
    // Adding someone is shown first
    assert.deepEqual(await app.evaluate(tabs), {tabs: 2,
        shown: ['theirCode'], active: 'theirCode', myKey: 62});
    await app.click('.tab[name=myCode]');
    assert.deepEqual(await app.evaluate(tabs), {tabs: 2,
        shown: ['myCode'], active: 'myCode', myKey: 62});

    await app.type('#theirPublicKey', 'not a key');
    const dialogs = app.dialogs.length;
    await app.click('#mainContent #addFriendButton');
    await waitForDialog(dialogs);

    await app.click('#backButton');
    await app.waitFor(`document.getElementById('friendsList')`);
});

test('Editing the profile keeps the key (S4)', async () => {
    const before = await app.core('getMyAddress');
    await app.click('#ownProfilePic');
    await app.waitFor(`document.getElementById('editProfile')`);
    await app.type('#editProfile [name=about]', 'Hello <b>there</b>');
    await app.click('#editButton');
    await app.waitFor(`document.getElementById('friendsList')`);
    assert.equal(await app.core('getMyAddress'), before);
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

test('After a restart the OS keyring signs in by itself', async () => {
    const address = await app.core('getMyAddress');
    assert.deepEqual(app.errors, []);
    await app.close();
    app = await launch();
    await app.waitFor(`document.getElementById('friendsList')`);
    assert.equal(await app.core('getMyAddress'), address);
    assert.equal((await app.core('getPreference', 'language')).value, 'de');
});

/**
 * Restart the app with Core's clock some days ahead
 * @param {number} days how far
 */
async function restartLater(days) {
    assert.deepEqual(app.errors, []);
    await app.close();
    app = await launch(days);
    await app.waitFor(`document.getElementById('friendsList')`);
}

/**
 * Answer the password check box
 * @param {string} password what to type
 * @param {string} state the outcome expected: 'right' or 'wrong'
 * @return {string} the message shown
 */
async function answerPasswordCheck(password, state) {
    await app.type('#passwordCheck [name=password]', password);
    await app.click('#passwordCheck [name=check]');
    await app.waitFor(`document.querySelector('#passwordCheck')
        .dataset.state === ${JSON.stringify(state)}`);
    const shown = await app.evaluate(`document.querySelector(
        '#passwordCheck .text').textContent`);
    await app.click('#passwordCheck [name=close]');
    await app.waitFor(`!document.getElementById('passwordCheck')`);
    assert.equal((await app.core('getPasswordCheck')).due, false);
    return shown;
}

test('No password check before it is due', async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(await app.evaluate(
        `document.getElementById('passwordCheck')`), null);
});

test('A due password check is a box that blocks nothing', async () => {
    await restartLater(4);
    await app.waitFor(`document.getElementById('passwordCheck')`);
    // The app still works around it
    await app.click('#addFriendButton');
    await app.waitFor(`document.getElementById('theirPublicKey')`);
    await app.click('#backButton');
    await app.waitFor(`document.getElementById('friendsList')`);
    assert.ok(await app.evaluate(
        `document.getElementById('passwordCheck')`));
    // Language is German since the earlier test
    assert.equal(await answerPasswordCheck('not my password at all',
        'wrong'), texts.PasswordCheck.wrong.de);
});

test('A wrong answer asks again the next day; then it is right', async () => {
    await restartLater(5.5);
    await app.waitFor(`document.getElementById('passwordCheck')`);
    assert.equal(await answerPasswordCheck(PASSWORD, 'right'),
        texts.PasswordCheck.rightAfterMiss.de);
});

test('"Not now" puts the check off', async () => {
    await restartLater(400);
    await app.waitFor(`document.getElementById('passwordCheck')`);
    await app.click('#passwordCheck [name=later]');
    await app.waitFor(`!document.getElementById('passwordCheck')`);
    assert.equal((await app.core('getPasswordCheck')).due, false);
});

test('The same name and password give the same address elsewhere',
    async () => {
        const address = await app.core('getMyAddress');
        // Another computer: a fresh profile
        const elsewhere = await launchApp({name: 'elsewhere',
            env: {HEXHOOT_TRANSPORTS: 'none'}});
        try {
            await elsewhere.waitFor(`document.getElementById('loginButton')`);
            await elsewhere.type('[name=displayName]', '  zatman ');
            await elsewhere.type('[name=password]', PASSWORD);
            await elsewhere.click('#loginButton');
            await elsewhere.waitFor(
                `document.getElementById('friendsList')`);
            assert.equal(await elsewhere.core('getMyAddress'), address);
            assert.deepEqual(elsewhere.errors, []);
        } finally {
            await elsewhere.close();
        }
    });

test('No errors were logged', () => {
    assert.deepEqual(app.errors, []);
});
