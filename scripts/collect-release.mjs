/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Gather what `npm run make` built for this machine (out/make) into
// out/release, named so that builds from every runner can sit side by side
// in one GitHub Release:
//   HexHoot-<version>-mac-arm64.dmg, HexHoot-<version>-mac-x64.dmg
//   HexHoot-<version>-windows-x64-setup.exe
//   hexhoot_<version>_amd64.deb, hexhoot-<version>-1.x86_64.rpm (as made)
// Fails if this platform's installers are missing.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const {version} = JSON.parse(fs.readFileSync(path.join(root,
    'package.json'), 'utf8'));
const made = path.join(root, 'out', 'make');
const release = path.join(root, 'out', 'release');

const files = fs.readdirSync(made, {recursive: true})
    .map((file) => path.join(made, file))
    .filter((file) => fs.statSync(file).isFile());

// What each platform must produce, and the name it gets
const wanted = {
    darwin: [[/\.dmg$/, () => `HexHoot-${version}-mac-${process.arch}.dmg`]],
    win32: [[/Setup\.exe$/,
        () => `HexHoot-${version}-windows-${process.arch}-setup.exe`]],
    linux: [[/\.deb$/, (file) => path.basename(file)],
        [/\.rpm$/, (file) => path.basename(file)]],
}[process.platform];

fs.mkdirSync(release, {recursive: true});
for (const [pattern, name] of wanted) {
    const found = files.filter((file) => pattern.test(file));
    if (found.length !== 1) {
        console.error(`Expected one file matching ${pattern} under out/make,` +
            ` found ${found.length}:`, found);
        process.exit(1);
    }
    const target = path.join(release, name(found[0]));
    fs.copyFileSync(found[0], target);
    console.log(`${path.relative(root, found[0])} -> ` +
        path.relative(root, target));
}
