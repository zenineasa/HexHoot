/* Copyright (c) 2022-2025 Zenin Easa Panthakkalakath */

import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as imagePack from '../ImagePack';

/**
 * Creates CEF window in which the app runs
 */
function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        title: 'HexHoot',
        icon: imagePack.getPath('branding.favicon'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    win.maximize();
    win.loadFile('dist/modules/Main/index.html');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
