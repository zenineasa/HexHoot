/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Package HexHoot for this machine (scripts/package.mjs), then wrap it into
// this platform's installers in out/release, named so that builds from every
// runner can sit side by side in one GitHub Release:
//
//   macOS    HexHoot-<version>-mac-<arch>.dmg          needs create-dmg
//   Windows  HexHoot-<version>-windows-<arch>-setup.exe needs NSIS
//            HexHoot-<version>-windows-<arch>.zip      (portable)
//   Linux    HexHoot-<version>-<x86_64|aarch64>.AppImage (+ .zsync)
//                                                      needs appimagetool,
//                                                      zsyncmake
//            hexhoot_<version>-1_<amd64|arm64>.deb     needs dpkg-deb
//
// Nothing is signed with a developer identity yet: macOS gets an ad hoc
// signature, which Apple silicon requires to run at all.

import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {createRequire} from 'node:module';
import {appName, appId, executableName, packageApp} from './package.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const {version} = JSON.parse(fs.readFileSync(path.join(root,
    'package.json'), 'utf8'));
const imagePack = require('../modules/ImagePack');
const release = path.join(root, 'out', 'release');
// The .deb's maintainer line; set DEB_MAINTAINER to name a real address
const maintainer = process.env.DEB_MAINTAINER ||
    'Zenin Easa Panthakkalakath <noreply@github.com>';
const linux = path.join(root, 'packaging', 'linux');

/**
 * Run a command, failing loudly
 * @param {string} command the program
 * @param {Array<string>} args its arguments
 * @param {Object} [options] for spawnSync
 * @return {string} what it printed
 */
function run(command, args, options = {}) {
    console.log(`> ${command} ${args.join(' ')}`);
    const result = spawnSync(command, args, {encoding: 'utf8',
        maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'inherit'],
        ...options});
    if (result.status !== 0) {
        throw new Error(`${command} failed (${result.status ?? result.error})` +
            (result.stdout ? ':\n' + result.stdout : ''));
    }
    return result.stdout;
}

/**
 * Find a program on PATH or in the given places
 * @param {string} name the program
 * @param {Array<string>} [places] where else it may be
 * @param {string} [hint] how to install it
 * @return {string} its path
 */
function need(name, places = [], hint = '') {
    const which = spawnSync(process.platform === 'win32' ? 'where' : 'which',
        [name], {encoding: 'utf8'});
    const found = which.status === 0 ? which.stdout.split(/\r?\n/)[0] :
        places.find((place) => fs.existsSync(place));
    if (!found) {
        throw new Error(`${name} is needed to build the installer. ${hint}`);
    }
    return found;
}

/**
 * The AppStream metadata, with this version released today
 * @return {string} XML
 */
function metainfo() {
    const source = fs.readFileSync(path.join(linux,
        `${appId}.metainfo.xml`), 'utf8');
    const today = new Date().toISOString().slice(0, 10);
    return source.replace(/<release version="[^"]*" date="[^"]*" \/>/,
        `<release version="${version}" date="${today}" />`);
}

/**
 * macOS: an ad hoc signed app in a drag-to-Applications DMG
 * @param {string} dir the packaged folder
 * @param {string} arch x64 or arm64
 */
function macOS(dir, arch) {
    const createDmg = need('create-dmg', [],
        'Install it with: brew install create-dmg');
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'hexhoot-dmg-'));
    try {
        const app = path.join(stage, `${appName}.app`);
        run('cp', ['-R', path.join(dir, `${appName}.app`), stage]);
        run('codesign', ['--deep', '--force', '--sign', '-', app]);
        run('codesign', ['--verify', '--deep', '--strict', app]);
        const dmg = path.join(release, `${appName}-${version}-mac-${arch}.dmg`);
        fs.rmSync(dmg, {force: true});
        run(createDmg, ['--volname', appName,
            '--volicon', imagePack.getPath('desktop.mac'),
            '--window-size', '600', '400', '--icon-size', '128',
            '--icon', `${appName}.app`, '150', '190',
            '--hide-extension', `${appName}.app`,
            '--app-drop-link', '450', '190',
            '--no-internet-enable', '--format', 'UDZO', dmg, stage]);
        console.log(`Created ${path.relative(root, dmg)}`);
    } finally {
        fs.rmSync(stage, {recursive: true, force: true});
    }
}

/**
 * Windows: an NSIS installer, and the same app as a portable zip
 * @param {string} dir the packaged folder
 * @param {string} arch x64 or arm64
 */
function windows(dir, arch) {
    const makensis = need('makensis', [
        'C:\\Program Files (x86)\\NSIS\\makensis.exe',
        'C:\\Program Files\\NSIS\\makensis.exe'],
    'Install NSIS (https://nsis.sourceforge.io, or choco install nsis).');
    const setup = path.join(release,
        `${appName}-${version}-windows-${arch}-setup.exe`);
    // The script changes to the repository root, so paths are from there
    const fromRoot = (file) => path.relative(root, file);
    run(makensis, [
        `/DAPP_NAME=${appName}`,
        `/DAPP_VERSION=${version}`,
        `/DAPP_ID=${appId}`,
        `/DEXE_NAME=${executableName}.exe`,
        `/DSOURCE_DIR=${fromRoot(dir)}`,
        `/DICON_PATH=${fromRoot(imagePack.getPath('desktop.windows'))}`,
        '/DLICENSE_PATH=LICENSE',
        `/DOUTPUT_FILE=${fromRoot(setup)}`,
        path.join(root, 'packaging', 'windows', 'installer.nsi')]);
    console.log(`Created ${fromRoot(setup)}`);

    // Windows' own bsdtar writes a zip when the name ends in .zip
    const zip = path.join(release, `${appName}-${version}-windows-${arch}.zip`);
    fs.rmSync(zip, {force: true});
    run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32',
        'tar.exe'), ['-a', '-c', '-f', zip, path.basename(dir)],
    {cwd: path.dirname(dir)});
    console.log(`Created ${fromRoot(zip)}`);
}

/**
 * Linux: an AppImage, which runs on most distributions and can update
 * itself, and a .deb for Debian and Ubuntu
 * @param {string} dir the packaged folder
 * @param {string} arch x64 or arm64
 */
function linuxPackages(dir, arch) {
    appImage(dir, arch);
    deb(dir, arch);
}

/**
 * The AppImage
 * @param {string} dir the packaged folder
 * @param {string} arch x64 or arm64
 */
function appImage(dir, arch) {
    const appimagetool = need('appimagetool', [], 'See ' +
        'https://github.com/AppImage/appimagetool/releases');
    need('zsyncmake', [], 'Install it with: sudo apt-get install zsync');
    const machine = {x64: 'x86_64', arm64: 'aarch64'}[arch];
    const name = `${appName}-${version}-${machine}.AppImage`;
    const appDir = path.join(release, `${appName}.AppDir`);
    fs.rmSync(appDir, {recursive: true, force: true});
    const lib = path.join(appDir, 'usr', 'lib', executableName);
    fs.mkdirSync(path.dirname(lib), {recursive: true});
    run('cp', ['-a', dir, lib]);
    fs.copyFileSync(path.join(linux, 'AppRun'), path.join(appDir, 'AppRun'));
    fs.chmodSync(path.join(appDir, 'AppRun'), 0o755);
    fs.copyFileSync(path.join(linux, `${appId}.desktop`),
        path.join(appDir, `${appId}.desktop`));
    const icon = imagePack.getPath('desktop.linux');
    fs.copyFileSync(icon, path.join(appDir, `${appId}.png`));
    fs.copyFileSync(icon, path.join(appDir, '.DirIcon'));
    const metainfoDir = path.join(appDir, 'usr', 'share', 'metainfo');
    fs.mkdirSync(metainfoDir, {recursive: true});
    fs.writeFileSync(path.join(metainfoDir, `${appId}.metainfo.xml`),
        metainfo());
    // Lets AppImageUpdate find newer releases; the .zsync file goes in the
    // release next to the AppImage, and this pattern must match its name
    const update = `gh-releases-zsync|zenineasa|HexHoot|latest|` +
        `${appName}-*-${machine}.AppImage.zsync`;
    fs.rmSync(path.join(release, name), {force: true});
    run(appimagetool, ['--updateinformation', update, appDir, name],
        {cwd: release, env: {...process.env, ARCH: machine}});
    fs.rmSync(appDir, {recursive: true, force: true});
    if (!fs.existsSync(path.join(release, `${name}.zsync`))) {
        throw new Error(`appimagetool wrote no ${name}.zsync`);
    }
    console.log(`Created out/release/${name} and its .zsync`);
}

/**
 * What /usr/bin/hexhoot runs. The sandbox helper is installed setuid
 * root, so Chromium's sandbox normally works; only if that bit was lost
 * does it fall back like the AppImage's launcher (packaging/linux/AppRun).
 * @param {string} installDir where the app is
 * @return {string} the script
 */
function launcher(installDir) {
    return `#!/bin/sh
# Copyright (c) 2026 Zenin Easa Panthakkalakath

appDir=${installDir}

if [ ! -u "$appDir/chrome-sandbox" ]; then
    proc=/proc/sys/kernel
    restrictedByAppArmor="$(cat $proc/apparmor_restrict_unprivileged_userns \
        2>/dev/null)"
    disabledBySysctl="$(cat $proc/unprivileged_userns_clone 2>/dev/null)"
    if [ "$restrictedByAppArmor" = "1" ] || [ "$disabledBySysctl" = "0" ]; then
        set -- --no-sandbox "$@"
    fi
fi

exec "$appDir/${executableName}" "$@"
`;
}

/**
 * The .deb
 * @param {string} dir the packaged folder
 * @param {string} arch x64 or arm64
 */
function deb(dir, arch) {
    need('dpkg-deb', [], 'Build on Debian or Ubuntu.');
    const architecture = {x64: 'amd64', arm64: 'arm64'}[arch];
    // Debian sorts 2.0.0-beta.1 after 2.0.0; ~ sorts before it
    const debVersion = `${version.replace(/-/g, '~')}-1`;
    const installDir = `/usr/lib/${executableName}`;
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'hexhoot-deb-'));
    const at = (...parts) => path.join(stage, ...parts);
    const write = (file, text, mode = 0o644) => {
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, text, {mode});
        fs.chmodSync(file, mode);
    };
    try {
        fs.mkdirSync(path.dirname(at(installDir)), {recursive: true});
        run('cp', ['-a', dir, at(installDir)]);
        // Not dependent on the build machine's umask; the sandbox helper is
        // setuid root on purpose
        run('chmod', ['-R', 'u+rwX,go+rX,go-w', at(installDir)]);
        fs.chmodSync(at(installDir, 'chrome-sandbox'), 0o4755);
        write(at('usr', 'bin', executableName), launcher(installDir), 0o755);
        write(at('usr', 'share', 'applications', `${appId}.desktop`),
            fs.readFileSync(path.join(linux, `${appId}.desktop`), 'utf8'));
        write(at('usr', 'share', 'metainfo', `${appId}.metainfo.xml`),
            metainfo());
        write(at('usr', 'share', 'icons', 'hicolor', '512x512', 'apps',
            `${appId}.png`), fs.readFileSync(
            imagePack.getPath('desktop.linux')));
        write(at('usr', 'share', 'doc', executableName, 'copyright'),
            'Format: https://www.debian.org/doc/packaging-manuals/' +
            'copyright-format/1.0/\nUpstream-Name: HexHoot\n' +
            'Source: https://github.com/zenineasa/HexHoot\n\nFiles: *\n' +
            'Copyright: 2022-2026 Zenin Easa Panthakkalakath\n' +
            'License: AGPL-3.0\n On Debian systems, the full text is in ' +
            '/usr/share/common-licenses/AGPL-3.\n .\n Electron, Chromium ' +
            'and the other bundled components keep their own licenses;\n' +
            ` their notices are in ${installDir}.\n`);
        const date = new Date().toUTCString().replace('GMT', '+0000');
        write(at('usr', 'share', 'doc', executableName,
            'changelog.Debian.gz'), zlib.gzipSync(`${executableName} ` +
            `(${debVersion}) stable; urgency=medium\n\n  * HexHoot ` +
            `${version}: https://github.com/zenineasa/HexHoot/releases\n\n` +
            ` -- ${maintainer}  ` +
            `${date}\n`, {level: 9}));

        const installedSize = Number.parseInt(run('du',
            ['-sk', at('usr')]), 10);
        // t64 names came with the 64-bit time_t move (Ubuntu 24.04,
        // Debian 13); the older names keep 22.04 and Debian 12 working
        const depends = ['libgtk-3-0t64 | libgtk-3-0', 'libnotify4',
            'libnss3', 'libxss1', 'libxtst6', 'xdg-utils',
            'libatspi2.0-0t64 | libatspi2.0-0', 'libuuid1', 'libsecret-1-0',
            'libasound2t64 | libasound2', 'libgbm1', 'libdrm2',
            'libxkbcommon0'];
        write(at('DEBIAN', 'control'), [
            `Package: ${executableName}`,
            `Version: ${debVersion}`,
            `Architecture: ${architecture}`,
            `Maintainer: ${maintainer}`,
            `Installed-Size: ${installedSize}`,
            `Depends: ${depends.join(', ')}`,
            'Section: net',
            'Priority: optional',
            'Homepage: https://github.com/zenineasa/HexHoot',
            'Description: Peer-to-peer chat with no servers',
            ' Friends find each other over the internet or the local',
            ' network and talk directly, end-to-end encrypted, with no',
            ' server in between.',
        ].join('\n') + '\n');
        const files = fs.readdirSync(at('usr'), {recursive: true})
            .map((file) => path.join('usr', file))
            .filter((file) => fs.lstatSync(at(file)).isFile()).sort();
        write(at('DEBIAN', 'md5sums'), files.map((file) =>
            `${crypto.createHash('md5').update(fs.readFileSync(at(file)))
                .digest('hex')}  ${file}`).join('\n') + '\n');

        const output = path.join(release,
            `${executableName}_${debVersion}_${architecture}.deb`);
        fs.rmSync(output, {force: true});
        // xz rather than zstd, so older dpkg installs it too
        run('dpkg-deb', ['--build', '--root-owner-group', '-Zxz', stage,
            output]);
        // The one thing easy to get wrong: the sandbox helper's setuid bit
        const helper = run('dpkg-deb', ['--contents', output]).split('\n')
            .find((line) => line.endsWith(`.${installDir}/chrome-sandbox`));
        if (!/^-rws\S* root\/root /.test(helper ?? '')) {
            throw new Error(`chrome-sandbox is not setuid root: ${helper}`);
        }
        console.log(`Created ${path.relative(root, output)}`);
    } finally {
        fs.rmSync(stage, {recursive: true, force: true});
    }
}

const builders = {darwin: macOS, win32: windows, linux: linuxPackages};
if (!builders[process.platform]) {
    throw new Error(`No installers are built on ${process.platform}`);
}
const dir = await packageApp();
fs.mkdirSync(release, {recursive: true});
builders[process.platform](dir, process.arch);
