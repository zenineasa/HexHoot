/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// The OS keyring for the keyring in Core (modules/Crypto/Keyring.js).
// safeStorage only works in the main process, so Core reaches it through
// main. It is strong unless Linux has no secret service (basic_text), in
// which case a passphrase is required.

/**
 * @param {Electron.SafeStorage} safeStorage Electron's safeStorage
 * @param {string} [platform] process.platform
 * @return {Object} a Sealer (see Keyring.js)
 */
module.exports = function createSealer(safeStorage,
    platform = process.platform) {
    return {
        async status() {
            const available = safeStorage.isEncryptionAvailable();
            const backend = {
                darwin: 'keychain',
                win32: 'dpapi',
            }[platform] || (platform === 'linux' ?
                safeStorage.getSelectedStorageBackend() : 'unknown');
            return {available, backend, strong: available &&
                backend !== 'basic_text' && backend !== 'unknown'};
        },
        async seal(text) {
            return safeStorage.encryptString(text);
        },
        async unseal(sealed) {
            return safeStorage.decryptString(sealed);
        },
    };
};
