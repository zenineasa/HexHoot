/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Settings for automated tests (test/e2e). They apply only when the app is
// started from source with --interaction-test; packaged builds ignore them.

/**
 * @param {Electron.App} app the app
 * @return {Object} overrides for Core's configuration, or {} if inactive
 */
module.exports = function testHooks(app) {
    if (app.isPackaged || !process.argv.includes('--interaction-test')) {
        return {};
    }
    const overrides = {};
    // HEXHOOT_TRANSPORTS: 'dht', 'lan', 'dht,lan', or 'none'
    if (process.env.HEXHOOT_TRANSPORTS !== undefined) {
        overrides.transports = process.env.HEXHOOT_TRANSPORTS.split(',')
            .filter((name) => name === 'dht' || name === 'lan');
    }
    return overrides;
};
