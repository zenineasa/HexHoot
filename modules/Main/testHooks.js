/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Settings for automated tests (test/e2e). They apply only when the app is
// started from source with --interaction-test; packaged builds ignore them.
// The orchestrator (test/e2e/orchestrator.mjs) sets them for each peer.

/**
 * Parse a "host:port" string
 * @param {string} address the address
 * @return {Object} {host, port}
 */
function parseAddress(address) {
    const colon = address.lastIndexOf(':');
    const port = Number(address.slice(colon + 1));
    if (colon < 1 || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Invalid address in test settings: ' + address);
    }
    return {host: address.slice(0, colon), port: port};
}

/**
 * Split a comma-separated list
 * @param {string} value the list
 * @return {Array} the non-empty items
 */
function list(value) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * @param {Electron.App} app the app
 * @return {Object} overrides for Core's configuration, or {} if inactive
 */
module.exports = function testHooks(app) {
    if (app.isPackaged || !process.argv.includes('--interaction-test')) {
        return {};
    }
    const env = process.env;
    const overrides = {};
    // HEXHOOT_TRANSPORTS: 'dht', 'lan', 'dht,lan', or 'none'
    if (env.HEXHOOT_TRANSPORTS !== undefined) {
        overrides.transports = list(env.HEXHOOT_TRANSPORTS)
            .filter((name) => name === 'dht' || name === 'lan');
    }
    // HEXHOOT_DHT_BOOTSTRAP: "host:port,..." of a testnet, so tests never
    // touch the public DHT
    if (env.HEXHOOT_DHT_BOOTSTRAP) {
        overrides.dhtBootstrap = list(env.HEXHOOT_DHT_BOOTSTRAP)
            .map(parseAddress);
    }
    // HEXHOOT_LAN_PORT: the LAN carrier's port (0 for any free port)
    if (env.HEXHOOT_LAN_PORT !== undefined) {
        const port = Number(env.HEXHOOT_LAN_PORT);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
            throw new Error('Invalid HEXHOOT_LAN_PORT');
        }
        overrides.lanPort = port;
    }
    // HEXHOOT_LAN_PEERS: "host:port,..." instead of the ping and ARP sweep
    if (env.HEXHOOT_LAN_PEERS !== undefined) {
        overrides.lanPeers = list(env.HEXHOOT_LAN_PEERS);
        overrides.lanPeers.forEach(parseAddress);
    }
    return overrides;
};
