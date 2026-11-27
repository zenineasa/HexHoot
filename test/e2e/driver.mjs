/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Launches the real app (from source) with a fresh profile and drives its
// window over the Chrome DevTools Protocol. Test hooks (--interaction-test)
// are on, so HEXHOOT_* variables configure Core; see Main/testHooks.js.
// --use-mock-keychain keeps safeStorage away from the real OS keychain.

import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

const require = createRequire(import.meta.url);
const electron = require('electron');
const root = path.resolve(import.meta.dirname, '../..');

/**
 * Wait for a value
 * @param {function} get returns the value, or a falsy value to keep waiting
 * @param {string} what description for the timeout error
 * @param {number} timeout milliseconds
 * @return {*} the value
 */
async function poll(get, what, timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        const value = await get();
        if (value) {
            return value;
        }
        await sleep(100);
    }
    throw new Error('Timed out waiting for ' + what);
}

/**
 * Connect to a DevTools WebSocket
 * @param {string} url the WebSocket URL
 * @return {Object} {send(method, params), on(method, func), close()}
 */
async function connectCDP(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, {once: true});
        ws.addEventListener('error', reject, {once: true});
    });
    let nextId = 1;
    const pending = new Map();
    const handlers = new Map();
    ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            const {resolve, reject} = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) {
                reject(new Error(msg.error.message));
            } else {
                resolve(msg.result);
            }
        } else if (msg.method && handlers.has(msg.method)) {
            for (const func of handlers.get(msg.method)) {
                func(msg.params);
            }
        }
    });
    return {
        send(method, params = {}) {
            const id = nextId++;
            return new Promise((resolve, reject) => {
                pending.set(id, {resolve, reject});
                ws.send(JSON.stringify({id, method, params}));
            });
        },
        on(method, func) {
            handlers.set(method, [...(handlers.get(method) || []), func]);
        },
        close() {
            ws.close();
        },
    };
}

/**
 * Launch the app
 * @param {Object} [options]
 * @param {string} [options.name] peer name, used in logs
 * @param {Object} [options.env] extra environment variables
 * @param {string} [options.userData] reuse this profile (a restart); it is
 * then kept on close
 * @param {string} [options.executable] a packaged app to run instead of
 * the sources (L5)
 * @return {Object} a handle; see the returned object
 */
export async function launchApp(options = {}) {
    const name = options.name || 'app';
    const userData = options.userData ||
        fs.mkdtempSync(path.join(os.tmpdir(), `hexhoot-${name}-`));
    const args = ['--interaction-test', `--user-data-dir=${userData}`,
        '--remote-debugging-port=0', '--use-mock-keychain'];
    if (!options.executable) {
        args.unshift('.');
    }
    if (process.platform === 'linux' && process.env.CI) {
        args.push('--no-sandbox'); // CI containers lack user namespaces
    }
    const log = [];
    const child = spawn(options.executable || electron, args, {
        cwd: root,
        // Cheap scrypt, so logging in takes milliseconds (testHooks.js)
        env: Object.assign({HEXHOOT_TEST_SCRYPT_N: '16384'}, process.env,
            options.env),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => log.push(chunk.toString()));
    child.stderr.on('data', (chunk) => log.push(chunk.toString()));
    const exited = new Promise((resolve) => child.once('exit', resolve));

    const close = async () => {
        if (child.exitCode === null) {
            child.kill();
            await exited;
        }
        if (!options.userData) {
            fs.rmSync(userData, {recursive: true, force: true});
        }
    };

    try {
        const portFile = path.join(userData, 'DevToolsActivePort');
        fs.rmSync(portFile, {force: true}); // from an earlier run
        const port = await poll(() => fs.existsSync(portFile) &&
            fs.readFileSync(portFile, 'utf8').split('\n')[0],
        'the DevTools port', 30000);
        const page = await poll(async () => {
            try {
                const targets = await (await fetch(
                    `http://127.0.0.1:${port}/json`)).json();
                return targets.find((target) => target.type === 'page' &&
                    target.url.startsWith('app://hexhoot/'));
            } catch (err) {
                return undefined;
            }
        }, 'the app window', 30000);

        const cdp = await connectCDP(page.webSocketDebuggerUrl);
        const errors = [];
        const dialogs = [];
        cdp.on('Runtime.exceptionThrown', (params) => errors.push(
            params.exceptionDetails.exception?.description ||
            params.exceptionDetails.text));
        cdp.on('Log.entryAdded', ({entry}) => {
            if (entry.level === 'error') {
                errors.push(entry.text);
            }
        });
        cdp.on('Page.javascriptDialogOpening', (params) => {
            dialogs.push(params.message);
            cdp.send('Page.handleJavaScriptDialog', {accept: true});
        });
        await cdp.send('Runtime.enable');
        await cdp.send('Log.enable');
        await cdp.send('Page.enable');

        /**
         * Evaluate an expression in the page; promises are awaited
         * @param {string} expression JavaScript
         * @return {*} the (JSON-serializable) result
         */
        const evaluate = async (expression) => {
            const result = await cdp.send('Runtime.evaluate', {
                expression, awaitPromise: true, returnByValue: true});
            if (result.exceptionDetails) {
                throw new Error(result.exceptionDetails.exception
                    ?.description || result.exceptionDetails.text);
            }
            return result.result.value;
        };

        /**
         * Capture the window
         * @return {Buffer} PNG
         */
        const screenshot = async () => Buffer.from((await cdp.send(
            'Page.captureScreenshot', {format: 'png'})).data, 'base64');

        return {
            name,
            userData,
            errors,
            dialogs,
            log,
            evaluate,
            /**
             * Wait until an expression is truthy in the page
             * @param {string} expression JavaScript
             * @param {number} timeout milliseconds
             * @return {*} its value
             */
            waitFor: (expression, timeout = 15000) => poll(
                () => evaluate(expression).catch(() => undefined),
                `${name}: ${expression}`, timeout),
            /**
             * Click an element
             * @param {string} selector CSS selector
             */
            click: (selector) => evaluate(
                `document.querySelector(${JSON.stringify(selector)}).click()`),
            /**
             * Set the value of an input
             * @param {string} selector CSS selector
             * @param {string} value the value
             */
            type: (selector, value) => evaluate(`(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                el.value = ${JSON.stringify(value)};
                el.dispatchEvent(new Event('input', {bubbles: true}));
            })()`),
            /**
             * Call a Core method the way the UI does
             * @param {string} method name
             * @param {Array} args arguments
             * @return {*} the result
             */
            core: (method, ...args) => evaluate(
                `window.hexhoot.core.call(${JSON.stringify(method)}, ` +
                `${JSON.stringify(args)})`),
            screenshot,
            /**
             * Show the page at another size, like a smaller window
             * @param {number} width CSS pixels
             * @param {number} height CSS pixels
             */
            resize: (width, height) => cdp.send(
                'Emulation.setDeviceMetricsOverride',
                {width, height, deviceScaleFactor: 1, mobile: false}),
            /**
             * Write the log, page errors, dialogs and a screenshot
             * @param {string} dir directory, created if needed
             */
            saveArtifacts: async (dir) => {
                fs.mkdirSync(dir, {recursive: true});
                fs.writeFileSync(path.join(dir, `${name}.log`), log.join(''));
                fs.writeFileSync(path.join(dir, `${name}.json`),
                    JSON.stringify({errors, dialogs}, null, 2));
                try {
                    fs.writeFileSync(path.join(dir, `${name}.png`),
                        await screenshot());
                } catch (err) {
                    // The window may be gone; the log is still useful
                }
            },
            close: async () => {
                cdp.close();
                await close();
            },
        };
    } catch (err) {
        await close();
        err.message += '\n--- app log ---\n' + log.join('');
        throw err;
    }
}
