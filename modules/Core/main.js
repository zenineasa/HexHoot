/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Entry point of the Core utilityProcess. The main process sends one 'init'
// message with the configuration, then one 'connect' message with a
// MessagePort for each renderer. Renderers call Core methods over their port:
//   request:  {id, method, args}
//   response: {id, result} or {id, error}
//   event:    {event: {...}}

const path = require('path');
const Core = require('./index');
const Storage = require('./Storage');
const DhtTransport = require('./DhtTransport');
const LanTransport = require('./LanTransport');
const {rendererMethods} = require('./constants');

let core = null;
let ready = null;

/**
 * Create and start Core
 * @param {Object} config from the main process
 * @param {string} config.userData directory for the database
 * @param {string} config.version app version
 * @param {Array} [config.transports] 'dht' and/or 'lan'; both by default
 * @param {Array} [config.dhtBootstrap] DHT bootstrap nodes
 * @param {number} [config.lanPort] first LAN port to try
 * @param {Array} [config.lanPeers] static LAN peers ("host:port")
 */
async function init(config) {
    const enabled = config.transports || ['dht', 'lan'];
    const transports = [];
    if (enabled.includes('dht')) {
        transports.push(new DhtTransport({bootstrap: config.dhtBootstrap}));
    }
    if (enabled.includes('lan')) {
        transports.push(new LanTransport({
            port: config.lanPort,
            peers: config.lanPeers,
            version: config.version,
        }));
    }
    core = new Core({
        storage: new Storage(path.join(config.userData, 'HexHoot.sqlite')),
        transports: transports,
        watchNetwork: true,
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
            port.postMessage({id, error: err.message});
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
    }
});
