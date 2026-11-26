/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// The recovery phrase: 256 bits of entropy as 24 words, encoded exactly as
// BIP-39 does (11 bits per word, the last 8 bits a SHA-256 checksum), so the
// published BIP-39 vectors apply. Only the encoding is BIP-39; the identity
// seed comes from HKDF (Identity.js), not BIP-39's PBKDF2 seed.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {CryptoError} = require('./primitives');

const wordlistFile = path.join(__dirname, 'wordlists', 'bip39-english.txt');
const wordlistSha256 =
    '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda';
const entropyBytes = 32;
const wordCount = 24;

let words = null;

/**
 * The BIP-39 English word list, checked against its published hash
 * @return {Array} 2048 words
 */
function wordlist() {
    if (!words) {
        const text = fs.readFileSync(wordlistFile);
        const hash = crypto.createHash('sha256').update(text).digest('hex');
        if (hash !== wordlistSha256) {
            throw new CryptoError('CORRUPT', 'The word list was modified');
        }
        words = text.toString('utf8').trim().split('\n');
    }
    return words;
}

/**
 * @param {Buffer} entropy 32 bytes
 * @return {string} 24 words separated by single spaces
 */
function entropyToPhrase(entropy) {
    if (!Buffer.isBuffer(entropy) || entropy.length !== entropyBytes) {
        throw new CryptoError('BAD_PARAMS', 'Entropy must be 32 bytes');
    }
    const list = wordlist();
    const checksum = crypto.createHash('sha256').update(entropy).digest()[0];
    const bits = [...entropy, checksum]
        .map((byte) => byte.toString(2).padStart(8, '0')).join('');
    const result = [];
    for (let i = 0; i < wordCount; i++) {
        result.push(list[parseInt(bits.slice(i * 11, i * 11 + 11), 2)]);
    }
    return result.join(' ');
}

/**
 * Decode a phrase as typed: case, extra spaces and line breaks are ignored
 * @param {string} phrase the recovery phrase
 * @return {Buffer} 32 bytes of entropy
 * @throws {CryptoError} BAD_PHRASE, with 'word' set for an unknown word
 */
function phraseToEntropy(phrase) {
    const list = wordlist();
    const given = String(phrase).normalize('NFKD').toLowerCase().trim()
        .split(/\s+/).filter(Boolean);
    if (given.length !== wordCount) {
        throw new CryptoError('BAD_PHRASE',
            `A recovery phrase has ${wordCount} words, not ${given.length}`);
    }
    let bits = '';
    for (const word of given) {
        const index = list.indexOf(word);
        if (index === -1) {
            const err = new CryptoError('BAD_PHRASE',
                `"${word}" is not in the word list`);
            err.word = word;
            throw err;
        }
        bits += index.toString(2).padStart(11, '0');
    }
    const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
    const entropy = bytes.subarray(0, entropyBytes);
    const checksum = crypto.createHash('sha256').update(entropy).digest()[0];
    if (checksum !== bytes[entropyBytes]) {
        throw new CryptoError('BAD_PHRASE',
            'The recovery phrase is mistyped (checksum mismatch)');
    }
    return Buffer.from(entropy);
}

module.exports = {entropyToPhrase, phraseToEntropy, wordlist};
