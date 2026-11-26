/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Values computed from identity fingerprints: the address (friend code),
// the safety number and the rendezvous topic. See
// docs/design/identity-and-addresses.md.
//
// The address is Bech32m (BIP-350) with the prefix "hh2": "hh21" + 52 data
// characters + 6 checksum characters, 62 in all. Bech32m is guaranteed to
// detect up to 4 mistyped characters, and its alphabet leaves out 1, b, i
// and o, which are easily confused.

const crypto = require('node:crypto');
const {CryptoError, encodeParts, hkdf} = require('./primitives');

const charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const bech32mConst = 0x2bc830a3;
const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd,
    0x2a1462b3];
const addressPrefix = 'hh2';
const fingerprintBytes = 32;

/**
 * @param {Array} values 5-bit values
 * @return {number} the BCH checksum state
 */
function polymod(values) {
    let chk = 1;
    for (const value of values) {
        const top = chk >>> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ value;
        for (let i = 0; i < 5; i++) {
            if ((top >>> i) & 1) {
                chk ^= generator[i];
            }
        }
    }
    return chk >>> 0;
}

/**
 * @param {string} hrp human-readable part
 * @return {Array} its expansion for the checksum
 */
function expandPrefix(hrp) {
    const codes = [...hrp].map((c) => c.charCodeAt(0));
    return [...codes.map((c) => c >> 5), 0, ...codes.map((c) => c & 31)];
}

/**
 * Bech32m encoding
 * @param {string} hrp lowercase human-readable part
 * @param {Array} data 5-bit values
 * @return {string} the encoded string
 */
function bech32mEncode(hrp, data) {
    const mod = polymod([...expandPrefix(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^
        bech32mConst;
    const checksum = [0, 1, 2, 3, 4, 5].map((i) =>
        (mod >>> (5 * (5 - i))) & 31);
    return hrp + '1' + [...data, ...checksum].map((v) => charset[v]).join('');
}

/**
 * Bech32m decoding, as BIP-350 specifies it
 * @param {string} text the string; all upper or all lower case
 * @return {Object} {hrp, data (5-bit values, without the checksum)}
 * @throws {CryptoError} BAD_ADDRESS
 */
function bech32mDecode(text) {
    const fail = (why) => {
        throw new CryptoError('BAD_ADDRESS', why);
    };
    if (text.length > 90) {
        fail('Too long');
    }
    if ([...text].some((c) => c.charCodeAt(0) < 33 ||
        c.charCodeAt(0) > 126)) {
        fail('Invalid character');
    }
    if (text !== text.toLowerCase() && text !== text.toUpperCase()) {
        fail('Mixed case');
    }
    const lower = text.toLowerCase();
    const separator = lower.lastIndexOf('1');
    if (separator < 1 || separator + 7 > lower.length) {
        fail('Missing prefix or checksum');
    }
    const hrp = lower.slice(0, separator);
    const values = [...lower.slice(separator + 1)].map((c) => {
        const value = charset.indexOf(c);
        if (value === -1) {
            fail(`Invalid character "${c}"`);
        }
        return value;
    });
    if (polymod([...expandPrefix(hrp), ...values]) !== bech32mConst) {
        fail('The address is mistyped (checksum mismatch)');
    }
    return {hrp, data: values.slice(0, -6)};
}

/**
 * Regroup bits, as BIP-173's convertbits does
 * @param {Array} values input values
 * @param {number} from bits per input value
 * @param {number} to bits per output value
 * @param {boolean} pad whether to pad the last output value
 * @return {Array} output values
 */
function convertBits(values, from, to, pad) {
    let acc = 0;
    let bits = 0;
    const out = [];
    const max = (1 << to) - 1;
    for (const value of values) {
        acc = (acc << from) | value;
        bits += from;
        while (bits >= to) {
            bits -= to;
            out.push((acc >> bits) & max);
        }
        acc &= (1 << bits) - 1;
    }
    if (pad) {
        if (bits > 0) {
            out.push((acc << (to - bits)) & max);
        }
    } else if (bits >= from || ((acc << (to - bits)) & max)) {
        throw new CryptoError('BAD_ADDRESS', 'Invalid padding');
    }
    return out;
}

/**
 * @param {Buffer} fingerprint 32 bytes
 * @return {string} the address, "hh21…", 62 characters
 */
function fingerprintToAddress(fingerprint) {
    assertFingerprint(fingerprint);
    return bech32mEncode(addressPrefix,
        convertBits([...fingerprint], 8, 5, true));
}

/**
 * Parse an address as typed or scanned. Spaces are ignored, and the
 * all-upper-case form (compact in QR codes) works too.
 * @param {string} address the address
 * @return {Buffer} the 32-byte fingerprint
 * @throws {CryptoError} BAD_ADDRESS
 */
function addressToFingerprint(address) {
    const {hrp, data} = bech32mDecode(String(address).replace(/\s+/g, ''));
    if (hrp !== addressPrefix || data.length !== 52) {
        throw new CryptoError('BAD_ADDRESS', 'Not a HexHoot address');
    }
    return Buffer.from(convertBits(data, 5, 8, false));
}

/**
 * The safety number two contacts compare out of band. Both sides get the
 * same number, whatever the order of the arguments.
 * @param {Buffer} a a fingerprint
 * @param {Buffer} b the other fingerprint
 * @return {string} 80 digits in 16 groups of 5, separated by spaces
 */
function safetyNumber(a, b) {
    assertFingerprint(a);
    assertFingerprint(b);
    const [first, second] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
    // 5 bytes per group, so the reduction mod 10^5 has negligible bias
    const bytes = hkdf(Buffer.concat([first, second]), Buffer.alloc(0),
        Buffer.from('hexhoot/v2/safety'), 80);
    const groups = [];
    for (let i = 0; i < 80; i += 5) {
        groups.push(String(bytes.readUIntBE(i, 5) % 100000).padStart(5, '0'));
    }
    return groups.join(' ');
}

/**
 * The Hyperswarm topic of an identity. Not the public key (finding T1), but
 * anyone who knows the address can compute it.
 * @param {Buffer} fingerprint 32 bytes
 * @return {Buffer} 32 bytes
 */
function topic(fingerprint) {
    assertFingerprint(fingerprint);
    return crypto.createHash('sha512')
        .update(encodeParts('hexhoot/v2/topic', fingerprint))
        .digest().subarray(0, 32);
}

/** @param {Buffer} fingerprint must be 32 bytes */
function assertFingerprint(fingerprint) {
    if (!Buffer.isBuffer(fingerprint) ||
        fingerprint.length !== fingerprintBytes) {
        throw new CryptoError('BAD_PARAMS', 'A fingerprint is 32 bytes');
    }
}

module.exports = {
    fingerprintToAddress, addressToFingerprint, safetyNumber, topic,
    bech32mEncode, bech32mDecode,
};
