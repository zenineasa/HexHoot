/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

// Repository checks, moved from the Karma suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const glob = require('glob');
const regex = require('copyright-regex');

const root = path.resolve(__dirname, '../..');
const packageJson = require('../../package.json');

test('The package name is hexhoot', () => {
    assert.equal(packageJson.name, 'hexhoot');
});

test('Every code file has the copyright message', async () => {
    const files = await glob.glob('**/*.+(html|js|mjs|json|css)', {
        cwd: root,
        ignore: ['out/**', 'node_modules/**', 'test-results/**',
            'package-lock.json'],
    });
    assert.ok(files.length > 1);
    for (const file of files) {
        const matches = fs.readFileSync(path.join(root, file), 'utf8')
            .match(regex());
        assert.ok(matches && matches[5].trim() ===
            'Zenin Easa Panthakkalakath',
        'Copyright message not found in: ' + file);
    }
});

test('Every text is translated into the same languages', () => {
    const texts = JSON.parse(fs.readFileSync(
        path.join(root, 'modules/I18n/lang.json'), 'utf8'));
    let languages;
    for (const [module, entries] of Object.entries(texts)) {
        if (module === 'coprightMessage') {
            continue;
        }
        for (const [name, translations] of Object.entries(entries)) {
            const keys = Object.keys(translations);
            languages ??= keys;
            assert.deepEqual(keys, languages, `${module}.${name}`);
        }
    }
});

test('The version is newer than the latest GitHub release', async (t) => {
    const repo = packageJson.repository.url
        .split('git+https://github.com/')[1].split('.git')[0];
    let release;
    try {
        const response = await fetch(
            `https://api.github.com/repos/${repo}/releases/latest`,
            {signal: AbortSignal.timeout(10000)});
        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }
        release = await response.json();
    } catch (err) {
        t.skip('GitHub API unavailable: ' + err.message);
        return;
    }
    const ours = packageJson.version.match(/\d+/g).map(Number);
    const theirs = release.tag_name.match(/\d+/g).map(Number);
    assert.equal(ours.length, theirs.length);
    const newer = ours.findIndex((n, i) => n !== theirs[i]);
    assert.ok(newer !== -1 && ours[newer] > theirs[newer],
        `${packageJson.version} must be newer than ${release.tag_name}`);
});
