/* Copyright (c) 2022-2023 Zenin Easa Panthakkalakath */

const ecdh = require('ecdh');
const crypto = require('crypto');

// This shall be exported.
const utils = [];

/**
 * Define the curve that we are using for encryption
 * @return {*} the curve
 */
utils.getECDHCurve = function() {
    return ecdh.getCurve('secp128r1');
};

/**
 * Define the algorithm that we use to encrypt and decrypt messages, which is
 * available in 'crypto' library.
 * @return {string} the name of the algorithm
 */
utils.getEncryptionAlgorithm = function() {
    return 'aes-256-cbc';
};

/**
 * Generate IV, which is something like a salt that helps in preventing
 * dictionary attacks
 * @return {Buffer} iv
 */
utils.generateIV = function() {
    return crypto.randomBytes(16);
};

/**
 * Generate a new private key.
 * @return {string} a 32 character string depicting a private key
 */
utils.generatePrivateKey = function() {
    const newKey = ecdh.generateKeys(utils.getECDHCurve());
    return newKey.privateKey.buffer.toString('hex');
};

/**
 * Convert the channel name from string format to buffer format
 * @param {string} channelName the channel name in string format
 * @return {Buffer} the channel name in buffer format
 */
utils.stringToBuffer = function(channelName) {
    return Buffer.from(channelName, 'hex');
};

/**
 * Convert the channel name from buffer format to string format
 * @param {Buffer} buffer the channel name in buffer format
 * @return {string} the channel name in string format
 */
utils.bufferToString = function(buffer) {
    return buffer.toString('hex');
};

/**
 * Get private key handle from string private key
 * @param {string} privateKeyString private key of a user
 * @return {PrivateKey} Private key object handle
 */
utils.getPrivateKeyHandle = function(privateKeyString) {
    return ecdh.PrivateKey.fromBuffer(
        utils.getECDHCurve(),
        Buffer.from(privateKeyString, 'hex'),
    );
};

/**
 * Get public key handle from string private key
 * @param {string} publicKeyString public key of a user
 * @return {PublicKey} Public key object handle
 */
utils.getPublicKeyHandle = function(publicKeyString) {
    return ecdh.PublicKey.fromBuffer(
        utils.getECDHCurve(),
        Buffer.from(publicKeyString, 'hex'),
    );
};

/**
 * Get public key string from private key string
 * @param {string} privateKeyString private key of a user
 * @return {string} public key corresponding to private key
 */
utils.getPublicKeyFromPrivateKey = function(privateKeyString) {
    return utils.getPrivateKeyHandle(privateKeyString)
        .derivePublicKey().buffer.toString('hex');
};

/**
 * Get shared key string from private key of one user and public key of another
 * user
 * @param {string} privateKeyString private key of a user
 * @param {string} publicKeyString public key of a user
 * @return {string} shared key (public type) from elliptic curve key exchange
 */
utils.getSharedKey = function(privateKeyString, publicKeyString) {
    const privateSharedKeyString = utils.getPrivateKeyHandle(privateKeyString)
        .deriveSharedSecret(utils.getPublicKeyHandle(publicKeyString))
        .toString('hex');
    return utils.getPublicKeyFromPrivateKey(privateSharedKeyString);
};

/**
 * Encrypt a message using a shared key.
 * @param {string} messageString message in string format
 * @param {string} sharedKeyString shared key in string format
 * @return {string} encrypted message
 * @return {Buffer} iv
 */
utils.encryptMessage = function(messageString, sharedKeyString) {
    const algorithm = utils.getEncryptionAlgorithm();
    const sharedKey = utils.stringToBuffer(sharedKeyString);
    const iv = utils.generateIV();

    const cipher = crypto.createCipheriv(algorithm, sharedKey, iv);
    let encrypted = cipher.update(messageString);
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    return [encrypted.toString('hex'), iv];
};
/**
 * Decrypt a message using a shared key.
 * @param {string} encryptedString message that is encrypted
 * @param {string} sharedKeyString shared key in string format
 * @param {Buffer} iv the 'iv'
 * @return {string} decrpyted message
 */
utils.decryptMessage = function(encryptedString, sharedKeyString, iv) {
    const algorithm = utils.getEncryptionAlgorithm();
    const sharedKey = utils.stringToBuffer(sharedKeyString);

    const decipher = crypto.createDecipheriv(algorithm, sharedKey, iv);
    let decrypted = decipher.update(Buffer.from(encryptedString, 'hex'));
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString();
};

/**
 * Sign a message using private key
 * @param {string} message message that need to be signed
 * @param {string} privateKeyString private key of a user
 * @return {string} signature
 */
utils.signMessage = function(message, privateKeyString) {
    const algorithm = 'sha512'; // utils.getEncryptionAlgorithm();
    const privateKey = utils.getPrivateKeyHandle(privateKeyString);

    const hashedMessage = crypto.createHash(algorithm)
        .update(Buffer.from(message)).digest();
    const signature = privateKey.sign(hashedMessage, algorithm);

    return signature.toString('hex');
};
/**
 * Verify the signature for a message using public key
 * @param {string} message message was signed
 * @param {string} signature signature corresponding to the message
 * @param {string} publicKeyString public key of a user
 * @return {boolean} whether the signature if valid or not
 */
utils.verifySignature = function(message, signature, publicKeyString) {
    const algorithm = 'sha512'; // utils.getEncryptionAlgorithm();
    const publicKey = utils.getPublicKeyHandle(publicKeyString);

    const hashedMessage = crypto.createHash(algorithm)
        .update(Buffer.from(message)).digest();
    return publicKey.verifySignature(hashedMessage, signature);
};

module.exports = utils;
