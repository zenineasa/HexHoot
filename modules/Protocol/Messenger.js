/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// The session layer (docs/design/wire-protocol-v2.md): handshakes, ratchets
// and reliable delivery to contacts by address, over any carriers (DHT,
// LAN, or both). It holds no UI or storage logic: Core supplies a store and
// decides what to do with each message.
//
// Delivery: every message stays in the outbox until the recipient's receipt
// arrives. Unacknowledged messages are sent again with backoff (after
// firstRetryMs, doubling up to retryMs), at once when a carrier sees a peer
// appear, and on every new session; the recipient drops duplicates by id.
// A peer that has lost its session answers with RESET, and a new handshake
// follows.
//
// Safety: a ratchet's new state is saved before anything encrypted with it
// leaves the process, so a crash can never bring back a state that would
// reuse a message key.

const {Initiator, Responder} = require('../Crypto/handshake');
const {Ratchet} = require('../Crypto/Ratchet');
const {CryptoError} = require('../Crypto/primitives');
const addressing = require('../Crypto/address');
const wire = require('./wire');

const appTypes = ['chat', 'friend_request', 'friend_accept',
    'friend_withdraw', 'profile'];
const defaults = Object.freeze({
    // Resend unacknowledged messages after firstRetryMs, then twice as
    // long each time, up to retryMs (open question Q15)
    firstRetryMs: 3000,
    retryMs: 60000,
    peerKickMs: 1000, // at most one "a peer appeared" resend per this
    seenQuietMs: 5 * 60000, // onSeen fires again after this much silence
    handshakeTimeoutMs: 30000,
    simultaneousWindowMs: 60000, // see installSession
    maxPendingResponders: 64,
    maxSeenIds: 10000, // per contact, for dropping duplicates
    // A message whose session is unknown may have overtaken the handshake
    // that creates it (for example over another carrier). It waits this
    // long before the sender is told the session is gone.
    unknownGraceMs: 2000,
    maxParked: 256,
});

/**
 * Sessions and outbox in memory; Core supplies a persistent store with the
 * same methods
 */
class MemoryMessengerStore {
    /** Create an empty store */
    constructor() {
        this.sessions = new Map();
        this.outbox = new Map();
    }

    /** @return {Promise<Array>} [{address, entries}] */
    async loadSessions() {
        return [...this.sessions].map(([address, entries]) =>
            ({address, entries}));
    }

    /**
     * @param {string} address contact
     * @param {Array} entries serialized sessions; empty to delete
     */
    async saveSessions(address, entries) {
        if (entries.length === 0) {
            this.sessions.delete(address);
        } else {
            this.sessions.set(address, JSON.parse(JSON.stringify(entries)));
        }
    }

    /** @return {Promise<Array>} outbox items */
    async loadOutbox() {
        return [...this.outbox.values()];
    }

    /** @param {Object} item an outbox item */
    async putOutboxItem(item) {
        this.outbox.set(item.id, {...item});
    }

    /** @param {string} id item id */
    async deleteOutboxItem(id) {
        this.outbox.delete(id);
    }
}

/**
 * Sends and receives messages for one identity
 */
class Messenger {
    /**
     * @param {Object} options
     * @param {Identity} options.identity our identity
     * @param {Array} options.carriers DhtCarrier, LanCarrier, MemoryCarrier
     * @param {function} [options.authorize] (PublicIdentity) => boolean,
     * asked when someone completes a handshake with us; everyone by default
     * @param {Object} [options.store] see MemoryMessengerStore
     * @param {function} [options.now] clock
     * @param {function} [options.log] logger
     */
    constructor(options) {
        this.identity = options.identity;
        this.carriers = options.carriers || [];
        this.authorize = options.authorize || (() => true);
        this.store = options.store || new MemoryMessengerStore();
        this.now = options.now || Date.now;
        this.log = options.log || function() {};
        // Options left undefined keep their default
        this.options = {...defaults, ...Object.fromEntries(Object.entries(
            options).filter(([, value]) => value !== undefined))};
        this.topic = this.identity.public.topic;

        this.sessions = new Map(); // address -> [entry]; [0] is current
        this.byTag = new Map(); // tag hex -> {address, entry}
        this.initiators = new Map(); // sid_A hex -> {initiator, address, at}
        this.pendingTo = new Map(); // address -> sid_A hex
        this.responders = new Map(); // sid_A hex -> {responder, m2, at}
        this.outbox = new Map(); // id -> item
        this.seen = new Map(); // address -> Set of ids
        this.resetSentAt = new Map(); // tag hex -> ms
        this.parked = []; // [{envelope, key, link, at}]: unknown sessions
        this.locks = new Map(); // key -> Promise
        this.messageHandlers = [];
        this.deliveredHandlers = [];
        this.seenHandlers = [];
        this.lastSeen = new Map(); // address -> {via, at}
    }

    /** Load state, then start listening on our topic */
    async start() {
        for (const {address, entries} of await this.store.loadSessions()) {
            const list = entries.map((e) => ({
                ratchet: Ratchet.deserialize(e.state),
                tag: Buffer.from(e.tag, 'hex'),
                sidA: Buffer.from(e.sidA, 'hex'),
                createdAt: e.createdAt,
                retired: Boolean(e.retired),
            }));
            this.setSessions(address, list);
        }
        for (const item of await this.store.loadOutbox()) {
            this.outbox.set(item.id, {...item, sentAt: 0, attempts: 0});
        }
        for (const carrier of this.carriers) {
            carrier.onFrame((envelope, link) => this.enqueue(link,
                () => this.receive(envelope, link)));
            carrier.onPeer?.(() => this.peerAppeared());
            await carrier.start(this.topic);
        }
        this.timer = setInterval(() => this.tick(),
            Math.max(50, this.retryDelay(0) / 2));
        this.timer.unref?.();
        this.tick();
    }

    /**
     * How long to wait before sending something again
     * @param {number} attempts how often it was sent already
     * @return {number} ms
     */
    retryDelay(attempts) {
        const first = Math.min(this.options.firstRetryMs,
            this.options.retryMs);
        return Math.min(this.options.retryMs,
            first * 2 ** Math.max(0, attempts - 1));
    }

    /**
     * Send everything for a contact again at once, with the backoff reset
     * @param {string} address the contact
     */
    rearm(address) {
        for (const item of this.outbox.values()) {
            if (item.address === address) {
                item.sentAt = 0;
                item.attempts = 0;
            }
        }
    }

    /**
     * A carrier found a peer (a new connection, or a LAN instance saying
     * hello): it may be a contact that was offline, so whatever waits is
     * sent now rather than when its backoff ends
     */
    peerAppeared() {
        const now = this.now();
        if (now - (this.lastKick || 0) < this.options.peerKickMs) {
            return;
        }
        this.lastKick = now;
        const addresses = new Set([...this.outbox.values()]
            .map((item) => item.address));
        for (const address of addresses) {
            this.rearm(address);
            const pending = this.initiators.get(this.pendingTo.get(address));
            if (pending) {
                pending.sentAt = 0;
                pending.attempts = 0;
            }
            this.withLock(address, () => this.flush(address)).catch((err) =>
                this.log('Send failed:', err.message));
        }
    }

    /** Stop the carriers and timers */
    async stop() {
        clearInterval(this.timer);
        await Promise.allSettled(this.carriers.map((c) => c.stop()));
        await Promise.allSettled([...this.locks.values()]);
    }

    /** @param {function} func called with {from, id, ts, type, body} */
    onMessage(func) {
        this.messageHandlers.push(func);
    }

    /** @param {function} func called with {to, id} when a receipt arrives */
    onDelivered(func) {
        this.deliveredHandlers.push(func);
    }

    /**
     * @param {function} func called with {address, via, at} when we hear
     * from a contact over a different carrier, or after a silence
     */
    onSeen(func) {
        this.seenHandlers.push(func);
    }

    /**
     * Remember that an authenticated frame from a contact arrived
     * @param {string} address the contact
     * @param {Object} link the link it came on
     */
    noteSeen(address, link) {
        const now = this.now();
        const via = link?.via || 'unknown';
        const before = this.lastSeen.get(address);
        this.lastSeen.set(address, {via, at: now});
        if (!before || before.via !== via ||
            now - before.at > this.options.seenQuietMs) {
            this.emit(this.seenHandlers, {address, via, at: now});
        }
    }

    /**
     * Take a message out of the outbox, so it is not sent (again). A copy
     * already sent may still arrive.
     * @param {string} id the message id
     * @return {boolean} whether it was still waiting
     */
    async cancel(id) {
        if (!this.outbox.has(id)) {
            return false;
        }
        this.outbox.delete(id);
        await this.store.deleteOutboxItem(id);
        return true;
    }

    /**
     * Forget a contact: sessions, waiting messages and handshakes
     * @param {string} address the contact
     */
    async forget(address) {
        await this.withLock(address, async () => {
            for (const item of [...this.outbox.values()]) {
                if (item.address === address) {
                    await this.cancel(item.id);
                }
            }
            const key = this.pendingTo.get(address);
            if (key) {
                this.initiators.delete(key);
                this.pendingTo.delete(address);
            }
            this.setSessions(address, []);
            await this.saveSessions(address);
            this.seen.delete(address);
            this.lastSeen.delete(address);
        });
    }

    /**
     * Send a message; it is delivered when the contact is reachable
     * @param {string} address the contact's hh21… address
     * @param {string} type 'chat', 'friend_request', 'friend_accept',
     * 'profile'
     * @param {Object} body JSON-safe content
     * @return {Promise<string>} the message id
     */
    async send(address, type, body) {
        addressing.addressToFingerprint(address); // throws BAD_ADDRESS
        if (address === this.identity.address) {
            throw new CryptoError('BAD_PARAMS', 'That is our own address');
        }
        if (!appTypes.includes(type)) {
            throw new CryptoError('BAD_PARAMS', 'Unknown message type');
        }
        const {id} = wire.encodeInner({type, body}); // validates the size
        const item = {id, address, type, body, ts: this.now(), sentAt: 0};
        this.outbox.set(id, item);
        await this.store.putOutboxItem(item);
        await this.withLock(address, () => this.flush(address));
        return id;
    }

    /**
     * @param {string} address a contact
     * @return {Object|null} {safetyNumber, canSend} of the current session
     */
    sessionInfo(address) {
        const entry = this.current(address);
        return entry ? {
            safetyNumber: this.identity.public.safetyNumber(
                entry.ratchet.peer),
            canSend: entry.ratchet.canSend,
        } : null;
    }

    /**
     * Run a function after all earlier ones with the same key
     * @param {*} key lock key (an address, or a link)
     * @param {function} func async work
     * @return {Promise} its result
     */
    withLock(key, func) {
        const previous = this.locks.get(key) || Promise.resolve();
        const next = previous.then(func, func);
        const settled = next.catch(() => {});
        this.locks.set(key, settled);
        settled.then(() => {
            if (this.locks.get(key) === settled) {
                this.locks.delete(key);
            }
        });
        return next;
    }

    /**
     * Process frames from one link in order
     * @param {Object} link the link
     * @param {function} func the work
     */
    enqueue(link, func) {
        this.withLock(link, func).catch((err) =>
            this.log('Dropped a frame:', err.message));
    }

    /** Resend what is due and expire old handshakes */
    tick() {
        const now = this.now();
        for (const [key, pending] of this.initiators) {
            if (now - pending.at > this.options.handshakeTimeoutMs) {
                this.initiators.delete(key);
                if (this.pendingTo.get(pending.address) === key) {
                    this.pendingTo.delete(pending.address);
                }
            }
        }
        for (const [key, pending] of this.responders) {
            if (now - pending.at > this.options.handshakeTimeoutMs) {
                this.responders.delete(key);
            }
        }
        // Parked messages whose session never appeared: tell the sender
        const expired = this.parked.filter((p) =>
            now - p.at > this.options.unknownGraceMs);
        this.parked = this.parked.filter((p) => !expired.includes(p));
        for (const {envelope, key, link} of expired) {
            const last = this.resetSentAt.get(key) || 0;
            if (!this.byTag.has(key) && !link.broadcast &&
                now - last > 60000) {
                this.resetSentAt.set(key, now);
                link.reply(wire.encodeEnvelope(wire.kinds.reset, envelope.to,
                    Buffer.alloc(0)));
            }
        }
        const addresses = new Set([...this.outbox.values()]
            .map((item) => item.address));
        for (const address of addresses) {
            this.withLock(address, () => this.flush(address)).catch((err) =>
                this.log('Send failed:', err.message));
        }
    }

    /**
     * Send what is waiting for a contact, starting a handshake if needed.
     * Call with the contact's lock held.
     * @param {string} address the contact
     * @param {Object} [link] a link to send on, instead of the carriers
     */
    async flush(address, link) {
        const now = this.now();
        const entry = this.current(address);
        const due = [...this.outbox.values()].filter((item) =>
            item.address === address &&
            now - item.sentAt >= this.retryDelay(item.attempts || 0));
        if (entry && entry.ratchet.canSend) {
            if (due.length > 0) {
                const frames = due.map((item) => this.encryptFor(entry,
                    {id: item.id, ts: item.ts, type: item.type,
                        body: item.body}));
                await this.saveSessions(address);
                due.forEach((item) => {
                    item.sentAt = now;
                    item.attempts = (item.attempts || 0) + 1;
                });
                this.transmit(address, frames, link);
            }
            return;
        }
        // A responder waits for the initiator's first message, unless that
        // never came
        const waiting = entry && !entry.ratchet.canSend &&
            now - entry.createdAt < this.options.handshakeTimeoutMs;
        if (due.length === 0 || waiting) {
            return;
        }
        const pending = this.initiators.get(this.pendingTo.get(address));
        if (!pending) {
            this.startHandshake(address);
        } else if (now - pending.sentAt >=
            this.retryDelay(pending.attempts || 1)) {
            // HS1 may have been lost (or reached nobody yet): send the same
            // M1 again; a responder answers a repeat with the same M2
            pending.sentAt = now;
            pending.attempts = (pending.attempts || 1) + 1;
            this.sendHs1(address, pending.envelope);
        }
    }

    /**
     * @param {Object} entry a session
     * @param {Object} message inner message
     * @return {Buffer} a MSG envelope
     */
    encryptFor(entry, message) {
        const {bytes} = wire.encodeInner(message, this.now);
        return wire.encodeEnvelope(wire.kinds.msg, entry.tag,
            entry.ratchet.encrypt(bytes));
    }

    /**
     * @param {string} address the contact
     * @param {Array} envelopes envelopes
     * @param {Object} [link] send here instead of through the carriers
     */
    transmit(address, envelopes, link) {
        const topic = this.topicOf(address);
        for (const envelope of envelopes) {
            if (link) {
                link.reply(envelope);
            } else {
                for (const carrier of this.carriers) {
                    carrier.send(topic, envelope);
                }
            }
        }
    }

    /**
     * @param {string} address an address
     * @return {Buffer} its rendezvous topic
     */
    topicOf(address) {
        return addressing.topic(addressing.addressToFingerprint(address));
    }

    /** @param {string} address the contact to start a handshake with */
    startHandshake(address) {
        const initiator = new Initiator({identity: this.identity,
            expected: address});
        const m1 = initiator.start();
        const key = initiator.sid.toString('hex');
        const envelope = wire.encodeEnvelope(wire.kinds.hs1,
            this.topicOf(address), m1);
        this.initiators.set(key, {initiator, address, envelope,
            at: this.now(), sentAt: this.now()});
        this.pendingTo.set(address, key);
        this.sendHs1(address, envelope);
    }

    /**
     * @param {string} address the contact
     * @param {Buffer} envelope an HS1 envelope
     */
    sendHs1(address, envelope) {
        for (const carrier of this.carriers) {
            carrier.send(this.topicOf(address), envelope);
        }
    }

    /**
     * Handle one received envelope
     * @param {Buffer} data the envelope
     * @param {Object} link where it came from
     */
    async receive(data, link) {
        const envelope = wire.decodeEnvelope(data);
        if (!envelope) {
            return;
        }
        const key = envelope.to.toString('hex');
        switch (envelope.kind) {
        case wire.kinds.hs1:
            return this.receiveM1(envelope, link);
        case wire.kinds.hs2:
            return this.receiveM2(envelope, key, link);
        case wire.kinds.hs3:
            return this.receiveM3(envelope, key, link);
        case wire.kinds.msg:
            return this.receiveMessage(envelope, key, link);
        case wire.kinds.reset:
            return this.receiveReset(key);
        }
    }

    /**
     * @param {Object} envelope HS1
     * @param {Object} link the link
     */
    receiveM1(envelope, link) {
        if (!envelope.to.equals(this.topic) || envelope.body.length < 34) {
            return; // for someone else (LAN frames go to everyone)
        }
        const key = envelope.body.subarray(2, 34).toString('hex');
        const known = this.responders.get(key);
        if (known) {
            // The same M1 through another carrier: same answer
            link.reply(wire.encodeEnvelope(wire.kinds.hs2,
                envelope.body.subarray(2, 34), known.m2));
            return;
        }
        const responder = new Responder({identity: this.identity,
            authorize: this.authorize});
        const m2 = responder.handleM1(envelope.body);
        if (this.responders.size >= this.options.maxPendingResponders) {
            this.responders.delete(this.responders.keys().next().value);
        }
        this.responders.set(key, {responder, m2, at: this.now()});
        link.reply(wire.encodeEnvelope(wire.kinds.hs2,
            envelope.body.subarray(2, 34), m2));
    }

    /**
     * @param {Object} envelope HS2
     * @param {string} key sid_A hex
     * @param {Object} link the link
     */
    async receiveM2(envelope, key, link) {
        const pending = this.initiators.get(key);
        if (!pending) {
            return;
        }
        this.initiators.delete(key);
        if (this.pendingTo.get(pending.address) === key) {
            this.pendingTo.delete(pending.address);
        }
        const {message, session} = pending.initiator.handleM2(envelope.body);
        link.bind?.(this.topicOf(pending.address));
        await this.withLock(pending.address, async () => {
            const entry = await this.installSession(pending.address, session,
                pending.initiator.sid);
            // M3, then a first message so that the responder can send; on
            // the same link, so nothing overtakes M3
            link.reply(wire.encodeEnvelope(wire.kinds.hs3,
                pending.initiator.sid, message));
            const hello = this.encryptFor(entry, {type: 'hello', body: {}});
            await this.saveSessions(pending.address);
            link.reply(hello);
            this.rearm(pending.address); // a new session: send everything
            await this.flush(pending.address, link);
        });
    }

    /**
     * @param {Object} envelope HS3
     * @param {string} key sid_A hex
     * @param {Object} link the link
     */
    async receiveM3(envelope, key, link) {
        const pending = this.responders.get(key);
        if (!pending) {
            return;
        }
        this.responders.delete(key);
        const session = await pending.responder.handleM3(envelope.body);
        const address = session.peer.address;
        link.bind?.(this.topicOf(address));
        await this.withLock(address, async () => {
            await this.installSession(address, session, envelope.to);
            this.rearm(address);
        });
    }

    /**
     * @param {Object} envelope MSG
     * @param {string} key session tag hex
     * @param {Object} link the link
     */
    async receiveMessage(envelope, key, link) {
        const known = this.byTag.get(key);
        if (!known) {
            // Not (yet) a session of ours: wait for a handshake to create
            // it; tick() tells the sender if none does
            if (this.parked.length >= this.options.maxParked) {
                this.parked.shift();
            }
            this.parked.push({envelope, key, link, at: this.now()});
            return;
        }
        const {address} = known;
        await this.withLock(address, async () => {
            const entry = this.byTag.get(key)?.entry;
            if (!entry) {
                return;
            }
            let plaintext;
            try {
                plaintext = entry.ratchet.decrypt(envelope.body);
            } catch (err) {
                return; // forged, corrupted, or a duplicate
            }
            await this.saveSessions(address);
            const message = wire.decodeInner(plaintext);
            if (!message) {
                return;
            }
            link.bind?.(this.topicOf(address));
            this.noteSeen(address, link);
            await this.handleInner(address, entry, message);
            await this.flush(address);
        });
    }

    /**
     * Act on a decrypted message. Call with the contact's lock held.
     * @param {string} address the sender; taken from the session, never from
     * the message (finding S2)
     * @param {Object} entry the session it came on
     * @param {Object} message {id, ts, type, body}
     */
    async handleInner(address, entry, message) {
        if (message.type === 'hello') {
            return;
        }
        if (message.type === 'receipt') {
            const ids = Array.isArray(message.body.ids) ?
                message.body.ids.slice(0, 1000) : [];
            for (const id of ids) {
                const item = this.outbox.get(id);
                if (item && item.address === address) {
                    this.outbox.delete(id);
                    await this.store.deleteOutboxItem(id);
                    this.emit(this.deliveredHandlers, {to: address, id});
                }
            }
            return;
        }
        // Acknowledge every copy, so the sender stops resending, but
        // deliver each message once
        const current = this.current(address);
        if (current?.ratchet.canSend) {
            const receipt = this.encryptFor(current,
                {type: 'receipt', body: {ids: [message.id]}});
            await this.saveSessions(address);
            this.transmit(address, [receipt]);
        }
        let seen = this.seen.get(address);
        if (!seen) {
            seen = new Set();
            this.seen.set(address, seen);
        }
        if (seen.has(message.id)) {
            return;
        }
        seen.add(message.id);
        if (seen.size > this.options.maxSeenIds) {
            seen.delete(seen.values().next().value);
        }
        this.emit(this.messageHandlers, {from: entry.ratchet.peer,
            id: message.id, ts: message.ts, type: message.type,
            body: message.body});
    }

    /**
     * The session to send on: the first one not retired by a RESET
     * @param {string} address the contact
     * @return {Object|undefined} the session entry
     */
    current(address) {
        return (this.sessions.get(address) || []).find((e) => !e.retired);
    }

    /**
     * The contact says it no longer has a session. RESET cannot be
     * authenticated (the sender lost the keys), so anyone who saw a
     * session's tag can forge one. The session is therefore only retired:
     * no longer used for sending, which starts a new handshake, but kept
     * for receiving, so a forged RESET costs one handshake and loses
     * nothing. A retired session ignores further RESETs (finding T8).
     * @param {string} key tag hex of a session the peer no longer has
     */
    async receiveReset(key) {
        const known = this.byTag.get(key);
        if (!known || known.entry.retired) {
            return;
        }
        await this.withLock(known.address, async () => {
            const entry = this.byTag.get(key)?.entry;
            if (!entry || entry.retired) {
                return;
            }
            entry.retired = true;
            // Only that session; another one may still be good
            this.setSessions(known.address, [...(this.sessions.get(
                known.address) || []).filter((e) => e !== entry), entry]);
            await this.saveSessions(known.address);
            this.rearm(known.address);
            // A new session at once, even with nothing to send: receipts
            // for what arrives on the retired one need it
            if (!this.current(known.address) &&
                !this.pendingTo.has(known.address)) {
                this.startHandshake(known.address);
            }
            await this.flush(known.address);
        });
    }

    /**
     * Add a completed handshake's session. Call with the contact's lock
     * held. If both sides started a handshake at the same time, both end up
     * with two sessions; both then send on the one whose initiator's sid is
     * lower, and keep the other for receiving. Outside a short window the
     * newest session always wins (for example after a restore).
     * @param {string} address the contact
     * @param {Object} session from the handshake
     * @param {Buffer} sidA the handshake's sid_A
     * @return {Object} the new entry
     */
    async installSession(address, session, sidA) {
        const entry = {ratchet: Ratchet.fromHandshake(session),
            tag: wire.sessionTag(session.sessionAd),
            sidA: Buffer.from(sidA), createdAt: this.now()};
        const existing = this.current(address);
        const keepExisting = existing &&
            this.now() - existing.createdAt <
                this.options.simultaneousWindowMs &&
            Buffer.compare(existing.sidA, entry.sidA) < 0;
        // Retired sessions stay last, for receiving, while there is room
        const retired = (this.sessions.get(address) || [])
            .filter((e) => e.retired);
        this.setSessions(address, [...keepExisting ? [existing, entry] :
            [entry, ...(existing ? [existing] : [])], ...retired]);
        await this.saveSessions(address);
        // Messages that overtook this handshake can be read now
        const tag = entry.tag.toString('hex');
        const waiting = this.parked.filter((p) => p.key === tag);
        this.parked = this.parked.filter((p) => p.key !== tag);
        for (const {envelope, link} of waiting) {
            this.enqueue(link, () => this.receiveMessage(envelope, tag,
                link));
        }
        return entry;
    }

    /**
     * Replace a contact's sessions (at most two are kept)
     * @param {string} address the contact
     * @param {Array} list entries, current first
     */
    setSessions(address, list) {
        for (const old of this.sessions.get(address) || []) {
            if (!list.includes(old)) {
                this.byTag.delete(old.tag.toString('hex'));
                old.ratchet.destroy();
            }
        }
        const kept = list.slice(0, 2);
        for (const dropped of list.slice(2)) {
            this.byTag.delete(dropped.tag.toString('hex'));
            dropped.ratchet.destroy();
        }
        if (kept.length === 0) {
            this.sessions.delete(address);
            return;
        }
        this.sessions.set(address, kept);
        for (const entry of kept) {
            this.byTag.set(entry.tag.toString('hex'), {address, entry});
        }
    }

    /** @param {string} address save this contact's sessions */
    async saveSessions(address) {
        await this.store.saveSessions(address,
            (this.sessions.get(address) || []).map((e) => ({
                state: e.ratchet.serialize(), tag: e.tag.toString('hex'),
                sidA: e.sidA.toString('hex'), createdAt: e.createdAt,
                retired: e.retired || undefined,
            })));
    }

    /**
     * @param {Array} handlers listeners
     * @param {Object} event the event
     */
    emit(handlers, event) {
        for (const handler of handlers) {
            try {
                handler(event);
            } catch (err) {
                this.log('A message handler failed:', err);
            }
        }
    }
}

module.exports = {Messenger, MemoryMessengerStore, appTypes};
