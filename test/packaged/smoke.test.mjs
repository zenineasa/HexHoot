/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L5: smoke tests against the packaged app (npm run package, then
// npm run test:packaged). They check what only a real build can show: the
// fuses are set, only the app is shipped, the test hooks do nothing even
// when asked to, and the app logs in at the real scrypt cost.
//
// The packaged app uses the real carriers: it announces a throwaway test
// identity on the public DHT and looks for HexHoot on the local network.
// See docs/design/testing-infrastructure.md.

import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {launchApp} from '../e2e/driver.mjs';

const require = createRequire(import.meta.url);
const {getCurrentFuseWire, FuseV1Options, FuseState} =
    require('@electron/fuses');
const asar = require('@electron/asar');
const root = path.resolve(import.meta.dirname, '../..');

/**
 * Where `npm run package` put the app for this machine
 * @return {Object} {app (what fuses are read from), executable, asar}
 */
function packagedApp() {
    const dir = process.env.HEXHOOT_PACKAGED_DIR || path.join(root, 'out',
        'package', `HexHoot-${process.platform}-${process.arch}`);
    if (process.platform === 'darwin') {
        const app = path.join(dir, 'HexHoot.app');
        return {app, executable: path.join(app, 'Contents', 'MacOS',
            'hexhoot'), asar: path.join(app, 'Contents', 'Resources',
            'app.asar')};
    }
    const executable = path.join(dir, process.platform === 'win32' ?
        'hexhoot.exe' : 'hexhoot');
    return {app: executable, executable,
        asar: path.join(dir, 'resources', 'app.asar')};
}

const packaged = packagedApp();
// The known answer at the real cost (test/crypto/identity.test.js)
const NAME = 'Alice Liddell';
const PASSWORD = 'correct horse battery staple';
const ADDRESS = 'hh21plj59s5zh6nwax5gvxmt3wv90ft2hq6k2g65whjef9xmw5m45' +
    'vkqyrc0n9';
// Every test hook, set to something that would be obvious if it worked
const HOOKS = {
    HEXHOOT_TEST_SCRYPT_N: '16384',
    HEXHOOT_TRANSPORTS: 'none',
    HEXHOOT_TEST_FAULTS: 'drop:0.99',
    HEXHOOT_TEST_CLOCK_OFFSET_DAYS: '400',
    HEXHOOT_TEST_RETRY_MS: '100',
    HEXHOOT_LAN_PEERS: '127.0.0.1:1',
};
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hexhoot-l5-'));
const launch = () => launchApp({name: 'packaged', userData,
    executable: packaged.executable, env: HOOKS});
let app;

before(() => {
    assert.ok(fs.existsSync(packaged.executable),
        `No packaged app at ${packaged.executable}: run npm run package`);
});

after(async () => {
    await app?.close();
    fs.rmSync(userData, {recursive: true, force: true});
});

test('The fuses are set', async () => {
    const wire = await getCurrentFuseWire(packaged.app);
    const expected = {
        RunAsNode: FuseState.DISABLE,
        EnableCookieEncryption: FuseState.ENABLE,
        EnableNodeOptionsEnvironmentVariable: FuseState.DISABLE,
        EnableNodeCliInspectArguments: FuseState.DISABLE,
        EnableEmbeddedAsarIntegrityValidation: FuseState.ENABLE,
        OnlyLoadAppFromAsar: FuseState.ENABLE,
    };
    for (const [name, state] of Object.entries(expected)) {
        assert.equal(wire[FuseV1Options[name]], state, name);
    }
});

test('Only the app is shipped', () => {
    const files = asar.listPackage(packaged.asar, {isPack: false})
        .map((file) => file.replaceAll('\\', '/'));
    assert.ok(files.includes('/modules/Main/index.js'));
    assert.ok(files.includes('/modules/Crypto/Ratchet.js'));
    for (const banned of ['/test', '/test-results', '/docs', '/scripts',
        '/packaging', '/.github', '/out', '/eslint.config.js', '/makefile',
        '/package-lock.json']) {
        assert.ok(!files.some((file) => file === banned ||
            file.startsWith(banned + '/')), banned);
    }
});

test('Native modules carry only this platform\'s binaries', () => {
    const unpacked = packaged.asar + '.unpacked';
    const targets = new Set();
    for (const file of fs.readdirSync(unpacked, {recursive: true})) {
        const match = /prebuilds[\\/]([^\\/]+)$/.exec(file);
        if (match) {
            targets.add(match[1]);
        }
    }
    assert.ok(targets.size > 0, 'no prebuilds were found');
    const own = `${process.platform}-${process.arch}`;
    assert.deepEqual([...targets].filter((target) => target !== own &&
        target !== own + '-musl'), []);
});

test('Test hooks are inert: logging in costs the real scrypt', async () => {
    app = await launch();
    await app.waitFor(`document.getElementById('loginButton')`, 30000);
    await app.type('[name=displayName]', NAME);
    await app.type('[name=password]', PASSWORD);
    const started = Date.now();
    await app.click('#loginButton');
    // Seconds on a fast machine, minutes on one short of memory
    await app.waitFor(`document.getElementById('hive')`, 600000);
    // Only the real cost gives this address; a cheap scrypt would not
    assert.equal(await app.core('getMyAddress'), ADDRESS);
    assert.ok(Date.now() - started > 500);
    // No clock offset: the first password check is days away
    assert.equal((await app.core('getPasswordCheck')).due, false);
    // Both real carriers run, whatever HEXHOOT_TRANSPORTS says
    const transports = (await app.core('getTransportStatus'))
        .map((t) => t.name).sort();
    assert.deepEqual(transports, ['dht', 'lan']);
});

test('The renderer is locked down', async () => {
    assert.deepEqual(await app.evaluate(`({
        require: typeof require,
        process: typeof process,
        module: typeof module,
        bridge: Object.keys(window.hexhoot).join(),
        origin: location.origin,
    })`), {require: 'undefined', process: 'undefined', module: 'undefined',
        bridge: 'core', origin: 'app://hexhoot'});
});

test('A restart signs in again', async () => {
    assert.deepEqual(app.errors, []);
    await app.close();
    app = await launch();
    // Without a strong OS keyring (Linux CI) the password unlocks it
    await app.waitFor(`document.getElementById('hive') ||
        document.getElementById('unlockButton')`, 60000);
    if (await app.evaluate(`Boolean(document.getElementById(
        'unlockButton'))`)) {
        await app.type('[name=password]', PASSWORD);
        await app.click('#unlockButton');
    }
    await app.waitFor(`document.getElementById('hive')`, 600000);
    assert.equal(await app.core('getMyAddress'), ADDRESS);
});

test('No errors or CSP violations were logged', () => {
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.dialogs, []);
});
