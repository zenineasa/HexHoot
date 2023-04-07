/* Copyright (c) 2023 Zenin Easa Panthakkalakath */

const winIconURL = 'https://raw.githubusercontent.com/zenineasa/HexHoot/main/modules/ImagePack/images/DesktopIcons/icon_windows.ico';
const winIconPath = './modules/ImagePack/images/DesktopIcons/icon_windows.ico';
const macIconPath = './modules/ImagePack/images/DesktopIcons/icon_mac.icns';
const linuxIconPath = './modules/ImagePack/images/DesktopIcons/icon_linux.png';

module.exports = {
    packagerConfig: {},
    rebuildConfig: {},
    makers: [
        {
            // For windows:
            name: '@electron-forge/maker-squirrel',
            config: {
                iconUrl: winIconURL,
                setupIcon: winIconPath,
            },
        },
        {
            // For mac:
            name: '@electron-forge/maker-dmg',
            config: {
                icon: macIconPath,
            },
        },
        {
            // For debian:
            name: '@electron-forge/maker-deb',
            config: {
                options: {
                    icon: linuxIconPath,
                },
            },
        },
        {
            // For other linux:
            name: '@electron-forge/maker-rpm',
            config: {
                options: {
                    icon: linuxIconPath,
                },
            },
        },
    ],
};
