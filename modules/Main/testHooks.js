/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Settings for automated tests (test/e2e). They apply only when the app is
// started from source with --interaction-test; packaged builds ignore them.
// The orchestrator (test/e2e/orchestrator.mjs) sets them for each peer.

const {parseFaults} = require('../Protocol/faults');

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
    // HEXHOOT_TEST_SCRYPT_N: a cheaper scrypt (for example 16384), so that
    // logging in takes milliseconds instead of seconds. Identities made this
    // way differ from real ones, which is fine for throwaway test accounts.
    if (env.HEXHOOT_TEST_SCRYPT_N) {
        overrides.scryptParams = {N: Number(env.HEXHOOT_TEST_SCRYPT_N), r: 8,
            p: 1};
    }
    // HEXHOOT_TEST_CLOCK_OFFSET_DAYS: Core's clock runs this many days
    // ahead, so a restart can find a password check due
    if (env.HEXHOOT_TEST_CLOCK_OFFSET_DAYS) {
        const days = Number(env.HEXHOOT_TEST_CLOCK_OFFSET_DAYS);
        if (!Number.isFinite(days)) {
            throw new Error('Invalid HEXHOOT_TEST_CLOCK_OFFSET_DAYS');
        }
        overrides.clockOffsetMs = days * 24 * 3600 * 1000;
    }
    // HEXHOOT_TEST_FAULTS: "drop:0.1,dup:0.05,reorder:0.1,delay:0-500"
    // drops, duplicates, reorders and delays what the carriers send
    if (env.HEXHOOT_TEST_FAULTS) {
        overrides.faults = parseFaults(env.HEXHOOT_TEST_FAULTS);
    }
    // HEXHOOT_TEST_RETRY_MS: cap the resend backoff (3 s up to 60 s), so
    // lossy runs (HEXHOOT_TEST_FAULTS) finish quickly
    if (env.HEXHOOT_TEST_RETRY_MS) {
        const ms = Number(env.HEXHOOT_TEST_RETRY_MS);
        if (!Number.isInteger(ms) || ms < 100) {
            throw new Error('Invalid HEXHOOT_TEST_RETRY_MS');
        }
        overrides.retryMs = ms;
    }
    return overrides;
};
