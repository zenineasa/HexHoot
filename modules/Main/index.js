/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

const {
    app, BrowserWindow, ipcMain, MessageChannelMain, utilityProcess,
} = require('electron');
const path = require('path');
const imagePack = require('../ImagePack');

let core = null;
let quitting = false;

/**
 * Start Core (storage, protocol and networking) in a utilityProcess. If it
 * exits unexpectedly, it is started again and the windows reload, which
 * makes them reconnect.
 */
function startCore() {
    core = utilityProcess.fork(path.join(__dirname, '..', 'Core', 'main.js'),
        [], {serviceName: 'HexHoot Core'});
    core.postMessage({type: 'init', config: {
        userData: app.getPath('userData'),
        version: app.getVersion(),
    }});
    core.on('exit', function(code) {
        if (quitting) {
            return;
        }
        console.error('Core exited with code ' + code + '; restarting');
        startCore();
        for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.reload();
        }
    });
}

/**
 * Give a renderer its own channel to Core
 * @param {IpcMainEvent} event the renderer's 'core:connect' request
 */
function connectRendererToCore(event) {
    // Only the app's own top-level page may talk to Core
    if (event.senderFrame !== event.sender.mainFrame) {
        return;
    }
    const {port1, port2} = new MessageChannelMain();
    core.postMessage({type: 'connect'}, [port1]);
    event.senderFrame.postMessage('core:port', null, [port2]);
}

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
    startCore();
    ipcMain.on('core:connect', connectRendererToCore);
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('before-quit', () => {
    quitting = true;
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
