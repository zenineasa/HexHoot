/* Copyright (c) 2023-2026 Zenin Easa Panthakkalakath */

const {FusesPlugin} = require('@electron-forge/plugin-fuses');
const {FuseV1Options, FuseVersion} = require('@electron/fuses');
const imagePack = require('./modules/ImagePack');

module.exports = {
    packagerConfig: {
        name: 'HexHoot',
        executableName: 'hexhoot',
        asar: true,
        // No extension: the packager picks .icns / .ico per target platform
        icon: imagePack.getPath('desktop.mac').replace(/\.icns$/, ''),
        // Ship only the app: no tests, docs, scripts or tool configuration
        ignore: [
            /^\/(test|test-results|docs|scripts|\.github)(\/|$)/,
            /^\/(\.clabot|\.gitignore|makefile)$/,
            /^\/(eslint|forge)\.config\.js$/,
        ],
    },
    rebuildConfig: {},
    hooks: {
        // Native modules (sodium-native, udx-native, bare-*) ship prebuilt
        // binaries for every platform, Android and iOS included, and load
        // only <platform>-<arch>. Keep that one (and its musl twin): the
        // rest only add size, and rpm's strip fails on foreign binaries.
        packageAfterPrune: async (config, buildPath, electronVersion,
            platform, arch) => {
            const fs = require('node:fs');
            const path = require('node:path');
            const keep = [`${platform}-${arch}`, `${platform}-${arch}-musl`];
            const modules = path.join(buildPath, 'node_modules');
            for (const name of fs.readdirSync(modules)) {
                const prebuilds = path.join(modules, name, 'prebuilds');
                if (!fs.existsSync(prebuilds)) {
                    continue;
                }
                for (const target of fs.readdirSync(prebuilds)) {
                    if (!keep.includes(target)) {
                        fs.rmSync(path.join(prebuilds, target),
                            {recursive: true, force: true});
                    }
                }
            }
        },
    },
    makers: [
        {
            // For windows:
            name: '@electron-forge/maker-squirrel',
            config: {
                // eslint-disable-next-line max-len
                iconUrl: 'https://raw.githubusercontent.com/zenineasa/HexHoot/main/modules/ImagePack/images/DesktopIcons/icon.ico',
                setupIcon: imagePack.getPath('desktop.windows'),
            },
        },
        {
            // For mac (replaces the former appdmg steps in the makefile):
            name: '@electron-forge/maker-dmg',
            config: {
                title: 'HexHoot',
                icon: imagePack.getPath('desktop.mac'),
                additionalDMGOptions: {
                    'background-color': '#2b2e2f',
                },
            },
        },
        {
            // For debian:
            name: '@electron-forge/maker-deb',
            config: {
                options: {
                    icon: imagePack.getPath('desktop.linux'),
                },
            },
        },
        {
            // For other linux:
            name: '@electron-forge/maker-rpm',
            config: {
                options: {
                    icon: imagePack.getPath('desktop.linux'),
                },
            },
        },
    ],
    plugins: [
        // Fuses are flipped at package time and cannot be changed at runtime.
        new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
        }),
    ],
};
