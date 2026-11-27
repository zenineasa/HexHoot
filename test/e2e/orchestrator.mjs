/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Multi-instance E2E (L3): launches several HexHoot apps that message each
// other over a private hyperdht testnet or the LAN carrier on 127.0.0.1, and
// gives each one UI-level actions (login, addFriend, send, ...). See
// docs/design/testing-infrastructure.md.
//
//     describe('alice and bob', () => {
//         const network = useNetwork({transport: 'dht',
//             peers: ['alice', 'bob']});
//         network.test('they chat', async ({alice, bob}) => { ... });
//     });

import {test, before, after} from 'node:test';
import {createRequire} from 'node:module';
import {fork} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {launchApp} from './driver.mjs';

const require = createRequire(import.meta.url);
const createTestnet = require('hyperdht/testnet');
const electron = require('electron');
const root = path.resolve(import.meta.dirname, '../..');

export const artifactsRoot = process.env.HEXHOOT_E2E_ARTIFACTS ||
    path.join(root, 'test-results', 'e2e');

/**
 * A free TCP port on this machine
 * @return {number} the port
 */
async function freePort() {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
}

/**
 * A name that is safe to use as a directory name
 * @param {string} name any text
 * @return {string} the name
 */
function slug(name) {
    return name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
        .toLowerCase();
}

/**
 * Add UI-level actions to an app handle. Scenarios use these, so they read
 * like what a person does; selectors and ids live here.
 * @param {Object} app a handle from launchApp
 * @param {number} otherPeers number of other peers in the network
 * @return {Object} the same handle
 */
function addActions(app, otherPeers) {
    const cell = (key, kind) => `.cell[data-key="${key}"]` +
        (kind ? `[data-kind="${kind}"]` : '');
    const q = (selector) =>
        `document.querySelector(${JSON.stringify(selector)})`;

    return Object.assign(app, {
        /**
         * Create an account on the welcome screen
         * @param {string} displayName at least five characters
         * @param {string} [password] at least sixteen characters
         * @return {string} the new public key
         */
        async login(displayName, password = 'ThisIsProbablyAGoodPassword') {
            await app.waitFor(`document.getElementById('loginButton')`);
            await app.type('[name=displayName]', displayName);
            await app.type('[name=password]', password);
            await app.waitFor(`!document.getElementById('loginButton')
                .disabled`);
            await app.click('#loginButton');
            await app.waitFor(`document.getElementById('hive')`);
            app.key = await app.core('getMyAddress');
            app.password = password; // for the unlock screen after restart
            return app.key;
        },

        /**
         * Wait until the signed-in app (the hive) is shown. Where the OS
         * keyring cannot sign in (Linux without a secret service, as on CI),
         * the app asks for the password again; type it, as a person would.
         */
        async ready() {
            const screen = await app.waitFor(`document.querySelector(
                '#hive .cells') ? 'hive' : document.getElementById(
                'unlockButton') ? 'unlock' : ''`);
            if (screen === 'unlock') {
                await app.type('[name=password]', app.password);
                await app.click('#unlockButton');
                await app.waitFor(`document.querySelector('#hive .cells')`,
                    30000);
            }
        },

        /**
         * Wait until every transport can be reached by the other peers:
         * announced on the DHT, or knowing every other LAN instance
         * @param {number} [timeout] milliseconds
         */
        async waitForTransports(timeout = 60000) {
            await app.waitFor(`window.hexhoot.core.call('getTransportStatus',
                []).then((all) => all.length > 0 && all.every((t) =>
                    t.ready && (t.peers ?? ${otherPeers}) >= ${otherPeers}))`,
            timeout);
        },

        /**
         * Knock on someone: the Add a friend dialog
         * @param {string} key their public key
         */
        async addFriend(key) {
            await app.click('#addFriendButton');
            await app.waitFor(`document.getElementById('theirPublicKey')`);
            await app.type('#theirPublicKey', key);
            await app.waitFor(`!document.getElementById('knockButton')
                .disabled`);
            await app.click('#knockButton');
            // The dialog closes and their "waiting" cell is selected
            await app.waitFor(`!document.getElementById('addFriendDialog') &&
                ${q(cell(key))}`);
        },

        /**
         * Wait until someone knocks
         * @param {string} key their public key
         * @param {number} [timeout] milliseconds
         * @return {Object} {name, images} of their cell
         */
        async waitForKnock(key, timeout = 30000) {
            await app.waitFor(q(cell(key, 'knocking')), timeout);
            return app.evaluate(`(() => {
                const el = ${q(cell(key, 'knocking'))};
                return {name: el.dataset.name,
                    images: el.getElementsByTagName('img').length};
            })()`);
        },

        /**
         * Wait for a friend request and let them in
         * @param {string} key the sender's public key
         * @param {number} [timeout] milliseconds
         */
        async acceptFriendRequest(key, timeout = 30000) {
            await app.waitForKnock(key, timeout);
            await app.click(cell(key, 'knocking'));
            await app.waitFor(q(`#request[data-key="${key}"]`));
            await app.click('#request [name=letIn]');
            // Their (empty) chain opens
            await app.waitFor(`${q('#chain')}?.dataset.chat ===
                ${JSON.stringify(key)} && ${q(cell(key, 'friend'))}`);
        },

        /**
         * Wait until a friend is in the hive with the given name
         * @param {string} key their public key
         * @param {string} displayName their name
         * @param {number} [timeout] milliseconds
         */
        async waitForFriend(key, displayName, timeout = 30000) {
            await app.waitFor(`${q(cell(key, 'friend'))}?.dataset.name ===
                ${JSON.stringify(displayName)}`, timeout);
        },

        /**
         * Open the chat with a friend
         * @param {string} key their public key
         */
        async openChat(key) {
            const open = `${q('#chain')}?.dataset.chat ===
                ${JSON.stringify(key)}`;
            if (!await app.evaluate(open)) {
                // Clicking the open chat's cell would go Home instead
                await app.click(cell(key));
            }
            // data-chat is set once the chat has loaded and is wired
            await app.waitFor(open);
        },

        /**
         * Type and send a message in the open chat
         * @param {string} text the message
         */
        async send(text) {
            await app.type('#composerInput', text);
            await app.click('#composer .send');
        },

        /**
         * The messages shown in the open chat, oldest first
         * @return {Array} [{type: 'sent'|'received', text}]
         */
        async messages() {
            return app.evaluate(`[...document.querySelectorAll(
                '#chainBody .msg')].map((row) => ({
                    type: row.classList.contains('sent') ? 'sent' :
                        'received',
                    text: row.querySelector('.text').textContent,
                }))`);
        },

        /**
         * Wait until the open chat shows a received message
         * @param {string} text the message
         * @param {number} [timeout] milliseconds
         */
        async waitForMessage(text, timeout = 30000) {
            await app.waitFor(`[...document.querySelectorAll(
                '#chainBody .msg.received .text')].some((el) =>
                el.textContent === ${JSON.stringify(text)})`, timeout);
        },

        /** Open the contact panel of the open chat */
        async openContact() {
            await app.click('#chainHeader .who');
            await app.waitFor(`document.getElementById('safetyNumber')`);
        },

        /** Mark the open contact verified (the numbers match) */
        async verify() {
            await app.click('#verification [name=verify]');
            await app.waitFor(`document.getElementById('verification')
                ?.dataset.verified === 'true'`);
        },

        /**
         * Press a key on the focused element
         * @param {string} key for example 'Escape'
         * @param {Object} [modifiers] {ctrlKey, metaKey, shiftKey}
         */
        async press(key, modifiers = {}) {
            await app.evaluate(`(document.activeElement || document.body)
                .dispatchEvent(new KeyboardEvent('keydown', Object.assign(
                    {key: ${JSON.stringify(key)}, bubbles: true},
                    ${JSON.stringify(modifiers)})))`);
        },
    });
}

/**
 * Start an adversarial peer (test/peers/evilPeer.js): a headless Core on
 * the LAN carrier, driven over IPC
 * @param {string} name its display name
 * @param {number} lanPort its port
 * @param {Array} lanPeers "host:port" of the others
 * @return {Object} a handle: {name, key, log, errors, dialogs, call(cmd,
 * ...args), saveArtifacts(dir), close()}
 */
async function startEvilPeer(name, lanPort, lanPeers) {
    const child = fork(path.join(root, 'test', 'peers', 'evilPeer.js'), [], {
        execPath: electron,
        // Not the test runner's flags (--secure-heap...), which Electron
        // refuses
        execArgv: [],
        env: Object.assign({}, process.env, {ELECTRON_RUN_AS_NODE: '1'}),
        // JSON: the V8 format differs between Node and Electron's Node
        serialization: 'json',
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const log = [];
    child.stdout.on('data', (chunk) => log.push(chunk.toString()));
    child.stderr.on('data', (chunk) => log.push(chunk.toString()));
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const waiting = new Map();
    let nextId = 0;
    child.on('message', ({id, result, error}) => {
        const {resolve, reject} = waiting.get(id);
        waiting.delete(id);
        if (error) {
            reject(new Error(`${name}: ${error}`));
        } else {
            resolve(result);
        }
    });
    exited.then(() => {
        for (const {reject} of waiting.values()) {
            reject(new Error(`${name} exited\n${log.join('')}`));
        }
    });
    const call = (cmd, ...args) => new Promise((resolve, reject) => {
        const id = nextId++;
        waiting.set(id, {resolve, reject});
        child.send({id, cmd, args});
    });
    const handle = {
        name, log, errors: [], dialogs: [], call,
        saveArtifacts: async (dir) => fs.writeFileSync(
            path.join(dir, `${name}.log`), log.join('')),
        close: async () => {
            if (child.exitCode === null) {
                await Promise.race([call('stop').catch(() => {}),
                    new Promise((resolve) => setTimeout(resolve, 5000))]);
                child.kill();
                await exited;
            }
        },
    };
    try {
        // Display names need five characters or more
        handle.key = await call('start', {name: name + ' peer', lanPort,
            lanPeers});
    } catch (err) {
        child.kill();
        throw err;
    }
    return handle;
}

/**
 * Launch a network of apps
 * @param {Object} options
 * @param {string} options.transport 'dht', 'lan' or 'dht,lan'
 * @param {Array} options.peers peer names, for example ['alice', 'bob']
 * @param {Array} [options.evil] names of adversarial headless peers
 * (test/peers/evilPeer.js); LAN only
 * @param {Object} [options.env] more environment variables for every app,
 * for example {HEXHOOT_TEST_FAULTS: 'drop:0.1'}
 * @return {Object} {peers: {name: handle}, step(text), saveArtifacts(label),
 * close()}. App handles have restart(whileDown): the same profile, port
 * and settings, in place.
 */
export async function launchNetwork(options) {
    const evil = options.evil || [];
    const names = [...options.peers, ...evil];
    const transports = options.transport.split(',');
    if (evil.length && !transports.includes('lan')) {
        throw new Error('Evil peers need the LAN transport');
    }
    const steps = [];
    const step = (text) => steps.push(`${new Date().toISOString()} ${text}`);
    const env = Object.assign({HEXHOOT_TRANSPORTS: options.transport},
        options.env);

    let testnet = null;
    if (transports.includes('dht')) {
        testnet = await createTestnet(3);
        env.HEXHOOT_DHT_BOOTSTRAP = testnet.bootstrap
            .map(({host, port}) => `${host}:${port}`).join();
        step('testnet ' + env.HEXHOOT_DHT_BOOTSTRAP);
    }
    let ports = [];
    if (transports.includes('lan')) {
        ports = await Promise.all(names.map(freePort));
        step('LAN ports ' + ports.join());
    }

    const peers = {};
    const profiles = [];
    const close = async () => {
        await Promise.allSettled(Object.values(peers).map((p) => p.close()));
        await testnet?.destroy();
        for (const dir of profiles) {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    };
    const lanPeers = (i) => ports.filter((_, j) => j !== i)
        .map((port) => '127.0.0.1:' + port);
    /**
     * @param {string} name the peer
     * @param {number} i its index
     * @return {Object} its app handle, with actions and restart()
     */
    const launchPeer = async (name, i) => {
        const userData = fs.mkdtempSync(path.join(os.tmpdir(),
            `hexhoot-${name}-`));
        profiles.push(userData);
        const launchOptions = {name, userData,
            env: Object.assign({}, env, ports.length ? {
                HEXHOOT_LAN_PORT: String(ports[i]),
                HEXHOOT_LAN_PEERS: lanPeers(i).join(),
            } : {})};
        const app = addActions(await launchApp(launchOptions),
            names.length - 1);
        /**
         * Close the app and start it again on the same profile
         * @param {function} [whileDown] runs while the app is closed
         */
        app.restart = async (whileDown) => {
            step('restart ' + name);
            const errors = app.errors;
            await app.close();
            await whileDown?.();
            // Same object, new process: scenarios keep their handle
            Object.assign(app, await launchApp(launchOptions));
            app.errors.unshift(...errors);
        };
        peers[name] = app;
        return app;
    };
    try {
        await Promise.all(options.peers.map(launchPeer));
        for (const name of evil) {
            const i = names.indexOf(name);
            peers[name] = await startEvilPeer(name, ports[i], lanPeers(i));
        }
        step('launched ' + names.join());
    } catch (err) {
        await close();
        throw err;
    }

    return {
        peers,
        step,
        /**
         * Write each peer's artifacts and the orchestrator log
         * @param {string} label test name
         * @return {string} the directory
         */
        async saveArtifacts(label) {
            const dir = path.join(artifactsRoot,
                slug(`${options.transport} ${names.join(' ')} ${label}`));
            fs.mkdirSync(dir, {recursive: true});
            fs.writeFileSync(path.join(dir, 'orchestrator.log'),
                steps.join('\n') + '\n');
            await Promise.all(Object.values(peers).map((peer) =>
                peer.saveArtifacts(dir)));
            return dir;
        },
        close,
    };
}

/**
 * Launch a network before the tests of the enclosing describe() and close it
 * after them. Its test() saves artifacts when a test fails.
 * @param {Object} options see launchNetwork
 * @return {Object} {peers, step, test(name, func({...peers}, t))}
 */
export function useNetwork(options) {
    const handle = {peers: {}, step() {}};
    before(async () => {
        Object.assign(handle, await launchNetwork(options));
    });
    after(async () => {
        await handle.close?.();
    });
    handle.test = (name, func) => test(name, async (t) => {
        handle.step('test: ' + name);
        try {
            await func(handle.peers, t);
        } catch (err) {
            handle.step('failed: ' + err.message);
            if (handle.saveArtifacts) {
                const dir = await handle.saveArtifacts(name);
                err.message += `\nArtifacts: ${path.relative(root, dir)}`;
            }
            throw err;
        }
    });
    return handle;
}

/**
 * a adds b through the UI, b accepts, and both list each other
 * @param {Object} a an app handle, logged in
 * @param {Object} b another
 * @param {string} aName a's display name
 * @param {string} bName b's display name
 */
export async function befriend(a, b, aName, bName) {
    await a.addFriend(b.key);
    await b.acceptFriendRequest(a.key, 60000);
    await a.waitForFriend(b.key, bName, 60000);
    await b.waitForFriend(a.key, aName, 60000);
}
