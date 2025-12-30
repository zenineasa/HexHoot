/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

import * as crypto from 'crypto';
import ecdh = require('ecdh');

/**
 * Define the curve that we are using for encryption
 * @return {*} the curve
 */
export function getECDHCurve() {
    return ecdh.getCurve('secp128r1');
}

/**
 * Define the algorithm that we use to encrypt and decrypt messages, which is
 * available in 'crypto' library.
 * @return {string} the name of the algorithm
 */
export function getEncryptionAlgorithm() {
    return 'aes-256-cbc';
}

/**
 * Generate IV, which is something like a salt that helps in preventing
 * dictionary attacks
 * @return {Buffer} iv
 */
export function generateIV() {
    return crypto.randomBytes(16);
}

/**
 * Generate a new private key. Generate a random one if no argument is given;
 * otherwise create something off of SHA256 hashing.
 * @param {object} info an optional structure containing username and password
 * @return {string} a 32 character string depicting a private key
 */
export function generatePrivateKey(info?: { username: string, password: string }) {
    // If no argument, return a random private key
    if (info === undefined) {
        const newKey = ecdh.generateKeys(getECDHCurve());
        return newKey.privateKey.buffer.toString('hex');
    }

    // Create a SHA256 hash and take the first 32 elements
    const saltPrefix = 'ഉപ്പിലിട്ട'; // 'Uppilitta' (Pickled) in Malayalam
    const saltSuffix = 'പാസ്സ്‌വേർഡ്'; // 'Password' in Malayalam
    const separator = '√';
    const hash = crypto.createHash('sha256');
    hash.update(
        saltPrefix + info.password + separator + info.username + saltSuffix
    );
    return hash.digest('hex').substring(32);
}

/**
 * Convert the channel name from string format to buffer format
 * @param {string} channelName the channel name in string format
 * @return {Buffer} the channel name in buffer format
 */
export function stringToBuffer(channelName: string) {
    return Buffer.from(channelName, 'hex');
}

/**
 * Convert the channel name from buffer format to string format
 * @param {Buffer} buffer the channel name in buffer format
 * @return {string} the channel name in string format
 */
export function bufferToString(buffer: Buffer) {
    return buffer.toString('hex');
}

/**
 * Get private key handle from string private key
 * @param {string} privateKeyString private key of a user
 * @return {PrivateKey} Private key object handle
 */
export function getPrivateKeyHandle(privateKeyString: string) {
    return ecdh.PrivateKey.fromBuffer(
        getECDHCurve(),
        Buffer.from(privateKeyString, 'hex'),
    );
}

/**
 * Get public key handle from string private key
 * @param {string} publicKeyString public key of a user
 * @return {PublicKey} Public key object handle
 */
export function getPublicKeyHandle(publicKeyString: string) {
    return ecdh.PublicKey.fromBuffer(
        getECDHCurve(),
        Buffer.from(publicKeyString, 'hex'),
    );
}

/**
 * Get public key string from private key string
 * @param {string} privateKeyString private key of a user
 * @return {string} public key corresponding to private key
 */
export function getPublicKeyFromPrivateKey(privateKeyString: string) {
    return getPrivateKeyHandle(privateKeyString)
        .derivePublicKey().buffer.toString('hex');
}

/**
 * Get shared key string from private key of one user and public key of another
 * user
 * @param {string} privateKeyString private key of a user
 * @param {string} publicKeyString public key of a user
 * @return {string} shared key (public type) from elliptic curve key exchange
 */
export function getSharedKey(privateKeyString: string, publicKeyString: string) {
    const privateSharedKeyString = getPrivateKeyHandle(privateKeyString)
        .deriveSharedSecret(getPublicKeyHandle(publicKeyString))
        .toString('hex');
    return getPublicKeyFromPrivateKey(privateSharedKeyString);
}

/**
 * Encrypt a message using a shared key.
 * @param {string} messageString message in string format
 * @param {string} sharedKeyString shared key in string format
 * @return {Array} [encrypted message, iv]
 */
export function encryptMessage(messageString: string, sharedKeyString: string): [string, Buffer] {
    const algorithm = getEncryptionAlgorithm();
    const sharedKey = stringToBuffer(sharedKeyString);
    const iv = generateIV();

    const cipher = crypto.createCipheriv(algorithm, sharedKey, iv);
    let encrypted = cipher.update(messageString);
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    return [encrypted.toString('hex'), iv];
}
/**
 * Decrypt a message using a shared key.
 * @param {string} encryptedString message that is encrypted
 * @param {string} sharedKeyString shared key in string format
 * @param {Buffer} iv the 'iv'
 * @return {string} decrpyted message
 */
export function decryptMessage(encryptedString: string, sharedKeyString: string, iv: Buffer) {
    const algorithm = getEncryptionAlgorithm();
    const sharedKey = stringToBuffer(sharedKeyString);

    const decipher = crypto.createDecipheriv(algorithm, sharedKey, iv);
    let decrypted = decipher.update(Buffer.from(encryptedString, 'hex'));
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString();
}

/**
 * Sign a message using private key
 * @param {string} message message that need to be signed
 * @param {string} privateKeyString private key of a user
 * @return {string} signature
 */
export function signMessage(message: string, privateKeyString: string) {
    const algorithm = 'sha512'; // utils.getEncryptionAlgorithm();
    const privateKey = getPrivateKeyHandle(privateKeyString);

    const hashedMessage = crypto.createHash(algorithm)
        .update(Buffer.from(message)).digest();
    const signature = privateKey.sign(hashedMessage, algorithm);

    return signature.toString('hex');
}
/**
 * Verify the signature for a message using public key
 * @param {string} message message was signed
 * @param {string} signature signature corresponding to the message
 * @param {string} publicKeyString public key of a user
 * @return {boolean} whether the signature if valid or not
 */
export function verifySignature(message: string, signature: string, publicKeyString: string) {
    const algorithm = 'sha512'; // utils.getEncryptionAlgorithm();
    const publicKey = getPublicKeyHandle(publicKeyString);

    const hashedMessage = crypto.createHash(algorithm)
        .update(Buffer.from(message)).digest();
    return publicKey.verifySignature(hashedMessage, signature);
}
