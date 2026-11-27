/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// An in-memory network of carriers for L2 tests, with optional faults:
// drop, duplicate and delay (which reorders) frames.

/**
 * A small seeded random generator, so failures can be reproduced
 * @param {number} seed seed
 * @return {function} () => number in [0, 1)
 */
function seeded(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 2 ** 32;
    };
}

/** The network: carriers find each other by topic */
class MemoryNetwork {
    /**
     * @param {Object} [faults] {drop, duplicate, delayMs, seed}
     */
    constructor(faults = {}) {
        this.faults = faults;
        this.random = seeded(faults.seed ?? 1);
        this.nodes = new Map(); // topic hex -> carrier
        this.frames = 0;
        this.log = [];
    }

    /** @return {MemoryCarrier} a new carrier on this network */
    carrier() {
        return new MemoryCarrier(this);
    }

    /**
     * Deliver an envelope, applying the faults
     * @param {MemoryCarrier} from sender
     * @param {MemoryCarrier} to receiver
     * @param {Buffer} envelope the envelope
     */
    deliver(from, to, envelope) {
        this.frames++;
        this.log.push(envelope);
        const {drop = 0, duplicate = 0, delayMs = 0} = this.faults;
        if (this.random() < drop) {
            return;
        }
        const copies = this.random() < duplicate ? 2 : 1;
        for (let i = 0; i < copies; i++) {
            const delay = delayMs ? Math.floor(this.random() * delayMs) : 0;
            setTimeout(() => {
                if (to.topic && this.nodes.get(to.topicKey) === to) {
                    to.handler(Buffer.from(envelope), to.linkTo(from));
                }
            }, delay);
        }
    }
}

/** One node's carrier */
class MemoryCarrier {
    /** @param {MemoryNetwork} network the network */
    constructor(network) {
        this.name = 'memory';
        this.network = network;
        this.handler = function() {};
        this.links = new Map();
        this.topic = null;
    }

    /** @param {function} func (envelope, link) */
    onFrame(func) {
        this.handler = func;
    }

    /** @param {function} func called when another node comes online */
    onPeer(func) {
        this.peerHandler = func;
    }

    /** @param {Buffer} topic our topic */
    async start(topic) {
        this.topic = topic;
        this.topicKey = topic.toString('hex');
        this.network.nodes.set(this.topicKey, this);
        for (const node of this.network.nodes.values()) {
            if (node !== this) {
                node.peerHandler?.();
            }
        }
    }

    /** Go offline */
    async stop() {
        if (this.network.nodes.get(this.topicKey) === this) {
            this.network.nodes.delete(this.topicKey);
        }
        this.topic = null;
    }

    /**
     * @param {MemoryCarrier} other the other end
     * @return {Object} the link to it (one per pair, so order is kept)
     */
    linkTo(other) {
        if (!this.links.has(other)) {
            this.links.set(other, {via: 'memory', broadcast: false,
                reply: (envelope) => this.network.deliver(this, other,
                    envelope)});
        }
        return this.links.get(other);
    }

    /**
     * @param {Buffer} topic the recipient's topic
     * @param {Buffer} envelope the envelope; dropped if nobody is online
     */
    send(topic, envelope) {
        const target = this.network.nodes.get(topic.toString('hex'));
        if (target && this.topic) {
            this.network.deliver(this, target, envelope);
        }
    }
}

module.exports = {MemoryNetwork, seeded};
