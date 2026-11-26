/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

const Hyperswarm = require('hyperswarm');

// Frames larger than this are dropped and the connection is closed.
const maxFrameBytes = 4 * 1024 * 1024;
// Envelopes kept per recipient while they cannot be reached; oldest dropped.
const maxQueuedFrames = 1000;

/**
 * Carries v1 envelopes over Hyperswarm. The topic of a user is their public
 * key; a user listens on their own topic (server) and joins the topic of the
 * recipient (client) to send. Each envelope is one line of JSON, since stream
 * chunks may split or merge messages (finding T5).
 */
class DhtTransport {
    /**
     * @param {Object} options
     * @param {Array} [options.bootstrap] DHT bootstrap nodes (a testnet in
     * tests); the public DHT if omitted
     * @param {function} [options.log] logger
     */
    constructor(options = {}) {
        this.name = 'dht';
        this.bootstrap = options.bootstrap;
        this.log = options.log || console.log;
        this.messageCallback = function() {};
        this.server = null;
        this.announced = Promise.resolve();
        this.isAnnounced = false;
        this.senders = new Map(); // public key -> {swarm, conn, queue}
    }

    /**
     * @param {function} func called with each received envelope (a string)
     */
    onMessage(func) {
        this.messageCallback = func;
    }

    /**
     * Create a swarm
     * @return {Hyperswarm}
     */
    createSwarm() {
        const swarm = new Hyperswarm(
            this.bootstrap ? {bootstrap: this.bootstrap} : {});
        swarm.on('connection', (conn) => this.attach(conn));
        return swarm;
    }

    /**
     * Read line-framed envelopes from a connection
     * @param {Object} conn a Hyperswarm connection
     */
    attach(conn) {
        let buffered = '';
        conn.on('error', (err) => this.log('DHT connection error:',
            err.message));
        conn.on('data', (chunk) => {
            buffered += chunk.toString();
            let newline;
            while ((newline = buffered.indexOf('\n')) !== -1) {
                const frame = buffered.slice(0, newline);
                buffered = buffered.slice(newline + 1);
                if (frame.length > 0) {
                    this.messageCallback(frame);
                }
            }
            if (buffered.length > maxFrameBytes) {
                this.log('Dropping an oversized DHT frame');
                conn.destroy();
            }
        });
    }

    /**
     * Start listening on our own topic
     * @param {string} publicKey our public key (hex)
     */
    async start(publicKey) {
        await this.stop();
        this.isAnnounced = false;
        const server = this.createSwarm();
        this.server = server;
        const discovery = server.join(Buffer.from(publicKey, 'hex'),
            {server: true, client: false});
        // Announcing on the public DHT can take seconds; do not hold up
        // login for it. Peers cannot find us until 'announced' resolves.
        this.announced = discovery.flushed().then(() => {
            if (this.server === server) {
                this.isAnnounced = true;
                this.log('Subscribed to channel: ' + publicKey);
            }
        }, () => {});
    }

    /**
     * @return {Object} {name, ready}; ready once peers can find us
     */
    status() {
        return {name: this.name, ready: Boolean(this.server) &&
            this.isAnnounced};
    }

    /**
     * Send an envelope to a user
     * @param {string} recipient their public key (hex)
     * @param {string} envelope the encrypted message
     */
    async send(recipient, envelope) {
        let sender = this.senders.get(recipient);
        if (!sender) {
            sender = {swarm: this.createSwarm(), conn: null, queue: []};
            this.senders.set(recipient, sender);
            sender.swarm.on('connection', (conn) => {
                sender.conn = conn;
                conn.on('close', () => {
                    if (sender.conn === conn) {
                        sender.conn = null;
                    }
                });
                for (const frame of sender.queue.splice(0)) {
                    conn.write(frame);
                }
            });
            sender.swarm.join(Buffer.from(recipient, 'hex'),
                {server: false, client: true});
        }
        const frame = envelope + '\n';
        if (sender.conn && !sender.conn.destroyed) {
            sender.conn.write(frame);
        } else {
            if (sender.queue.length >= maxQueuedFrames) {
                sender.queue.shift();
            }
            sender.queue.push(frame);
        }
    }

    /** Leave every topic and close every connection */
    async stop() {
        const swarms = [this.server,
            ...[...this.senders.values()].map((s) => s.swarm)]
            .filter(Boolean);
        this.server = null;
        this.senders.clear();
        await Promise.allSettled(swarms.map((swarm) => swarm.destroy()));
    }
}

module.exports = DhtTransport;
