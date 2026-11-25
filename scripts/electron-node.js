/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

// Run Node with the arguments given, but inside the bundled Electron binary
// (ELECTRON_RUN_AS_NODE=1). Electron uses BoringSSL, while a system Node uses
// OpenSSL, and they support different algorithms. Tests for crypto and Core
// must run here so that nothing which only works in OpenSSL slips in.
//
// Usage: node scripts/electron-node.js --test test/capability/

const {spawnSync} = require('child_process');
const electronPath = require('electron');

const result = spawnSync(electronPath, process.argv.slice(2), {
    stdio: 'inherit',
    env: Object.assign({}, process.env, {ELECTRON_RUN_AS_NODE: '1'}),
});
if (result.error) {
    console.error(result.error);
    process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
