/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Runs each E2E file (test/e2e/*.e2e.mjs) on its own. A file that fails is
// run once more: if it passes then, it is reported as flaky rather than
// hidden. Writes test-results/e2e/results.json, and a table to the GitHub
// step summary when running in Actions.
//
//     HEXHOOT_TEST_ONLY=friends,ui   run only files whose name contains one
//                                    of these

import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {glob} from 'glob';

const root = path.resolve(import.meta.dirname, '..');
const artifacts = process.env.HEXHOOT_E2E_ARTIFACTS ||
    path.join(root, 'test-results', 'e2e');
const only = (process.env.HEXHOOT_TEST_ONLY || '').split(',')
    .map((name) => name.trim()).filter(Boolean);

const files = (await glob('test/e2e/**/*.e2e.mjs', {cwd: root})).sort()
    .filter((file) => only.length === 0 ||
        only.some((name) => path.basename(file).includes(name)));
if (files.length === 0) {
    console.error('No E2E files match HEXHOOT_TEST_ONLY=' + only.join());
    process.exit(1);
}

/**
 * Run one file
 * @param {string} file path from the repository root
 * @return {Object} {passed, seconds}
 */
function run(file) {
    const start = Date.now();
    const result = spawnSync(process.execPath,
        ['--test', '--test-concurrency=1', file],
        {cwd: root, stdio: 'inherit', env: process.env});
    return {passed: result.status === 0, seconds: (Date.now() - start) / 1e3};
}

const results = [];
for (const file of files) {
    console.log(`\n=== ${file}`);
    const first = run(file);
    let outcome = first.passed ? 'passed' : 'failed';
    let seconds = first.seconds;
    if (!first.passed) {
        console.log(`\n=== ${file} failed; running it once more`);
        const second = run(file);
        outcome = second.passed ? 'flaky' : 'failed';
        seconds += second.seconds;
    }
    results.push({file, outcome, seconds: Math.round(seconds)});
}

fs.mkdirSync(artifacts, {recursive: true});
fs.writeFileSync(path.join(artifacts, 'results.json'),
    JSON.stringify(results, null, 2) + '\n');

const icons = {passed: '✅', flaky: '⚠️', failed: '❌'};
const table = ['| File | Result | Seconds |', '|---|---|---|',
    ...results.map((r) =>
        `| ${r.file} | ${icons[r.outcome]} ${r.outcome} | ${r.seconds} |`)];
console.log('\n' + table.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        '### E2E\n\n' + table.join('\n') + '\n');
}
for (const r of results.filter((r) => r.outcome === 'flaky')) {
    const prefix = process.env.GITHUB_ACTIONS ? '::warning::' : 'Flaky: ';
    console.log(`${prefix}${r.file} failed once, then passed`);
}
process.exit(results.some((r) => r.outcome === 'failed') ? 1 : 0);
