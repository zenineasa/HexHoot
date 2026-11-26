/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

const {
    app, BrowserWindow, ipcMain, MessageChannelMain, protocol, session, shell,
    utilityProcess,
} = require('electron');
const fs = require('fs/promises');
const path = require('path');
const imagePack = require('../ImagePack');
const testHooks = require('./testHooks');
const {links: socialLinks} = require('../Social/links.json');

// The renderer is served from app://hexhoot/modules/..., which gives it a
// proper origin for ES modules and the CSP 'self'.
const appOrigin = 'app://hexhoot';
const modulesDir = path.join(__dirname, '..');
const contentTypes = {
    '.html': 'text/html',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
};
// Links the renderer may open in the system browser
const externalLinks = new Set(socialLinks.map(([, url]) => url));

protocol.registerSchemesAsPrivileged([{
    scheme: 'app',
    privileges: {standard: true, secure: true, supportFetchAPI: true},
}]);

let core = null;
let quitting = false;

/**
 * Serve the renderer's files. Only files under modules/ with one of the
 * listed types are served; Core's and main's .js files are not.
 * @param {Request} request the request
 * @return {Response} the response
 */
async function serveAppFile(request) {
    const url = new URL(request.url);
    const file = path.join(modulesDir, '..',
        decodeURIComponent(url.pathname));
    const type = contentTypes[path.extname(file)];
    if (url.host !== 'hexhoot' || !type ||
        !file.startsWith(modulesDir + path.sep)) {
        return new Response('Not found', {status: 404});
    }
    try {
        return new Response(await fs.readFile(file),
            {headers: {'Content-Type': type}});
    } catch (err) {
        return new Response('Not found', {status: 404});
    }
}

/**
 * Start Core (storage, protocol and networking) in a utilityProcess. If it
 * exits unexpectedly, it is started again and the windows reload, which
 * makes them reconnect.
 */
function startCore() {
    core = utilityProcess.fork(path.join(__dirname, '..', 'Core', 'main.js'),
        [], {serviceName: 'HexHoot Core'});
    core.postMessage({type: 'init', config: Object.assign({
        userData: app.getPath('userData'),
        version: app.getVersion(),
    }, testHooks(app))});
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
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame ||
        !frame.url.startsWith(appOrigin + '/')) {
        return;
    }
    const {port1, port2} = new MessageChannelMain();
    core.postMessage({type: 'connect'}, [port1]);
    frame.postMessage('core:port', null, [port2]);
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
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });
    // The app is a single page; never navigate away from it or open new
    // windows. The listed external links open in the system browser.
    win.webContents.setWindowOpenHandler(function({url}) {
        if (externalLinks.has(url)) {
            shell.openExternal(url);
        }
        return {action: 'deny'};
    });
    win.webContents.on('will-navigate', function(event) {
        event.preventDefault();
    });
    win.webContents.on('will-attach-webview', function(event) {
        event.preventDefault();
    });

    win.maximize();
    win.loadURL(appOrigin + '/modules/Main/index.html');
}

app.whenReady().then(() => {
    protocol.handle('app', serveAppFile);
    // Notifications and copying the public key are the only permissions
    // the app uses.
    const allowed = new Set(['notifications', 'clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler(
        (webContents, permission, callback) =>
            callback(allowed.has(permission)));
    session.defaultSession.setPermissionCheckHandler(
        (webContents, permission) => allowed.has(permission));

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
