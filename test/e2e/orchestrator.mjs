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
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {launchApp} from './driver.mjs';

const require = createRequire(import.meta.url);
const createTestnet = require('hyperdht/testnet');
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
    const sidebarItem = (key) => `#sidebar_li_${key}`;
    const pendingItem = (key) =>
        `[data-testid="pending-request"][data-key="${key}"]`;

    return Object.assign(app, {
        /**
         * Create an account through the login form
         * @param {string} displayName longer than four characters
         * @param {string} [password] longer than eight characters
         * @return {string} the new public key
         */
        async login(displayName, password = 'ThisIsProbablyAGoodPassword') {
            await app.waitFor(`document.getElementById('loginButton')`);
            await app.type('[name=displayName]', displayName);
            await app.type('[name=password]', password);
            await app.click('#loginButton');
            await app.waitFor(`document.getElementById('friendsList')`);
            app.key = await app.core('getMyAddress');
            return app.key;
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
         * Send a friend request through the Add Friend screen
         * @param {string} key their public key
         */
        async addFriend(key) {
            await app.click('#addFriendButton');
            await app.waitFor(`document.getElementById('theirPublicKey')`);
            await app.type('#theirPublicKey', key);
            await app.click('#mainContent #addFriendButton');
            // The sidebar stays visible; wait for the form to close
            await app.waitFor(`!document.getElementById('theirPublicKey')`);
        },

        /**
         * Wait for a friend request in the sidebar and accept it
         * @param {string} key the sender's public key
         * @param {number} [timeout] milliseconds
         */
        async acceptFriendRequest(key, timeout = 30000) {
            await app.waitFor(`document.querySelector(
                ${JSON.stringify(pendingItem(key))})`, timeout);
            await app.click(pendingItem(key) + ' .acceptRequest');
            await app.waitFor(`document.querySelector(
                ${JSON.stringify(sidebarItem(key))})`);
        },

        /**
         * Wait until a friend is listed with the given name
         * @param {string} key their public key
         * @param {string} displayName their name
         * @param {number} [timeout] milliseconds
         */
        async waitForFriend(key, displayName, timeout = 30000) {
            await app.waitFor(`document.querySelector(
                ${JSON.stringify(sidebarItem(key) + ' .name')})
                ?.textContent === ${JSON.stringify(displayName)}`, timeout);
        },

        /**
         * Open the chat with a friend
         * @param {string} key their public key
         */
        async openChat(key) {
            await app.click(sidebarItem(key));
            // The composer is always in the page; data-chat is set once the
            // chat has loaded and the send button is wired to this friend
            await app.waitFor(`document.getElementById('messageComposer')
                ?.dataset.chat === ${JSON.stringify(key)}`);
        },

        /**
         * Type and send a message in the open chat
         * @param {string} text the message
         */
        async send(text) {
            await app.type('#messageComposer textarea', text);
            await app.click('#messageComposer .send');
        },

        /**
         * The messages shown in the open chat, oldest first
         * @return {Array} [{type: 'sent'|'received', text}]
         */
        async messages() {
            return app.evaluate(`[...document.querySelectorAll(
                '#messageReader > div')].reverse().map((div) => ({
                    type: div.className === 'sentMessage' ? 'sent' :
                        'received',
                    text: div.firstChild.textContent,
                }))`);
        },

        /**
         * Wait until the open chat shows a received message
         * @param {string} text the message
         * @param {number} [timeout] milliseconds
         */
        async waitForMessage(text, timeout = 30000) {
            await app.waitFor(`[...document.querySelectorAll(
                '#messageReader .receivedMessage')].some((div) =>
                div.firstChild.textContent === ${JSON.stringify(text)})`,
            timeout);
        },
    });
}

/**
 * Launch a network of apps
 * @param {Object} options
 * @param {string} options.transport 'dht', 'lan' or 'dht,lan'
 * @param {Array} options.peers peer names, for example ['alice', 'bob']
 * @return {Object} {peers: {name: handle}, step(text), saveArtifacts(label),
 * close()}
 */
export async function launchNetwork(options) {
    const names = options.peers;
    const transports = options.transport.split(',');
    const steps = [];
    const step = (text) => steps.push(`${new Date().toISOString()} ${text}`);
    const env = {HEXHOOT_TRANSPORTS: options.transport};

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
    const close = async () => {
        await Promise.allSettled(Object.values(peers).map((p) => p.close()));
        await testnet?.destroy();
    };
    try {
        const apps = await Promise.all(names.map((name, i) => launchApp({
            name,
            env: Object.assign({}, env, ports.length ? {
                HEXHOOT_LAN_PORT: String(ports[i]),
                HEXHOOT_LAN_PEERS: ports.filter((_, j) => j !== i)
                    .map((port) => '127.0.0.1:' + port).join(),
            } : {}),
        }).then((app) => {
            peers[name] = app;
            return app;
        })));
        apps.forEach((app) => addActions(app, names.length - 1));
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
