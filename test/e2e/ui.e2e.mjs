/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Single-app UI scenarios against the real app (docs/design/ui-hive.md).
// Core runs with no transports, so nothing touches the network.

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
// A valid address that is nobody in this test (test/crypto/identity.test.js)
const STRANGER = 'hh21plj59s5zh6nwax5gvxmt3wv90ft2hq6k2g65whjef9xmw5m45' +
    'vkqyrc0n9';
const texts = JSON.parse(fs.readFileSync(new URL(
    '../../modules/I18n/lang.json', import.meta.url)));
const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`;

/**
 * Press a key on the focused element
 * @param {string} key the key
 * @param {Object} [modifiers] {ctrlKey, metaKey, shiftKey}
 */
async function press(key, modifiers = {}) {
    await app.evaluate(`(document.activeElement || document.body)
        .dispatchEvent(new KeyboardEvent('keydown', Object.assign(
            {key: ${JSON.stringify(key)}, bubbles: true},
            ${JSON.stringify(modifiers)})))`);
}

/**
 * The visible text of an element
 * @param {string} selector CSS selector
 * @return {string} its text, trimmed
 */
const text = (selector) => app.evaluate(`${q(selector)}?.textContent.trim()`);

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

test('The welcome screen, with fonts from the app itself', async () => {
    assert.deepEqual(await app.evaluate(`({
        logo: document.querySelectorAll('#logoWithText svg').length,
        name: document.querySelector('#logoWithText').innerText
            .includes('HexHoot'),
        inputs: document.querySelectorAll('#login input').length,
        start: document.getElementById('loginButton').disabled,
        restore: Boolean(document.getElementById('loginWithJSONButton')),
        languages: document.querySelectorAll('#languages option').length,
    })`), {logo: 1, name: true, inputs: 2, start: true, restore: true,
        languages: 5});
    // Every font and stylesheet is the app's own (nothing from Google)
    assert.deepEqual(await app.evaluate(`Promise.all([
        '600 16px "Space Grotesk"', '16px Inter', '500 12px "JetBrains Mono"',
        '700 16px "Noto Sans JP"', '16px "Noto Sans Malayalam"',
    ].map((font) => document.fonts.load(font, font.includes('Malayalam') ?
        'മലയാളം' : 'HexHoot').then((faces) => faces.length)))`),
    [1, 1, 1, 1, 1]);
    assert.deepEqual(await app.evaluate(`[...document.styleSheets]
        .map((sheet) => sheet.href).filter((href) =>
            !href.startsWith('app://hexhoot/'))`), []);
});

test('Password rules are checked as you type; Core\'s reason is shown',
    async () => {
        const rules = () => app.evaluate(`Object.fromEntries([
            ...document.querySelectorAll('#requirements li')].map((li) =>
            [li.dataset.rule, li.dataset.ok === 'true']))`);
        const disabled = () => app.evaluate(
            `document.getElementById('loginButton').disabled`);
        await app.type('[name=displayName]', 'ZatMan');
        await app.type('[name=password]', 'only15 chars!!!');
        assert.deepEqual(await rules(), {name: true, length: false,
            notName: true});
        assert.equal(await disabled(), true);
        await app.type('[name=password]', 'zatman is my password');
        assert.deepEqual(await rules(), {name: true, length: true,
            notName: false});
        assert.equal(await disabled(), true);
        // Only Core knows this rule; the page says why, no dialog
        await app.type('[name=password]', 'abababababababababab');
        assert.equal(await disabled(), false);
        await app.click('#loginButton');
        await app.waitFor(`${q('#loginStatus')}.dataset.state === 'error'`);
        assert.equal(await text('#loginStatus'),
            texts.Login.passwordRepetitive.en);
        assert.equal(await app.core('getMyAddress'), undefined);
        assert.deepEqual(app.dialogs, []);
    });

test('Signing in shows the hive and Home', async () => {
    await app.type('[name=password]', PASSWORD);
    await app.click('#loginButton');
    await app.waitFor(`document.getElementById('home')`);
    const key = await app.core('getMyAddress');
    assert.match(key, /^hh21[0-9a-z]{58}$/);
    assert.deepEqual(await app.evaluate(`({
        route: document.getElementById('app').dataset.route,
        logo: document.querySelectorAll('#hive .hive-head svg.logo').length,
        cells: [...document.querySelectorAll('#hive .cell')]
            .map((cell) => cell.dataset.kind),
        me: document.querySelector('#me .me-name').textContent,
        address: document.querySelector('#home [data-testid=my-address]')
            .textContent.replace(/\\s+/g, ''),
        steps: document.querySelectorAll('#home .steps li').length,
    })`), {route: 'home', logo: 1, cells: ['add'], me: 'ZatMan',
        address: key, steps: 3});
});

test('Add a friend: checked as you type; knocking selects the waiting cell',
    async () => {
        const mine = await app.core('getMyAddress');
        const hint = () => app.evaluate(`({
            tone: ${q('#addFriendHint')}.dataset.tone,
            knock: !document.getElementById('knockButton').disabled})`);
        await app.click('#addFriendButton');
        await app.waitFor(`document.getElementById('theirPublicKey')`);
        await app.type('#theirPublicKey', 'xyz');
        assert.deepEqual(await hint(), {tone: 'warn', knock: false});
        await app.type('#theirPublicKey', mine.replace(/(.{4})/g, '$1 '));
        assert.deepEqual(await hint(), {tone: 'warn', knock: false});
        assert.equal(await text('#addFriendHint'),
            texts.AddFriend.ownAddress.en);
        // The right form but a typo: Core's checksum catches it
        const typo = STRANGER.slice(0, -1) +
            (STRANGER.endsWith('q') ? 'p' : 'q');
        await app.type('#theirPublicKey', typo);
        assert.deepEqual(await hint(), {tone: 'ok', knock: true});
        await app.click('#knockButton');
        await app.waitFor(`${q('#addFriendHint')}.textContent ===
            ${JSON.stringify(texts.AddFriend.typo.en)}`);

        await app.type('#theirPublicKey', STRANGER);
        await app.click('#knockButton');
        await app.waitFor(`!document.getElementById('addFriendDialog') &&
            ${q('#chain')}?.dataset.chat === ${JSON.stringify(STRANGER)}`);
        assert.deepEqual(await app.evaluate(`({
            cell: ${q(`.cell[data-key="${STRANGER}"]`)}.dataset.kind,
            current: ${q(`.cell[data-key="${STRANGER}"]`)}
                .getAttribute('aria-current'),
            composer: document.getElementById('composerInput').disabled,
            withdraw: Boolean(${q('#chainHeader [name=withdraw]')}),
        })`), {cell: 'waiting', current: 'true', composer: true,
            withdraw: true});
        // Adding them again says so, and offers to show them
        await app.click('#addFriendButton');
        await app.type('#theirPublicKey', STRANGER);
        assert.deepEqual(await hint(), {tone: '', knock: false});
        await app.click('#addFriendDialog [name=close]');
        await app.waitFor(`!document.getElementById('addFriendDialog')`);

        // Withdrawing ends at Home, with the cell gone
        await app.click('#chainHeader [name=withdraw]');
        await app.waitFor(`document.getElementById('home') &&
            !${q(`.cell[data-key="${STRANGER}"]`)}`);
        assert.equal(await app.core('getUserInfo', STRANGER), undefined);
    });

test('Keyboard: Ctrl+K, Ctrl+N, Ctrl+, and Esc one step back', async () => {
    await press('k', {ctrlKey: true});
    assert.equal(await app.evaluate(`document.activeElement.id`), 'find');
    await press('n', {ctrlKey: true});
    await app.waitFor(`document.getElementById('addFriendDialog')`);
    await app.click('#addFriendDialog [name=close]');
    await press(',', {ctrlKey: true});
    await app.waitFor(`!document.getElementById('settings').hidden`);
    assert.match(await text('#settingsBack'), /Home/);
    await press('Escape');
    await app.waitFor(`document.getElementById('settings').hidden &&
        document.getElementById('home')`);
});

test('The hive as a list', async () => {
    // Few cells: no switch, unless the list was chosen before
    assert.equal(await app.evaluate(`${q('#viewToggle')}.hidden`), true);
    await app.core('setPreference', 'hiveView', 'list');
    await app.evaluate('window.reload()');
    await app.waitFor(`${q('#hive .cells')}?.classList.contains('list')`);
    assert.equal(await app.evaluate(`${q('#viewToggle')}.hidden`), false);
    assert.equal(await app.evaluate(
        `${q('#hive .cell.line')}.dataset.kind`), 'add');
    await app.click('#viewToggle');
    await app.waitFor(`!${q('#hive .cells')}.classList.contains('list')`);
    await app.waitFor(`window.hexhoot.core.call('getPreference',
        ['hiveView']).then((p) => p.value === 'hive')`);
});

test('Editing the profile keeps the key (S4)', async () => {
    const before = await app.core('getMyAddress');
    await app.click('#me');
    await app.waitFor(`document.getElementById('editProfile')`);
    await app.type('#editProfile [name=about]', 'Hello <b>there</b>');
    await app.click('#saveProfile');
    await app.waitFor(`document.getElementById('toast')`);
    assert.equal(await app.core('getMyAddress'), before);
    assert.equal((await app.core('getLoggedInUserInfoPublic')).about,
        'Hello <b>there</b>');
});

test('Appearance: night, day, or the computer\'s choice', async () => {
    await app.click('.nav[data-section=appearance]');
    await app.waitFor(`document.getElementById('settings-appearance')`);
    assert.equal(await app.evaluate(
        `document.documentElement.dataset.theme`), 'night');
    await app.click('[name=theme][value=day]');
    await app.waitFor(`document.documentElement.dataset.theme === 'day'`);
    assert.equal((await app.core('getPreference', 'theme')).value, 'day');
    await app.click('[name=theme][value=night]');
    await app.waitFor(`document.documentElement.dataset.theme === 'night'`);
});

test('About lists the version, social links and copyright', async () => {
    await app.click('.nav[data-section=about]');
    await app.waitFor(`document.getElementById('settings-about')`);
    // Each social icon links to the page its image names
    const icons = await app.evaluate(`[...document.querySelectorAll(
        '#social .social')].map((button) => [button.querySelector('img')
        .src, button.dataset.href])`);
    assert.ok(icons.length > 1);
    for (const [src, href] of icons) {
        const name = src.split('/').pop().split('.')[0].toLowerCase();
        assert.ok(name === 'blogger' ? href === 'https://blog.hexhoot.com' :
            href.includes(name), `${name} -> ${href}`);
    }
    assert.match(await text('#copyright'), /Copyright/);
    assert.match(await text('#settings-about .line .muted'), /^\d+\.\d+/);
});

test('Changing the language redraws the window', async () => {
    await app.click('.nav[data-section=language]');
    await app.waitFor(`document.getElementById('settings-language')`);
    await app.evaluate(`(() => {
        const radio = document.querySelector('[name=lang][value=de]');
        radio.checked = true;
        radio.dispatchEvent(new Event('change'));
    })()`);
    // Settings stay open, in German
    await app.waitFor(`document.documentElement.lang === 'de' &&
        ${q('.settings-title')}?.textContent ===
        ${JSON.stringify(texts.Settings.title.de)}`);
    assert.equal((await app.core('getPreference', 'language')).value, 'de');
    await press('Escape');
    await app.waitFor(`document.getElementById('home')`);
});

test('A narrow window shows one place at a time', async () => {
    await app.resize(800, 600);
    const shown = () => app.evaluate(`({
        hive: getComputedStyle(document.getElementById('hive')).display,
        pane: getComputedStyle(document.getElementById('pane')).display,
    })`);
    assert.deepEqual(await shown(), {hive: 'flex', pane: 'none'});
    await app.click('#settingsButton');
    await app.waitFor(`!document.getElementById('settings').hidden`);
    await press('Escape');
    await app.waitFor(`document.getElementById('settings').hidden`);
    assert.deepEqual(await shown(), {hive: 'flex', pane: 'none'});
    await app.resize(1280, 800);
    assert.deepEqual(await shown(), {hive: 'flex', pane: 'flex'});
});

test('After a restart the OS keyring signs in by itself', async () => {
    const address = await app.core('getMyAddress');
    assert.deepEqual(app.errors, []);
    await app.close();
    app = await launch();
    await app.waitFor(`document.getElementById('hive')`);
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
    await app.waitFor(`document.getElementById('hive')`);
}

/**
 * Answer the password check card
 * @param {string} password what to type
 * @param {string} state the outcome expected: 'right' or 'wrong'
 * @return {string} the message shown
 */
async function answerPasswordCheck(password, state) {
    await app.type('#passwordCheck [name=password]', password);
    await app.click('#passwordCheck [name=check]');
    await app.waitFor(`document.querySelector('#passwordCheck')
        .dataset.state === ${JSON.stringify(state)}`);
    const shown = await text('#passwordCheck .text');
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

test('A due password check is a card that blocks nothing', async () => {
    await restartLater(4);
    await app.waitFor(`document.getElementById('passwordCheck')`);
    // The app still works around it
    await app.click('#settingsButton');
    await app.waitFor(`!document.getElementById('settings').hidden`);
    await app.click('#settingsBack');
    await app.waitFor(`document.getElementById('home')`);
    assert.ok(await app.evaluate(
        `document.getElementById('passwordCheck')`));
    // Language is German since the earlier test
    assert.equal(await answerPasswordCheck('not my password at all',
        'wrong'), texts.PasswordCheck.wrong.de);
    assert.equal(await app.evaluate(`document.documentElement.lang`), 'de');
});

test('A wrong answer asks again the next day; then it is right', async () => {
    await restartLater(5.5);
    await app.waitFor(`document.getElementById('passwordCheck')`);
    assert.equal(await answerPasswordCheck(PASSWORD, 'right'),
        texts.PasswordCheck.rightAfterMiss.de);
});

test('"Not now" puts the check off; Settings can start one', async () => {
    await restartLater(400);
    await app.waitFor(`document.getElementById('passwordCheck')`);
    await app.click('#passwordCheck [name=later]');
    await app.waitFor(`!document.getElementById('passwordCheck')`);
    assert.equal((await app.core('getPasswordCheck')).due, false);
    await press(',', {ctrlKey: true});
    await app.click('.nav[data-section=security]');
    await app.waitFor(`document.getElementById('settings-security')`);
    await app.click('[name=checkNow]');
    await app.waitFor(`document.getElementById('passwordCheck')`);
    assert.equal(await answerPasswordCheck(PASSWORD, 'right'),
        texts.PasswordCheck.right.de);
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
            await elsewhere.waitFor(`document.getElementById('hive')`);
            assert.equal(await elsewhere.core('getMyAddress'), address);
            assert.deepEqual(elsewhere.errors, []);
        } finally {
            await elsewhere.close();
        }
    });

test('No errors were logged', () => {
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.dialogs, []);
});
