/* Copyright (c) 2023 Zenin Easa Panthakkalakath */

module.exports = {
    packagerConfig: {},
    rebuildConfig: {},
    makers: [
        {
            // For windows:
            name: '@electron-forge/maker-squirrel',
            config: {
                iconUrl: 'https://raw.githubusercontent.com/zenineasa/HexHoot/main/modules/ImagePack/images/DesktopIcons/icon_windows.ico',
                setupIcon: './modules/ImagePack/images/DesktopIcons/icon_windows.ico',
            },
        },
        {
            // For mac:
            name: '@electron-forge/maker-dmg',
            config: {
                icon: './modules/ImagePack/images/DesktopIcons/icon_mac.icns',
            },
        },
        {
            // For debian:
            name: '@electron-forge/maker-deb',
            config: {
                options: {
                    icon: './modules/ImagePack/images/DesktopIcons/icon_linux.png',
                },
            },
        },
        {
            // For other linux:
            name: '@electron-forge/maker-rpm',
            config: {
                options: {
                    icon: './modules/ImagePack/images/DesktopIcons/icon_linux.png',
                },
            },
        },
    ],
};
