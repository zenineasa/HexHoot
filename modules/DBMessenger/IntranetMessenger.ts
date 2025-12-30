/* Copyright (c) 2023-2024 Zenin Easa Panthakkalakath */

import * as os from 'os';
import * as http from 'http';
import * as utils from './utils';
import DBWrapper from './DBWrapper';

const ip = require('ip');
const arp = require('arptable-js');
const ping = require('ping');
const range = require('ipv4-range');

const dbWrapper = new DBWrapper();
const preferedServerPort = 43946;
const maxTryDiffPorts = 10;

/**
 * This is a singleton class.
 * The responsibility of this class are:
 * 1. Find machines in the local network (intranet) that are running HexHoot.
 * 2. Establish communication with these devices.
 */
export default class IntranetMessenger {
    private static _instance: IntranetMessenger;
    private listOfChannelsSubscribedTo: string[] = [];
    private messageReceiveCallbackFunction: (msg: any) => void = () => {};
    private ipAddresses: string[] = [];
    private hostsWithHexHootMap: {[key: string]: any} = {};
    private userInfo: any;
    private userPublicKey: string;
    private server: http.Server;
    private port: number;

    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (IntranetMessenger._instance) {
            return IntranetMessenger._instance;
        }
        IntranetMessenger._instance = this;

        this.listOfChannelsSubscribedTo = [];
        this.messageReceiveCallbackFunction = function() {};

        this.initialize();
    }

    /**
     * Initialize IntranetMessenger
     */
    async initialize() {
        console.log('Initializing intranet messenger');
        this.ipAddresses = [];
        this.hostsWithHexHootMap = {};

        this.findIPAddressesAssignedToThisDevice();
        this.startServer(preferedServerPort);
        this.findDevicesRunningHexHoot();

        const users = await dbWrapper.getAll('LoggedInUserInfo');
        this.userInfo = users[0];
        if (this.userInfo) {
            this.userPublicKey =
                utils.getPublicKeyFromPrivateKey(this.userInfo.privateKey);
            this.subscribeToChannel(
                utils.stringToBuffer(this.userPublicKey));
        }
    }

    /**
     * Cleanup IntranetMessenger
     */
    async cleanup() {
        console.log('Cleaning up intranet messenger');
        await this.stopServer();
    }

    /**
     * Re-initialize IntranetMessenger
     */
    async reInitialize() {
        await this.cleanup();
        await this.initialize();
    }

    /**
     * Find IP Addresses assigned to this device and store it all in the
     * variable named 'this.ipAddresses'.
     */
    findIPAddressesAssignedToThisDevice() {
        // Find the IP Addresses that the network interfaces have been assigned
        const net = os.networkInterfaces();
        Object.values(net).forEach((netInterface) => {
            if(!netInterface) return;
            netInterface.forEach((info) => {
                if (
                    info.address.startsWith('192.') ||
                    info.address.startsWith('172.') ||
                    info.address.startsWith('10.')
                ) {
                    this.ipAddresses.push(info.address);
                }
            });
        });
    }

    /**
     * Information about this HexHoot instance
     * @return {Object} Information about this HexHoot instance
     */
    getInformationAboutSelf() {
        const info: any = {};
        info.application = process.env.npm_package_name;
        info.version = process.env.npm_package_version;
        info.ip = ip.address();
        info.ips = this.ipAddresses;
        info.port = this.port;
        info.hostsWithHexHootMap = this.hostsWithHexHootMap;
        info.listOfChannelsSubscribedTo = this.listOfChannelsSubscribedTo;
        return info;
    }

    /**
     * Start the HTTP server.
     * This gets invoked recursively if the port is not free. The port number
     * is increased by one in each successive recursive call.
     * @param {number} port the port in which we would like to start the server
     */
    startServer(port: number) {
        this.server = http.createServer((req, res) => {
            if (req.url === '/') {
                if (req.method === 'GET') {
                    const response = this.getInformationAboutSelf();
                    res.writeHead(200, {'Content-Type': 'application/json'});
                    res.write(JSON.stringify(response));
                    res.end();
                } else if (req.method === 'POST') {
                    let body = '';
                    req.on('data', (chunk) => {
                        body += chunk.toString();
                    });
                    req.on('end', () => {
                        const data = JSON.parse(body);

                        // Assert that the data response has the same URL
                        // information as the URL we sent to
                        data.ip = this.assertIPInArrayAndReturn(
                            req.connection.remoteAddress, data.ips,
                        );

                        // Extract information about this
                        this.saveInfoAboutPeers(data);

                        res.end('ok');
                    });
                }
            } else if (req.url === '/subscribeChannels') {
                if (req.method === 'POST') {
                    let body = '';
                    req.on('data', (chunk) => {
                        body += chunk.toString();
                    });
                    req.on('end', () => {
                        const data = JSON.parse(body);

                        // Assert that the data response has the same URL
                        // information as the URL we sent to
                        data.ip = this.assertIPInArrayAndReturn(
                            req.connection.remoteAddress, data.ips,
                        );

                        // Add the channel to the peer
                        this.addChannelToPeer(data.ip, data.channelNames);

                        res.end('ok');
                    });
                }
            } else if (req.url === '/message') {
                if (req.method === 'POST') {
                    let body = '';
                    req.on('data', (chunk) => {
                        body += chunk.toString();
                    });
                    req.on('end', () => {
                        this.messageReceivedCallback(body);
                        res.end('ok');
                    });
                }
            } else {
                console.log('Unrecognized request: ' + req.url);
            }
        });

        this.server.on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`Port ${port} is already in use`);
                if (port < preferedServerPort + maxTryDiffPorts) {
                    this.startServer(port + 1);
                } else {
                    alert('Error: No server ports available');
                }
            } else {
                console.log(err);
            }
        });

        this.server.on('listening', () => {
            this.port = port;
            console.log(`Server: http://${ip.address()}:${port}`);
        });

        this.server.listen(port);
    }

    /**
     * Stop the server
     */
    async stopServer() {
        return new Promise((resolve, reject) => {
            this.server.close(() => {
                resolve('Server closed');
            });
        });
    }

    /**
     * Find all devices that run HexHoot.
     */
    async findDevicesRunningHexHoot() {
        /**
         * Ensure that the server has started before attempting to find other
         * devices. If this server is not running, then some of the requests in
         * response would be missed.
         * @param {Object} server
         * @return {Promise}
         */
        function ensureServerRunning(server: http.Server) {
            return new Promise<void>((resolve, reject) => {
                if (server.listening) {
                    resolve();
                } else {
                    setTimeout(() => {
                        ensureServerRunning(server)
                            .then(() => resolve())
                            .catch((err) => reject(err));
                    }, 50);
                }
            });
        }
        await ensureServerRunning(this.server);

        /**
         * Fetch through different ports that HexHoot can take to see if the
         * given address has HexHoot runnings.
         * @param {string} address of the remove device
         */
        const fetchViaDifferentPorts = (address: string) => {
            for (let i = 0; i < maxTryDiffPorts; i++) {
                this.fetchInfo(
                    `http://${address}:${preferedServerPort + i}`);
            }
        };


        // Ping around the IP addresses that this device is assigned with
        this.ipAddresses.forEach(async (ip) => {
            // Ping around this ip address
            const addresses = range(ip, 255);
            addresses.push(ip);
            addresses.forEach(async (address: string) => {
                const res = await ping.promise.probe(
                    address, {timeout: 100, min_reply: 1});
                if (res.alive) {
                    console.log('Alive: ' + address);
                    fetchViaDifferentPorts(address);
                }
            });
        });

        // Additionally, let's see if the ARP Table can come up with other
        // connections.
        arp.get((table: any[]) => {
            table.forEach((row) => {
                if (row.InternetAddress !== '?') {
                    // Remove the enclosing brackets along with the address
                    const address = row.PhysicalAddress
                        .substring(1, row.PhysicalAddress.length - 1);

                    fetchViaDifferentPorts(address);
                }
            });
        });
    }

    /**
     * Process and save the information about an instance of HexHoot running
     * on another computer.
     * @param {Object} info information other HexHoot instance
     */
    saveInfoAboutPeers(info: any) {
        console.log('Saving info about peer: ' + JSON.stringify(info));
        // Extract information on other hosts with HexHoot
        const otherhostsWithHexHootMap = info.hostsWithHexHootMap;

        // Remove the other hosts information and store the rest
        delete info.hostsWithHexHootMap;
        this.hostsWithHexHootMap[info.ip] = info;

        // Collect the latest information from the other hosts; not
        // just copy over the information.
        Object.keys(otherhostsWithHexHootMap).forEach((ip) => {
            if (!(ip in this.hostsWithHexHootMap)) {
                this.fetchInfo(this.getURLFromIP(ip));
            }
        });
    }

    /**
     * Get URL from IP address
     * @param {string} ip ip address
     * @return {string} url to the corresponding server instance
     */
    getURLFromIP(ip: string) {
        const info = this.hostsWithHexHootMap[ip];
        return `http://${info.ip}:${info.port}`;
    }

    /**
     * Add new channels to a peer.
     * @param {string} ip ip address of the peer
     * @param {Array} channelNames Name of channels that the peer would like to
     * subscribe to
     */
    addChannelToPeer(ip: string, channelNames: string[]) {
        channelNames.forEach((channelNameStr) => {
            if (!this.hostsWithHexHootMap[ip].listOfChannelsSubscribedTo
                .includes(channelNameStr)) {
                this.hostsWithHexHootMap[ip].listOfChannelsSubscribedTo.push(
                    channelNameStr);
            }
        });
    }

    /**
     * Check if the URL has HexHoot; if yes, get information from that.
     * Furthermore, it may have already found other URLs where HexHoot is
     * running. Get information on that as well.
     * @param {string} url the full url to the server instance (would contain
     * 'http://', hostname and port)
     */
    fetchInfo(url: string) {
        http.get(url, (response) => {
            let data: any = '';

            // A chunk of data has been received.
            response.on('data', (chunk) => {
                data += chunk;
            });

            // The whole response has been received.
            response.on('end', () => {
                try {
                    data = JSON.parse(data);
                } catch (err) {
                    console.log('Invalid the response:');
                    console.log(data);
                    return;
                }
                if (data.application === 'hexhoot') {
                    // Assert that the data response has the same URL
                    // information as the URL we sent to
                    data.ip = this.assertIPInArrayAndReturn(
                        url, data.ips,
                    );

                    // Extract information about this
                    this.saveInfoAboutPeers(data);

                    // Send back information about this instance
                    const info = JSON.stringify(
                        this.getInformationAboutSelf());
                    this.sendMessage(url, info);
                }
            });
        }).on('error', (err) => {
            // Let's ignore the error. The error would be most
            // likely due to inexistence of HexHoot in the device
            // being pinged.
        });
    }

    /**
     * Ensure that the sender IP address exist in the given array of IPs
     * @param {string} url sender IP extracted through request metadata
     * @param {Array} ipAddresses array of IP addresses passed thourhg the
     * request message
     * @return {string} url, if it exists in the list
     */
    assertIPInArrayAndReturn(url: string | undefined, ipAddresses: string[]) {
        if(!url) throw new Error("URL is undefined");
        const parsedURL = require('url').parse(url);
        let hostname = '';
        if (parsedURL.hostname === null) {
            // Example: url = '::ffff:172.16.29.1'
            hostname = url.slice(url.lastIndexOf(':') + 1);
        } else {
            // Example: url = 'http://172.16.29.1'
            hostname = parsedURL.hostname;
        }

        if (!ipAddresses.includes(hostname)) {
            // throw new Error('Sender IP doesn\'t match the data provided');
            // TODO: Fix this. This is a security issue. But for now, we will
            // just return the hostname.
            console.log('Sender IP doesn\'t match the data provided');
        }
        return hostname;
    }

    /**
     * Send post request to a particular url
     * @param {string} url the full url to the server instance (would contain
     * 'http://', hostname and port)
     * @param {string} message the message that needs to be sent
     */
    sendMessage(url: string, message: string) {
        const parsedURL = require('url').parse(url);
        const req = http.request({
            hostname: parsedURL.hostname,
            port: parsedURL.port,
            path: parsedURL.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(message),
            },
        }, (res) => {
            res.resume();
            res.on('end', () => {
                if (!res.complete) {
                    console.error('Connection terminated before completion');
                }
            });
        });
        req.write(message);
        req.end();
    }

    /**
     * What to do when a channel receives a message
     * message arrives.
     * @param {*} message The message that was received in the channel
     */
    messageReceivedCallback(message: any) {
        const messageObj = JSON.parse(message);

        const sharedKeyString = utils.getSharedKey(
            this.userInfo.privateKey, messageObj.senderPublicKey);

        messageObj.iv = Buffer.from(messageObj.iv); // Ensuring the type
        const decrypted = utils.decryptMessage(
            messageObj.message, sharedKeyString, messageObj.iv);
        messageObj.message = JSON.parse(decrypted);

        console.log('Message received (intranet):');
        console.log(messageObj);

        // Send this information to DBMessenger
        this.messageReceiveCallbackFunction(messageObj);
    }

    /**
     * Send message to all known devices stating that you are subscribing to
     * this channel.
     * @param {Buffer | string} channelName name of the channel
     */
    async subscribeToChannel(channelName: Buffer | string) {
        let channelNameStr = '';
        if (typeof(channelName) === 'string') {
            channelNameStr = channelName;
            channelName = utils.stringToBuffer(channelName);
        } else {
            channelNameStr = utils.bufferToString(channelName);
        }
        if (this.listOfChannelsSubscribedTo.includes(channelNameStr)) {
            // Already subscribed to the channel
            console.log('Already subscribed to the channel');
            return;
        }

        // Let every HexHoot instance know that this instance is subscribed to
        // this channel
        let message: any = {};
        message.ip = ip.address();
        message.ips = this.ipAddresses;
        message.channelNames = [channelNameStr];
        message = JSON.stringify(message);
        Object.keys(this.hostsWithHexHootMap).forEach((ip) => {
            this.sendMessage(
                this.getURLFromIP(ip) + '/subscribeChannels',
                message,
            );
        });

        console.log('Subscribed to channel (intranet): ' + channelNameStr);
        this.listOfChannelsSubscribedTo.push(channelNameStr);
    }

    /**
     * Send a message to a channel
     * @param {Buffer | string} channelName is also the other user's public key
     * @param {any} message
     */
    sendMessageToChannel(channelName: Buffer | string, message: any) {
        let channelNameStr = '';
        let channelNameBuf: Buffer;
        if (typeof(channelName) === 'string') {
            channelNameStr = channelName;
            channelNameBuf = utils.stringToBuffer(channelName);
        } else {
            channelNameStr = utils.bufferToString(channelName);
            channelNameBuf = channelName;
        }

        // Encrypt the message using the shared key
        const sharedKeyString =
            utils.getSharedKey(this.userInfo.privateKey, channelNameBuf.toString('hex'));

        let iv: Buffer = Buffer.alloc(0);
        let ret: [string, Buffer];
        ret = utils.encryptMessage(
            JSON.stringify(message), sharedKeyString);
        let encryptedMessage = ret[0];
        iv = ret[1];

        // Add sender and 'iv' informations to the message, which are needed to
        // decrypt the message
        message = JSON.stringify({
            'senderPublicKey': this.userPublicKey,
            'iv': iv,
            'message': encryptedMessage,
        });

        console.log('Sending message to channel (intranet): ' +
            channelNameStr);

        for (const [ip, info] of Object.entries(this.hostsWithHexHootMap)) {
            if ((info as any).listOfChannelsSubscribedTo.includes(channelNameStr)) {
                this.sendMessage(
                    this.getURLFromIP(ip) + '/message',
                    message,
                );
            }
        }
    }

    /**
     * Set callback function which gets triggered when new messages arrive in
     * subscribed channels.
     * @param {function} func callback function that gets invoked when a new
     * new message is received
     */
    setMessageReceiveCallbackFunction(func: (msg: any) => void) {
        this.messageReceiveCallbackFunction = func;
    }
}
