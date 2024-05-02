/* Copyright (c) 2023-2024 Zenin Easa Panthakkalakath */

const imagePack = require('./modules/ImagePack');

module.exports = {
    packagerConfig: {},
    rebuildConfig: {},
    makers: [
        {
            // For windows:
            name: '@electron-forge/maker-squirrel',
            config: {
                iconUrl: 'https://raw.githubusercontent.com/zenineasa/HexHoot/main/modules/ImagePack/images/DesktopIcons/icon_windows.ico',
                setupIcon: imagePack.getPath('desktop.windows'),
            },
        },
        {
            // For mac:
            name: '@electron-forge/maker-dmg',
            config: {
                icon: imagePack.getPath('desktop.mac'),
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
};
