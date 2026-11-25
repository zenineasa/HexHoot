/* Copyright (c) 2023-2026 Zenin Easa Panthakkalakath */

const os = require('os');
const http = require('http');
const net = require('net');
const arp = require('arptable-js');
const ping = require('ping');
const range = require('ipv4-range');

// Largest possible port number is 65535. Choose a number lower than that, but
// not potentially used by other applications.
const preferredServerPort = 43946;
const maxTryDiffPorts = 10;

// Largest request body accepted by the HTTP server. Profile photos are sent
// inside encrypted messages, so this has to be larger than the photo limit.
const maxRequestBodyBytes = 4 * 1024 * 1024;

/**
 * Carries v1 envelopes to HexHoot instances on the local network over HTTP.
 * The responsibilities of this class are:
 * 1. Find machines in the local network (intranet) that are running HexHoot.
 * 2. Deliver envelopes to the instances that listen on the recipient's
 *    channel (their public key).
 * Peers are keyed by "ip:port", so several instances can share a host.
 */
class LanTransport {
    /**
     * @param {Object} options
     * @param {number} [options.port] first port to try (0 for any free port)
     * @param {Array} [options.peers] static "host:port" list; disables the
     * ping and ARP sweep
     * @param {string} [options.version] version advertised to peers
     * @param {function} [options.log] logger
     */
    constructor(options = {}) {
        this.name = 'lan';
        this.preferredPort = options.port ?? preferredServerPort;
        this.staticPeers = options.peers || null;
        this.version = options.version || '';
        this.log = options.log || console.log;
        this.messageCallback = function() {};
        this.server = null;
        this.port = null;
        this.channels = [];
        this.peers = {};
        this.ipAddresses = [];
    }

    /**
     * @param {function} func called with each received envelope (a string)
     */
    onMessage(func) {
        this.messageCallback = func;
    }

    /**
     * Start the server and look for peers
     * @param {string} publicKey our public key (hex), the channel we listen on
     */
    async start(publicKey) {
        await this.stop();
        this.stopped = false;
        this.channels = [publicKey];
        this.peers = {};
        this.ipAddresses = this.findPrivateIPv4Addresses();
        await this.startServer(this.preferredPort);
        this.findDevicesRunningHexHoot();
    }

    /** Stop the server */
    async stop() {
        this.stopped = true;
        if (!this.server) {
            return;
        }
        const server = this.server;
        this.server = null;
        await new Promise((resolve) => {
            server.close(resolve);
            server.closeAllConnections();
        });
    }

    /**
     * IPv4 addresses of this device in the private ranges; these are swept
     * for peers.
     * @return {Array} addresses
     */
    findPrivateIPv4Addresses() {
        const addresses = [];
        for (const netInterface of Object.values(os.networkInterfaces())) {
            for (const info of netInterface) {
                if (info.family === 'IPv4' && (
                    info.address.startsWith('192.') ||
                    info.address.startsWith('172.') ||
                    info.address.startsWith('10.'))) {
                    addresses.push(info.address);
                }
            }
        }
        return addresses;
    }

    /**
     * The first external IPv4 address of this device
     * @return {string} the address, or '127.0.0.1' if there is none
     */
    getPrimaryIPv4Address() {
        for (const addresses of Object.values(os.networkInterfaces())) {
            for (const address of addresses) {
                if (address.family === 'IPv4' && !address.internal) {
                    return address.address;
                }
            }
        }
        return '127.0.0.1';
    }

    /**
     * Addresses a peer may see our requests come from
     * @return {Array} addresses
     */
    getAdvertisedAddresses() {
        return [...this.ipAddresses, '127.0.0.1'];
    }

    /**
     * Information about this HexHoot instance
     * @return {Object} Information about this HexHoot instance
     */
    getInformationAboutSelf() {
        return {
            application: 'hexhoot',
            version: this.version,
            ip: this.getPrimaryIPv4Address(),
            ips: this.getAdvertisedAddresses(),
            port: this.port,
            hostsWithHexHootMap: this.peers,
            listOfChannelsSubscribedTo: this.channels,
        };
    }

    /**
     * Start the HTTP server. If the port is taken, the next one is tried, up
     * to 'maxTryDiffPorts' ports.
     * @param {number} port the port in which we would like to start the server
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
                    this.log(`Port ${port + attempt} is already in use`);
                    continue;
                }
                throw err;
            }
            server.on('error', (err) => this.log('LAN server error:', err));
            this.server = server;
            this.port = server.address().port;
            this.log('Server: http://' + this.getPrimaryIPv4Address() + ':' +
                this.port);
            return;
        }
    }

    /**
     * Handle a request to the HTTP server
     * @param {http.IncomingMessage} req request
     * @param {http.ServerResponse} res response
     */
    handleRequest(req, res) {
        if (req.url === '/' && req.method === 'GET') {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify(this.getInformationAboutSelf()));
            return;
        }

        const remote = req.socket.remoteAddress;
        const postHandlers = {
            '/': (body) => {
                const data = JSON.parse(body);
                data.ip = this.assertIPInArrayAndReturn(remote, data.ips);
                this.saveInfoAboutPeers(data);
            },
            '/subscribeChannels': (body) => {
                const data = JSON.parse(body);
                const ip = this.assertIPInArrayAndReturn(remote, data.ips);
                this.addChannelToPeer(ip + ':' + Number(data.port),
                    data.channelNames);
            },
            '/message': (body) => {
                this.messageCallback(body);
            },
        };
        if (req.method !== 'POST' || !Object.hasOwn(postHandlers, req.url)) {
            res.writeHead(404);
            res.end();
            return;
        }

        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxRequestBodyBytes) {
                res.writeHead(413);
                res.end();
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                postHandlers[req.url](Buffer.concat(chunks).toString());
                res.end('ok');
            } catch (err) {
                this.log('Rejected request to ' + req.url + ': ' +
                    err.message);
                res.writeHead(400);
                res.end();
            }
        });
        req.on('error', function() {});
    }

    /**
     * Find all devices that run HexHoot: the static peers if given, otherwise
     * a ping sweep of our subnets and the ARP table.
     */
    findDevicesRunningHexHoot() {
        if (this.staticPeers) {
            for (const peer of this.staticPeers) {
                this.fetchInfo('http://' + peer);
            }
            return;
        }

        const fetchViaDifferentPorts = (address) => {
            for (let i = 0; i < maxTryDiffPorts; i++) {
                this.fetchInfo(
                    `http://${address}:${preferredServerPort + i}`);
            }
        };

        // Ping around the IP addresses that this device is assigned with
        this.ipAddresses.forEach((ip) => {
            const addresses = range(ip, 255);
            addresses.push(ip);
            addresses.forEach(async (address) => {
                const res = await ping.promise.probe(
                    address, {timeout: 100, min_reply: 1});
                if (res.alive && !this.stopped) {
                    fetchViaDifferentPorts(address);
                }
            });
        });

        // Additionally, let's see if the ARP Table can come up with other
        // connections.
        arp.get((table) => {
            table.forEach((row) => {
                if (row.InternetAddress !== '?' && !this.stopped) {
                    // Remove the enclosing brackets along with the address
                    const address = row.PhysicalAddress
                        .substring(1, row.PhysicalAddress.length - 1);
                    fetchViaDifferentPorts(address);
                }
            });
        });
    }

    /**
     * Whether an ip:port pair is this instance
     * @param {string} ip address
     * @param {number} port port
     * @return {boolean}
     */
    isSelf(ip, port) {
        return port === this.port && this.getAdvertisedAddresses()
            .concat(this.getPrimaryIPv4Address()).includes(ip);
    }

    /**
     * Process and save the information about an instance of HexHoot running
     * on another computer.
     * @param {Object} info information other HexHoot instance
     */
    saveInfoAboutPeers(info) {
        // Keep only the fields this class uses, after validating them; the
        // rest of the object is controlled by the peer.
        const port = Number(info.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error('Invalid port');
        }
        const channels = Array.isArray(info.listOfChannelsSubscribedTo) ?
            info.listOfChannelsSubscribedTo.filter(function(name) {
                return typeof name === 'string' && name.length <= 256;
            }) : [];
        this.peers[info.ip + ':' + port] = {
            application: 'hexhoot',
            version: String(info.version).slice(0, 32),
            ip: info.ip,
            port: port,
            listOfChannelsSubscribedTo: channels,
        };

        // Instances the peer knows about are contacted directly, rather than
        // trusting what the peer says about them.
        const others = (info.hostsWithHexHootMap &&
            typeof info.hostsWithHexHootMap === 'object') ?
            Object.values(info.hostsWithHexHootMap) : [];
        for (const other of others.slice(0, 256)) {
            const otherPort = Number(other && other.port);
            if (!other || net.isIPv4(other.ip) !== true ||
                !Number.isInteger(otherPort) || otherPort < 1 ||
                otherPort > 65535) {
                continue;
            }
            const id = other.ip + ':' + otherPort;
            if (!Object.hasOwn(this.peers, id) &&
                !this.isSelf(other.ip, otherPort)) {
                this.fetchInfo('http://' + id);
            }
        }
    }

    /**
     * Add new channels to a peer.
     * @param {string} id "ip:port" of the peer
     * @param {Array} channelNames Name of channels that the peer would like to
     * subscribe to
     */
    addChannelToPeer(id, channelNames) {
        if (!Object.hasOwn(this.peers, id) || !Array.isArray(channelNames)) {
            throw new Error('Unknown peer or invalid channel list');
        }
        const channels = this.peers[id].listOfChannelsSubscribedTo;
        for (const name of channelNames) {
            if (typeof name === 'string' && name.length <= 256 &&
                !channels.includes(name)) {
                channels.push(name);
            }
        }
    }

    /**
     * Check if the URL has HexHoot; if yes, save information about it and
     * tell it about this instance.
     * @param {string} url the full url to the server instance (would contain
     * 'http://', hostname and port)
     */
    fetchInfo(url) {
        if (this.stopped) {
            return;
        }
        http.get(url, (response) => {
            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
                if (data.length > maxRequestBodyBytes) {
                    response.destroy();
                }
            });
            response.on('end', () => {
                if (this.stopped) {
                    return;
                }
                try {
                    data = JSON.parse(data);
                } catch (err) {
                    return;
                }
                if (!data || data.application !== 'hexhoot') {
                    return;
                }
                try {
                    // The instance must list the address we reached it at
                    data.ip = this.assertIPInArrayAndReturn(url, data.ips);
                    if (this.isSelf(data.ip, Number(data.port))) {
                        return;
                    }
                    this.saveInfoAboutPeers(data);
                } catch (err) {
                    this.log('Invalid peer information from ' + url + ': ' +
                        err.message);
                    return;
                }
                // Send back information about this instance
                this.post(url, JSON.stringify(this.getInformationAboutSelf()));
            });
        }).on('error', function() {
            // Most likely, HexHoot is not running at this address.
        });
    }

    /**
     * Ensure that the sender IP address exists in the given array of IPs
     * @param {string} address URL, or a socket's remote address
     * @param {Array} ipAddresses array of IP addresses passed through the
     * request message
     * @return {string} the IP address, if it exists in the list
     */
    assertIPInArrayAndReturn(address, ipAddresses) {
        let hostname;
        if (address.startsWith('http://')) {
            hostname = new URL(address).hostname;
        } else {
            // Example: '::ffff:172.16.29.1'
            hostname = address.slice(address.lastIndexOf(':') + 1);
        }
        if (!Array.isArray(ipAddresses) || !ipAddresses.includes(hostname)) {
            throw new Error('Sender IP doesn\'t match the data provided');
        }
        return hostname;
    }

    /**
     * Send a POST request
     * @param {string} url the full url, including the path
     * @param {string} body the request body
     */
    post(url, body) {
        const req = http.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        }, (res) => res.resume());
        req.on('error', (err) => this.log('LAN send failed:', err.message));
        req.end(body);
    }

    /**
     * Send an envelope to every instance that listens on the recipient's
     * channel
     * @param {string} recipient their public key (hex)
     * @param {string} envelope the encrypted message
     */
    async send(recipient, envelope) {
        for (const info of Object.values(this.peers)) {
            if (info.listOfChannelsSubscribedTo.includes(recipient)) {
                this.post(`http://${info.ip}:${info.port}/message`, envelope);
            }
        }
    }
}

module.exports = LanTransport;
