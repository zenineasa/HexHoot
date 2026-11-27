/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

const Hyperswarm = require('hyperswarm');
const wire = require('./wire');

// Envelopes kept per topic while nobody serving it is connected
const maxQueuedPerTopic = 1000;
// How often a topic with queued envelopes is looked up again
const refreshMs = 10000;

/**
 * Carries v2 envelopes over Hyperswarm (docs/design/wire-protocol-v2.md).
 * One swarm per app: it announces our topic (a hash of our fingerprint, not
 * our key: finding T1) and looks up the topics of people we write to.
 * Connections are reused in both directions. Hyperswarm's own Noise layer
 * is classical only (T6); everything inside is end-to-end encrypted
 * already.
 */
class DhtCarrier {
    /**
     * @param {Object} [options]
     * @param {Array} [options.bootstrap] DHT bootstrap nodes (a testnet in
     * tests); the public DHT if omitted
     * @param {function} [options.log] logger
     */
    constructor(options = {}) {
        this.name = 'dht';
        this.bootstrap = options.bootstrap;
        this.log = options.log || function() {};
        this.handler = function() {};
        this.swarm = null;
        this.announced = Promise.resolve();
        this.isAnnounced = false;
        this.routes = new Map(); // topic hex -> Set of links
        this.queues = new Map(); // topic hex -> [envelope]
        this.joined = new Map(); // topic hex -> {discovery, refreshedAt}
    }

    /** @param {function} func (envelope, link) for each received frame */
    onFrame(func) {
        this.handler = func;
    }

    /** @param {function} func called for each new connection */
    onPeer(func) {
        this.peerHandler = func;
    }

    /** @param {Buffer} topic our topic, announced so others can find us */
    async start(topic) {
        await this.stop();
        const swarm = new Hyperswarm(
            this.bootstrap ? {bootstrap: this.bootstrap} : {});
        this.swarm = swarm;
        swarm.on('connection', (conn, info) => this.attach(conn, info));
        const discovery = swarm.join(topic, {server: true, client: false});
        this.announced = discovery.flushed().then(() => {
            if (this.swarm === swarm) {
                this.isAnnounced = true;
            }
        }, () => {});
    }

    /** @return {Object} {name, ready}; ready once others can find us */
    status() {
        return {name: this.name, ready: Boolean(this.swarm) &&
            this.isAnnounced};
    }

    /**
     * @param {Object} conn a Hyperswarm connection
     * @param {Object} info its peer info
     */
    attach(conn, info) {
        const link = {
            via: 'dht',
            broadcast: false,
            reply: (envelope) => {
                if (!conn.destroyed) {
                    conn.write(wire.encodeFrame(envelope));
                }
            },
            bind: (topic) => this.route(topic, link),
        };
        conn.on('error', (err) => this.log('DHT connection error:',
            err.message));
        conn.on('close', () => {
            for (const links of this.routes.values()) {
                links.delete(link);
            }
        });
        const decoder = new wire.FrameDecoder((envelope) =>
            this.handler(envelope, link));
        conn.on('data', (chunk) => {
            try {
                decoder.push(chunk);
            } catch (err) {
                conn.destroy(); // oversized frame
            }
        });
        // Connections we opened by looking up a topic serve that topic
        for (const topic of info?.topics || []) {
            this.route(topic, link);
        }
        this.peerHandler?.();
    }

    /**
     * Send a topic's envelopes over a link from now on
     * @param {Buffer} topic the topic
     * @param {Object} link a link from attach()
     */
    route(topic, link) {
        const key = Buffer.from(topic).toString('hex');
        if (!this.routes.has(key)) {
            this.routes.set(key, new Set());
        }
        this.routes.get(key).add(link);
        for (const envelope of this.queues.get(key)?.splice(0) || []) {
            link.reply(envelope);
        }
    }

    /**
     * Send an envelope to whoever serves a topic; queued until connected
     * @param {Buffer} topic the topic
     * @param {Buffer} envelope the envelope
     */
    send(topic, envelope) {
        if (!this.swarm) {
            return;
        }
        const key = Buffer.from(topic).toString('hex');
        const links = this.routes.get(key);
        if (links && links.size > 0) {
            for (const link of links) {
                link.reply(envelope);
                return; // one connection is enough
            }
        }
        const queue = this.queues.get(key) || [];
        if (queue.length >= maxQueuedPerTopic) {
            queue.shift();
        }
        queue.push(envelope);
        this.queues.set(key, queue);
        const joined = this.joined.get(key);
        if (!joined) {
            const discovery = this.swarm.join(Buffer.from(topic),
                {server: false, client: true});
            this.joined.set(key, {discovery, refreshedAt: Date.now()});
        } else if (Date.now() - joined.refreshedAt > refreshMs) {
            joined.refreshedAt = Date.now();
            joined.discovery.refresh({server: false, client: true})
                .catch(() => {});
        }
    }

    /** Leave the DHT and close every connection */
    async stop() {
        const swarm = this.swarm;
        this.swarm = null;
        this.isAnnounced = false;
        this.routes.clear();
        this.queues.clear();
        this.joined.clear();
        if (swarm) {
            await swarm.destroy().catch(() => {});
        }
    }
}

module.exports = DhtCarrier;
