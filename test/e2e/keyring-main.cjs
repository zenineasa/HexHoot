/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Electron main-process script for keyring.e2e.mjs: creates, reopens and
// unlocks a keyring with the real safeStorage, then prints one JSON line.
// Usage: electron keyring-main.cjs <dir> --use-mock-keychain

const {app, safeStorage} = require('electron');
const path = require('node:path');
const Keyring = require('../../modules/Crypto/Keyring');
const createSealer = require('../../modules/Main/sealer');

const dir = process.argv[process.argv.indexOf(__filename) + 1];
app.setPath('userData', dir);

app.whenReady().then(async () => {
    const result = {};
    try {
        const sealer = createSealer(safeStorage);
        result.status = await sealer.status();
        const options = {file: path.join(dir, 'keyring.json'), sealer,
            // A passphrase is only required when the OS keyring is weak
            passphrase: result.status.strong ? undefined : 'a passphrase',
            scryptParams: {N: 2 ** 14, r: 8, p: 1}};
        const keyring = await Keyring.create(options);
        result.unlockers = keyring.info().unlockers;
        const blob = keyring.cipher('db').encrypt('Chat', 1, 'hello');
        keyring.lock();

        const reopened = Keyring.open(options);
        await reopened.unlock(result.status.strong ? {} :
            {passphrase: options.passphrase});
        result.decrypted = reopened.cipher('db').decrypt('Chat', 1, blob)
            .toString();
    } catch (err) {
        result.error = err.code + ': ' + err.message;
    }
    process.stdout.write(JSON.stringify(result) + '\n');
    app.exit(0);
});
