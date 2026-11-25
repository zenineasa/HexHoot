/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Karma runs the UI without the app's main process, so there is no Core
// utilityProcess to connect to. Run Core in this window instead, with
// in-memory storage and no transports, behind the same method allow-list and
// structured cloning as the IPC connection.

const path = require('path');
const root = process.cwd();
const Core = require(path.join(root, 'modules/Core'));
const Storage = require(path.join(root, 'modules/Core/Storage'));
const {rendererMethods} = require(path.join(root, 'modules/Core/constants'));
const dbMessenger = require(path.join(root, 'modules/DBMessenger'));

const core = new Core({storage: new Storage(), log: function() {}});
const started = core.start();

dbMessenger.useConnection({
    call: async function(method, args) {
        await started;
        if (!rendererMethods.includes(method)) {
            throw new Error('Unknown method: ' + method);
        }
        return structuredClone(await core[method](...structuredClone(args)));
    },
    onEvent: function(func) {
        core.onEvent(func);
    },
});
