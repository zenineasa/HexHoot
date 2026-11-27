/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

const os = require('node:os');
const http = require('node:http');
const arp = require('arptable-js');
const ping = require('ping');
const range = require('ipv4-range');
const wire = require('./wire');

const preferredServerPort = 43946;
const maxTryDiffPorts = 10;
const maxPeers = 256;

/**
 * Carries v2 envelopes between HexHoot instances on the local network
 * (docs/design/wire-protocol-v2.md). HTTP is only a carrier: what it
 * carries is end-to-end encrypted, and identities never appear in it.
 *
 * - GET / answers {application: 'hexhoot', protocol: 2} and nothing else:
 *   no channels, keys or peer lists (finding T2).
 * - POST /frame carries one envelope. The header x-hexhoot-port names the
 *   sender's own port, so the receiver can answer.
 * - POST /hello (empty) introduces an instance that has just found us, so
 *   discovery works both ways.
 * - Peers do not say whom they serve, so an envelope for a topic nobody has
 *   claimed goes to every known instance (marked x-hexhoot-broadcast), and
 *   each one drops what is not for it. Once a session exists, its frames
 *   go only to that contact's instance (bind).
 */
class LanCarrier {
    /**
     * @param {Object} [options]
     * @param {number} [options.port] first port to try (0 for any free port)
     * @param {Array} [options.peers] static "host:port" list; disables the
     * ping and ARP sweep
     * @param {function} [options.log] logger
     */
    constructor(options = {}) {
        this.name = 'lan';
        this.preferredPort = options.port ?? preferredServerPort;
        this.staticPeers = options.peers || null;
        this.log = options.log || function() {};
        this.handler = function() {};
        this.peerHandler = function() {};
        this.server = null;
        this.port = null;
        this.peers = new Map(); // "ip:port" -> link
        this.routes = new Map(); // topic hex -> link
    }

    /** @param {function} func (envelope, link) for each received frame */
    onFrame(func) {
        this.handler = func;
    }

    /**
     * @param {function} func called when an instance appears: found by us,
     * or saying hello (for example after a restart)
     */
    onPeer(func) {
        this.peerHandler = func;
    }

    /** @param {Buffer} topic unused: LAN peers are not told our topic */
    async start(topic) {
        await this.stop();
        this.stopped = false;
        await this.startServer(this.preferredPort);
        this.discover();
        // Instances that start later are found on a later round
        this.timer = setInterval(() => this.discover(),
            this.staticPeers ? 2000 : 60000);
        this.timer.unref?.();
    }

    /** @return {Object} {name, ready, peers} */
    status() {
        return {name: this.name, ready: Boolean(this.server),
            peers: this.peers.size};
    }

    /** Stop the server */
    async stop() {
        this.stopped = true;
        clearInterval(this.timer);
        this.peers.clear();
        this.routes.clear();
        if (this.server) {
            const server = this.server;
            this.server = null;
            await new Promise((resolve) => {
                server.close(resolve);
                server.closeAllConnections();
            });
        }
    }

    /**
     * @param {number} port the first port to try
     */
    async startServer(port) {
        for (let attempt = 0; ; attempt++) {
            const server = http.createServer(this.handleRequest.bind(this));
            try {
                await new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(port === 0 ? 0 : port + attempt, resolve);
                });
            } catch (err) {
                if (err.code === 'EADDRINUSE' && port !== 0 &&
                    attempt + 1 < maxTryDiffPorts) {
                    continue;
                }
                throw err;
            }
            server.on('error', (err) => this.log('LAN server error:', err));
            this.server = server;
            this.port = server.address().port;
            return;
        }
    }

    /**
     * @param {http.IncomingMessage} req request
     * @param {http.ServerResponse} res response
     */
    handleRequest(req, res) {
        if (req.method === 'GET' && req.url === '/') {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({application: 'hexhoot', protocol: 2}));
            return;
        }
        const port = Number(req.headers['x-hexhoot-port']);
        if (req.method !== 'POST' || !['/frame', '/hello'].includes(req.url) ||
            !Number.isInteger(port) || port < 1 || port > 65535) {
            res.writeHead(404);
            res.end();
            return;
        }
        if (req.url === '/hello') {
            req.resume();
            res.end();
            if (!this.stopped &&
                this.peerLink(this.normalizeIp(req.socket.remoteAddress),
                    port)) {
                this.peerHandler();
            }
            return;
        }
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > wire.maxFrameBytes) {
                res.writeHead(413);
                res.end();
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            res.end();
            if (this.stopped || size > wire.maxFrameBytes) {
                return;
            }
            const ip = this.normalizeIp(req.socket.remoteAddress);
            const link = this.peerLink(ip, port);
            if (!link) {
                return;
            }
            const envelope = Buffer.concat(chunks);
            this.handler(envelope, req.headers['x-hexhoot-broadcast'] ?
                link.asBroadcast : link);
        });
        req.on('error', function() {});
    }

    /**
     * @param {string} address a socket address, maybe IPv4-mapped IPv6
     * @return {string} the IPv4 address
     */
    normalizeIp(address) {
        return String(address).replace(/^::ffff:/, '');
    }

    /**
     * The link to an instance, created on first contact
     * @param {string} ip its address
     * @param {number} port its port
     * @return {Object|null} the link; null for ourselves or over the limit
     */
    peerLink(ip, port) {
        const id = ip + ':' + port;
        if (this.isSelf(ip, port)) {
            return null;
        }
        let link = this.peers.get(id);
        if (!link) {
            if (this.peers.size >= maxPeers) {
                return null;
            }
            let chain = Promise.resolve();
            link = {
                id,
                via: 'lan',
                broadcast: false,
                // In order: each request waits for the one before it
                reply: (envelope, broadcast = false) => {
                    chain = chain.then(() => this.post(id, envelope,
                        broadcast));
                },
                bind: (topic) => this.routes.set(
                    Buffer.from(topic).toString('hex'), link),
            };
            // The same peer, for frames that went to everyone: these are
            // never answered with RESET
            link.asBroadcast = {...link, broadcast: true};
            this.peers.set(id, link);
        }
        return link;
    }

    /**
     * @param {string} ip an address
     * @param {number} port a port
     * @return {boolean} whether that is this instance
     */
    isSelf(ip, port) {
        if (port !== this.port) {
            return false;
        }
        const own = ['127.0.0.1'];
        for (const list of Object.values(os.networkInterfaces())) {
            for (const info of list) {
                if (info.family === 'IPv4') {
                    own.push(info.address);
                }
            }
        }
        return own.includes(ip);
    }

    /**
     * POST one envelope
     * @param {string} id "ip:port"
     * @param {Buffer} envelope the envelope
     * @param {boolean} broadcast whether it went to every instance
     * @return {Promise} settles when the request is done
     */
    post(id, envelope, broadcast) {
        if (this.stopped) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            const headers = {
                'Content-Type': 'application/octet-stream',
                'Content-Length': envelope.length,
                'x-hexhoot-port': String(this.port),
            };
            if (broadcast) {
                headers['x-hexhoot-broadcast'] = '1';
            }
            const req = http.request('http://' + id + '/frame',
                {method: 'POST', headers}, (res) => {
                    res.resume();
                    res.on('end', resolve);
                });
            req.on('error', () => resolve());
            req.setTimeout(10000, () => req.destroy());
            req.end(envelope);
        });
    }

    /**
     * Tell an instance we found that we exist
     * @param {string} id its "host:port"
     */
    introduce(id) {
        const req = http.request('http://' + id + '/hello', {method: 'POST',
            headers: {'x-hexhoot-port': String(this.port),
                'Content-Length': 0}}, (res) => res.resume());
        req.on('error', () => {});
        req.setTimeout(3000, () => req.destroy());
        req.end();
    }

    /**
     * Send to the instance serving a topic, or to every instance if that is
     * not known yet
     * @param {Buffer} topic the topic
     * @param {Buffer} envelope the envelope
     */
    send(topic, envelope) {
        if (!this.server) {
            return;
        }
        const link = this.routes.get(Buffer.from(topic).toString('hex'));
        if (link) {
            link.reply(envelope);
            return;
        }
        for (const peer of this.peers.values()) {
            peer.reply(envelope, true);
        }
    }

    /** Find instances: the static list, or a ping and ARP sweep */
    discover() {
        if (this.staticPeers) {
            this.staticPeers.filter((peer) => !this.peers.has(peer))
                .forEach((peer) => this.probe(peer));
            return;
        }
        const tryPorts = (address) => {
            for (let i = 0; i < maxTryDiffPorts; i++) {
                this.probe(`${address}:${preferredServerPort + i}`);
            }
        };
        for (const list of Object.values(os.networkInterfaces())) {
            for (const info of list) {
                if (info.family !== 'IPv4' || info.internal ||
                    !/^(10|172|192)\./.test(info.address)) {
                    continue;
                }
                for (const address of [...range(info.address, 255),
                    info.address]) {
                    ping.promise.probe(address, {timeout: 100, min_reply: 1})
                        .then((res) => {
                            if (res.alive && !this.stopped) {
                                tryPorts(address);
                            }
                        }, () => {});
                }
            }
        }
        arp.get((table) => {
            for (const row of table) {
                if (row.InternetAddress !== '?' && !this.stopped) {
                    tryPorts(row.PhysicalAddress.slice(1, -1));
                }
            }
        });
    }

    /**
     * Check whether HexHoot v2 runs at host:port, and remember it if so
     * @param {string} id "host:port"
     */
    probe(id) {
        if (this.stopped) {
            return;
        }
        const [host, portText] = id.split(':');
        const port = Number(portText);
        if (this.isSelf(host, port)) {
            return;
        }
        const req = http.get('http://' + id + '/', (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
                if (data.length > 1024) {
                    res.destroy();
                }
            });
            res.on('end', () => {
                try {
                    const info = JSON.parse(data);
                    if (info.application === 'hexhoot' &&
                        info.protocol === 2 && !this.stopped &&
                        !this.peers.has(id)) {
                        this.peerLink(host, port);
                        this.introduce(id);
                        this.peerHandler();
                    }
                } catch (err) {
                    // Not HexHoot
                }
            });
        });
        req.on('error', () => {});
        req.setTimeout(3000, () => req.destroy());
    }
}

module.exports = LanCarrier;
