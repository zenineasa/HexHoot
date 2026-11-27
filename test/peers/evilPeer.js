/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L4: an adversarial peer. A headless Core that speaks protocol v2 over the
// LAN carrier, plus the means to misbehave: arbitrary message types and
// bodies, raw and malformed frames, replays and tampered envelopes. It runs
// under Electron's Node (ELECTRON_RUN_AS_NODE) as a child of the
// orchestrator, which drives it over the IPC channel:
//
//     → {id, cmd, args}        ← {id, result} or {id, error}
//
// See test/e2e/orchestrator.mjs (startEvilPeer) and evil.e2e.mjs.

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Core = require('../../modules/Core');
const EncryptedStore = require('../../modules/Core/EncryptedStore');
const LanCarrier = require('../../modules/Protocol/LanCarrier');
const wire = require('../../modules/Protocol/wire');
const {fakeSealer, fastScrypt, password} = require('../core/helpers');

/** A LAN carrier that keeps a copy of every envelope it sends */
class RecordingLanCarrier extends LanCarrier {
    /** @param {Object} options see LanCarrier */
    constructor(options) {
        super(options);
        this.sent = [];
    }

    /**
     * @param {string} id "ip:port"
     * @param {Buffer} envelope the envelope
     * @param {boolean} broadcast whether it went to everyone
     * @return {Promise} settles when done
     */
    post(id, envelope, broadcast) {
        this.sent.push({id, envelope: Buffer.from(envelope)});
        return super.post(id, envelope, broadcast);
    }
}

/**
 * The inner plaintext for any type and body (wire.encodeInner without its
 * checks)
 * @param {Object} message {id, ts, type, body}
 * @param {function} now clock
 * @return {Buffer} the padded plaintext
 */
function unchecked(message, now) {
    const json = Buffer.from(JSON.stringify({
        id: message.id,
        ts: message.ts ?? now(), type: message.type, body: message.body}));
    const bytes = Buffer.alloc(Math.max(1024, wire.padme(4 + json.length)));
    bytes.writeUInt32BE(json.length, 0);
    json.copy(bytes, 4);
    return bytes;
}

let core = null;
let lan = null;
let dir = null;
const events = [];

/**
 * POST bytes to every LAN peer as a frame, the way a carrier would
 * @param {Buffer} bytes the body
 * @return {Promise<Array>} the HTTP status codes
 */
function postRaw(bytes) {
    return Promise.all([...lan.staticPeers].map((id) =>
        new Promise((resolve) => {
            const req = http.request('http://' + id + '/frame', {
                method: 'POST',
                headers: {'x-hexhoot-port': String(lan.port),
                    'Content-Length': bytes.length},
            }, (res) => {
                res.resume();
                res.on('end', () => resolve(res.statusCode));
            });
            req.on('error', (err) => resolve(err.code));
            req.end(bytes);
        })));
}

const commands = {
    /**
     * Create the account and go online
     * @param {Object} options {name, lanPort, lanPeers}
     * @return {string} our address
     */
    async start({name, lanPort, lanPeers}) {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexhoot-evil-'));
        lan = new RecordingLanCarrier({port: lanPort, peers: lanPeers});
        core = new Core({
            store: new EncryptedStore(path.join(dir, 'HexHoot2.sqlite')),
            keyringFile: path.join(dir, 'keyring.json'),
            sealer: fakeSealer(),
            scryptParams: fastScrypt,
            log: function() {},
            carriers: () => [lan],
        });
        core.onEvent((event) => events.push(event));
        await core.start();
        await core.writeLoggedInUserInfo({displayName: name, password});
        return core.getMyAddress();
    },

    /**
     * Call a Core method, as the UI would
     * @param {string} method the method
     * @param {...*} args its arguments
     * @return {*} the result
     */
    core(method, ...args) {
        return core[method](...args);
    },

    /**
     * Send any message type with any body through a real session
     * @param {string} address the recipient
     * @param {string} type the message type
     * @param {*} body the body
     */
    async send(address, type, body) {
        // Messenger.send and wire.encodeInner refuse unknown types and
        // bodies; a hostile peer would not. So the item goes straight into
        // the outbox, and is encoded without the checks.
        const messenger = core.messenger;
        const id = crypto.randomBytes(16).toString('base64url');
        messenger.outbox.set(id, {id, address, type, body,
            ts: messenger.now(), sentAt: 0});
        const encodeInner = wire.encodeInner;
        wire.encodeInner = (message, now) =>
            ({bytes: unchecked(message, now), id: message.id});
        try {
            await messenger.withLock(address, () => messenger.flush(address));
        } finally {
            wire.encodeInner = encodeInner;
        }
    },

    /**
     * Forget what is waiting for a receipt: what alice refused is never
     * acknowledged, and would be resent for ever
     */
    async dropOutbox() {
        core.messenger.outbox.clear();
    },

    /** @return {boolean} whether everything sent has been acknowledged */
    outboxEmpty() {
        return core.messenger.outbox.size === 0;
    },

    /** @return {Array} messages from others, as our Core reported them */
    events() {
        return events.filter((event) => event.type === 'message');
    },

    /**
     * Envelopes sent so far
     * @return {Array} [{index, kind, length}]
     */
    sent() {
        return lan.sent.map(({envelope}, index) =>
            ({index, kind: envelope[1], length: envelope.length}));
    },

    /**
     * Send an earlier envelope again
     * @param {number} index from sent()
     * @return {Array} HTTP status codes
     */
    replay(index) {
        return postRaw(lan.sent[index].envelope);
    },

    /**
     * Send an earlier envelope with one byte changed
     * @param {number} index from sent()
     * @param {number} offset the byte; negative counts from the end
     * @return {Array} HTTP status codes
     */
    tamper(index, offset) {
        const bytes = Buffer.from(lan.sent[index].envelope);
        const at = offset < 0 ? bytes.length + offset : offset;
        bytes[at] ^= 0x01;
        return postRaw(bytes);
    },

    /**
     * Send raw bytes as a frame
     * @param {string} base64 the bytes
     * @return {Array} HTTP status codes
     */
    raw(base64) {
        return postRaw(Buffer.from(base64, 'base64'));
    },

    /**
     * Send this many bytes of zeros as a frame
     * @param {number} size bytes
     * @return {Array} HTTP status codes
     */
    oversized(size) {
        return postRaw(Buffer.alloc(size));
    },

    /**
     * Make a plain HTTP request to every LAN peer
     * @param {string} method the method
     * @param {string} url the path
     * @return {Array} [{status, body}]
     */
    request(method, url) {
        return Promise.all([...lan.staticPeers].map((id) =>
            new Promise((resolve) => {
                const req = http.request('http://' + id + url, {method,
                    headers: {'Content-Length': 0}}, (res) => {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => resolve({status: res.statusCode,
                        body}));
                });
                req.on('error', (err) => resolve({status: err.code}));
                req.end();
            })));
    },

    /** Go offline and remove our files */
    async stop() {
        await core?.stop();
        if (dir) {
            fs.rmSync(dir, {recursive: true, force: true,
                maxRetries: 10});
        }
        setImmediate(() => process.exit(0));
    },
};

process.on('message', async ({id, cmd, args}) => {
    try {
        const result = await commands[cmd](...args);
        process.send({id, result: result === undefined ? null : result});
    } catch (err) {
        process.send({id, error: String(err?.stack || err)});
    }
});
