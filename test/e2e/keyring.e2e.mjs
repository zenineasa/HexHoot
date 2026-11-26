/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// The keyring with Electron's real safeStorage, which only works in the
// main process. macOS runs with --use-mock-keychain, so no Keychain prompt
// appears. On Linux CI there is usually no secret service, so the backend
// is basic_text and the keyring must fall back to a passphrase.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electron = require('electron');

test('The keyring works with the real safeStorage', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexhoot-keyring-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const args = [path.join(import.meta.dirname, 'keyring-main.cjs'), dir,
        '--use-mock-keychain'];
    if (process.platform === 'linux' && process.env.CI) {
        args.push('--no-sandbox');
    }
    const run = spawnSync(electron, args, {encoding: 'utf8', timeout: 60000});
    const line = run.stdout.split('\n').find((l) => l.startsWith('{'));
    assert.ok(line, 'No result from Electron:\n' + run.stdout + run.stderr);
    const result = JSON.parse(line);
    t.diagnostic(`safeStorage: ${JSON.stringify(result.status)}`);

    assert.equal(result.error, undefined);
    assert.equal(result.decrypted, 'hello');
    assert.deepEqual(result.unlockers, result.status.strong ?
        ['os-keyring'] : ['passphrase']);
    if (process.platform !== 'linux') {
        assert.equal(result.status.strong, true,
            'macOS and Windows always have an OS keyring');
    }
});
