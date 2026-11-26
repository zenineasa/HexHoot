/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Wire protocol v2 (docs/design/wire-protocol-v2.md): framing, the outer
// envelope, and the padded inner message that the ratchet encrypts.
//
//   frame    = u32be length ‖ envelope                  (Hyperswarm streams)
//   envelope = 0x02 (version) ‖ kind (1) ‖ to (32) ‖ body
//   kind     1 HS1   to = the responder's topic          body = M1
//            2 HS2   to = sid_A                          body = M2
//            3 HS3   to = sid_A                          body = M3
//            4 MSG   to = session tag                    body = ratchet message
//            5 RESET to = session tag of a lost session  body empty
//   inner    = u32be json length ‖ JSON {id, ts, type, body} ‖ zero padding
//              to the Padmé size of the whole, at least 1 KiB
//
// No identity or fingerprint is ever outside the encryption: "to" is a
// topic, a random handshake id, or a tag derived from the session.

const crypto = require('node:crypto');
const {CryptoError, encodeParts} = require('../Crypto/primitives');

const version = 2;
const kinds = Object.freeze({hs1: 1, hs2: 2, hs3: 3, msg: 4, reset: 5});
const toBytes = 32;
const maxFrameBytes = 1024 * 1024;
const minPaddedBytes = 1024;
const innerTypes = Object.freeze(['hello', 'receipt', 'chat',
    'friend_request', 'friend_accept', 'profile']);

/**
 * @param {number} kind one of kinds
 * @param {Buffer} to 32 bytes
 * @param {Buffer} body the body
 * @return {Buffer} the envelope
 */
function encodeEnvelope(kind, to, body) {
    if (!Object.values(kinds).includes(kind) || to.length !== toBytes) {
        throw new CryptoError('BAD_PARAMS', 'Invalid envelope');
    }
    const envelope = Buffer.concat([Buffer.from([version, kind]), to, body]);
    if (envelope.length > maxFrameBytes) {
        throw new CryptoError('BAD_PARAMS', 'Envelope too large');
    }
    return envelope;
}

/**
 * Parse an envelope; anything unexpected gives null (dropped, never thrown,
 * finding T3)
 * @param {Buffer} envelope received bytes
 * @return {Object|null} {kind, to, body}
 */
function decodeEnvelope(envelope) {
    if (!Buffer.isBuffer(envelope) || envelope.length < 2 + toBytes ||
        envelope.length > maxFrameBytes || envelope[0] !== version ||
        !Object.values(kinds).includes(envelope[1])) {
        return null;
    }
    return {kind: envelope[1], to: envelope.subarray(2, 2 + toBytes),
        body: envelope.subarray(2 + toBytes)};
}

/**
 * @param {Buffer} envelope the envelope
 * @return {Buffer} u32be length ‖ envelope
 */
function encodeFrame(envelope) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(envelope.length);
    return Buffer.concat([length, envelope]);
}

/**
 * Splits a byte stream into frames (finding T5)
 */
class FrameDecoder {
    /**
     * @param {function} onFrame called with each envelope
     */
    constructor(onFrame) {
        this.onFrame = onFrame;
        this.buffer = Buffer.alloc(0);
    }

    /**
     * @param {Buffer} chunk received bytes
     * @throws {CryptoError} BAD_MESSAGE for a frame over the size limit;
     * the caller closes the connection
     */
    push(chunk) {
        this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) :
            Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 4) {
            const length = this.buffer.readUInt32BE(0);
            if (length > maxFrameBytes) {
                this.buffer = Buffer.alloc(0);
                throw new CryptoError('BAD_MESSAGE', 'Frame too large');
            }
            if (this.buffer.length < 4 + length) {
                return;
            }
            const envelope = this.buffer.subarray(4, 4 + length);
            this.buffer = this.buffer.subarray(4 + length);
            this.onFrame(Buffer.from(envelope));
        }
    }
}

/**
 * Padmé (Nikitin et al., "Reducing Metadata Leakage from Encrypted Files
 * and Communication with PURBs", 2019): rounds a length up so that it
 * reveals at most O(log log n) bits, with at most 12% overhead
 * @param {number} length bytes
 * @return {number} the padded length
 */
function padme(length) {
    if (length < 2) {
        return length;
    }
    const e = Math.floor(Math.log2(length));
    const s = Math.floor(Math.log2(e)) + 1;
    const lastBits = e - s;
    const mask = 2 ** lastBits - 1;
    return Math.floor((length + mask) / (mask + 1)) * (mask + 1);
}

/**
 * Build the inner plaintext
 * @param {Object} message {type, body}; id and ts are added if missing
 * @param {function} [now] clock
 * @return {Object} {bytes, id}
 */
function encodeInner(message, now = Date.now) {
    if (!innerTypes.includes(message.type)) {
        throw new CryptoError('BAD_PARAMS', 'Unknown message type');
    }
    const id = message.id || crypto.randomBytes(16).toString('base64url');
    const json = Buffer.from(JSON.stringify({id, ts: message.ts ?? now(),
        type: message.type, body: message.body ?? {}}));
    const size = Math.max(minPaddedBytes, padme(4 + json.length));
    const bytes = Buffer.alloc(size);
    bytes.writeUInt32BE(json.length, 0);
    json.copy(bytes, 4);
    return {bytes, id};
}

/**
 * Parse the inner plaintext; invalid content gives null
 * @param {Buffer} bytes decrypted bytes
 * @return {Object|null} {id, ts, type, body}
 */
function decodeInner(bytes) {
    if (bytes.length < 4) {
        return null;
    }
    const length = bytes.readUInt32BE(0);
    if (length > bytes.length - 4) {
        return null;
    }
    let message;
    try {
        message = JSON.parse(bytes.subarray(4, 4 + length).toString('utf8'));
    } catch (err) {
        return null;
    }
    if (!message || typeof message !== 'object' ||
        typeof message.id !== 'string' || !/^[\w-]{1,64}$/.test(message.id) ||
        !Number.isSafeInteger(message.ts) ||
        !innerTypes.includes(message.type) ||
        typeof message.body !== 'object' || message.body === null ||
        Array.isArray(message.body)) {
        return null;
    }
    return {id: message.id, ts: message.ts, type: message.type,
        body: message.body};
}

/**
 * The routing tag of a session: random-looking, the same on both sides,
 * and unlinkable to the identities
 * @param {Buffer} sessionAd from the handshake
 * @return {Buffer} 32 bytes
 */
function sessionTag(sessionAd) {
    return crypto.createHash('sha512')
        .update(encodeParts('hexhoot/v2/session-tag', sessionAd))
        .digest().subarray(0, 32);
}

module.exports = {
    kinds, innerTypes, maxFrameBytes, encodeEnvelope, decodeEnvelope,
    encodeFrame, FrameDecoder, padme, encodeInner, decodeInner, sessionTag,
};
