/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Entry point of the Core utilityProcess. The main process sends one 'init'
// message with the configuration, then one 'connect' message with a
// MessagePort for each renderer. Renderers call Core methods over their port:
//   request:  {id, method, args}
//   response: {id, result} or {id, error, code, problems}
//   event:    {event: {...}}
// safeStorage only works in the main process, so the OS keyring is reached
// through it: {type: 'sealer', id, op, data} -> {type: 'sealer-result', id,
// result | error}.

const path = require('node:path');
const Core = require('./index');
const EncryptedStore = require('./EncryptedStore');
const DhtCarrier = require('../Protocol/DhtCarrier');
const LanCarrier = require('../Protocol/LanCarrier');
const {rendererMethods} = require('./constants.mjs');

let core = null;
let ready = null;
let nextSealerId = 1;
const sealerCalls = new Map();

/**
 * Ask the main process to run a safeStorage operation
 * @param {string} op 'status', 'seal' or 'unseal'
 * @param {*} [data] its argument
 * @return {Promise<*>} the result
 */
function callSealer(op, data) {
    const id = nextSealerId++;
    return new Promise((resolve, reject) => {
        sealerCalls.set(id, {resolve, reject});
        process.parentPort.postMessage({type: 'sealer', id, op, data});
    });
}

const sealer = {
    status: () => callSealer('status'),
    seal: async (text) => Buffer.from(await callSealer('seal', text)),
    unseal: (sealed) => callSealer('unseal', new Uint8Array(sealed)),
};

/**
 * Create and start Core
 * @param {Object} config from the main process
 * @param {string} config.userData directory for the database and keyring
 * @param {Array} [config.transports] 'dht' and/or 'lan'; both by default
 * @param {Array} [config.dhtBootstrap] DHT bootstrap nodes
 * @param {number} [config.lanPort] first LAN port to try
 * @param {Array} [config.lanPeers] static LAN peers ("host:port")
 * @param {Object} [config.scryptParams] tests only (testHooks.js)
 */
async function init(config) {
    const enabled = config.transports || ['dht', 'lan'];
    core = new Core({
        store: new EncryptedStore(path.join(config.userData,
            'HexHoot2.sqlite')),
        keyringFile: path.join(config.userData, 'keyring.json'),
        sealer,
        scryptParams: config.scryptParams,
        watchNetwork: true,
        carriers: () => [
            ...enabled.includes('dht') ?
                [new DhtCarrier({bootstrap: config.dhtBootstrap})] : [],
            ...enabled.includes('lan') ?
                [new LanCarrier({port: config.lanPort,
                    peers: config.lanPeers})] : [],
        ],
    });
    await core.start();
}

/**
 * Serve one renderer
 * @param {MessagePortMain} port the renderer's port
 */
function connect(port) {
    const unsubscribe = core.onEvent((event) => port.postMessage({event}));
    port.on('close', unsubscribe);
    port.on('message', async ({data}) => {
        const {id, method, args} = data || {};
        try {
            await ready;
            if (!rendererMethods.includes(method) || !Array.isArray(args)) {
                throw new Error('Unknown method: ' + method);
            }
            const result = await core[method](...args);
            port.postMessage({id, result});
        } catch (err) {
            port.postMessage({id, error: err.message, code: err.code,
                problems: err.problems});
        }
    });
    port.start();
}

process.parentPort.on('message', ({data, ports}) => {
    if (data.type === 'init' && !ready) {
        ready = init(data.config);
        ready.catch((err) => {
            console.error('Core failed to start:', err);
            process.exit(1);
        });
    } else if (data.type === 'connect' && ready && ports.length === 1) {
        connect(ports[0]);
    } else if (data.type === 'sealer-result' && sealerCalls.has(data.id)) {
        const {resolve, reject} = sealerCalls.get(data.id);
        sealerCalls.delete(data.id);
        if (data.error) {
            reject(new Error(data.error));
        } else {
            resolve(data.result);
        }
    }
});
