/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

const {app, BrowserWindow} = require('electron');
const path = require('path');
const imagePack = require('../ImagePack');

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
    // The app is a single page; never navigate away from it or open new
    // windows. External links go through shell.openExternal instead.
    win.webContents.setWindowOpenHandler(function() {
        return {action: 'deny'};
    });
    win.webContents.on('will-navigate', function(event) {
        event.preventDefault();
    });
    win.webContents.on('will-attach-webview', function(event) {
        event.preventDefault();
    });

    win.maximize();
    win.loadFile(path.join(__dirname, 'index.html'));
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
