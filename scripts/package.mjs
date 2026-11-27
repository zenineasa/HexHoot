/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Package HexHoot for this machine with @electron/packager, into
// out/package/HexHoot-<platform>-<arch>, and flip its fuses. Wrapping that
// folder into an installer is scripts/distribute.mjs.
//
//     node scripts/package.mjs [platform] [arch]   (default: this machine)

import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {packager} from '@electron/packager';
import {flipFuses, FuseVersion, FuseV1Options} from '@electron/fuses';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'),
    'utf8'));
const imagePack = require('../modules/ImagePack');

export const appName = 'HexHoot';
export const executableName = 'hexhoot';
// Reverse DNS of where the project lives; also the Linux desktop file id
export const appId = 'io.github.zenineasa.HexHoot';
export const packageRoot = path.join(root, 'out', 'package');

// Top-level folders and files that build, test or document the app
const ignoredTopLevel = new Set(['.git', '.github', '.vscode', '.claude',
    'out', 'test', 'test-results', 'docs', 'scripts', 'packaging',
    'eslint.config.js', 'makefile', 'package-lock.json', '.clabot',
    '.gitignore']);
// Native modules ship prebuilt binaries for every platform, Android and
// iOS included, and load only <platform>-<arch> (or its musl twin). The
// rest only add size, and some Linux tools fail on foreign binaries.
const prebuild = /^node_modules\/(?:.+\/)?prebuilds\/([^/]+)(?:\/|$)/;

/**
 * Whether a path is left out of the package
 * @param {string} file path from the app folder, starting with /
 * @param {string} platform target platform
 * @param {string} arch target architecture
 * @return {boolean} true to leave it out
 */
export function ignored(file, platform, arch) {
    const normalized = file.replaceAll('\\', '/').replace(/^\/+/, '');
    if (ignoredTopLevel.has(normalized.split('/')[0])) {
        return true;
    }
    const target = prebuild.exec(normalized)?.[1];
    return Boolean(target) && target !== `${platform}-${arch}` &&
        target !== `${platform}-${arch}-musl`;
}

/**
 * Package the app and flip its fuses
 * @param {string} platform darwin, win32 or linux
 * @param {string} arch x64 or arm64
 * @return {string} the packaged folder
 */
export async function packageApp(platform = process.platform,
    arch = process.arch) {
    const [dir] = await packager({
        dir: root,
        name: appName,
        executableName,
        appVersion: pkg.version,
        appBundleId: appId,
        appCopyright: pkg.coprightMessage,
        // No extension: the packager picks .icns or .ico per platform
        icon: imagePack.getPath('desktop.mac').replace(/\.icns$/, ''),
        platform,
        arch,
        asar: true,
        prune: true,
        overwrite: true,
        out: packageRoot,
        ignore: (file) => ignored(file, platform, arch),
    });
    // Fuses are fixed in the binary and cannot be changed at run time
    const binary = {
        darwin: path.join(dir, `${appName}.app`),
        win32: path.join(dir, `${executableName}.exe`),
        linux: path.join(dir, executableName),
    }[platform];
    await flipFuses(binary, {
        version: FuseVersion.V1,
        // The packager signed the macOS app ad hoc; flipping breaks that
        resetAdHocDarwinSignature: platform === 'darwin',
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
    });
    console.log(`Packaged ${path.relative(root, dir)}`);
    return dir;
}

if (import.meta.filename === path.resolve(process.argv[1])) {
    await packageApp(process.argv[2], process.argv[3]);
}
