/* Copyright (c) 2023 Zenin Easa Panthakkalakath */

const os = require('os');
const ip = require('ip');
const http = require('http');
const arp = require('arptable-js');
const arpulate = require('arpulate');
const {networkInterfaces} = require('@leichtgewicht/network-interfaces');

const utils = require('./utils');
const dbWrapper = require('./DBWrapper');

// Largest possible port number is 65535. Choose a number lower than that, but
// not potentially used by other applications.
const preferedServerPort = 43946;
const maxTryDiffPorts = 10;

/**
 * This is a singleton class.
 * The responsibility of this class are:
 * 1. Find machines in the local network (intranet) that are running HexHoot.
 * 2. Establish communication with these devices.
 */
class IntranetMessenger {
    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (IntranetMessenger._instance) {
            return IntranetMessenger._instance;
        }
        IntranetMessenger._instance = this;

        this.listOfChannelsSubscribedTo = [];
        this.messageReceiveCallbackFunction = function() {};

        this.lastInitTimestamp = Date.now();
        IntranetMessenger._instance.initialize();

        // If there is a network change detected, re-initialize
        networkInterfaces.on('change', async function(e) {
            if (this.lastInitTimestamp + 2000 < Date.now()) {
                this.lastInitTimestamp = Date.now();
                await IntranetMessenger._instance.initialize();
            }
        }.bind(this));
    }

    /**
     * Initialize IntranetMessenger
     */
    async initialize() {
        console.log('Initializing intranet messenger');
        this.ipAddresses = [];
        await this.populateARPTableAndIpAddresses();
        this.hostsWithHexHootMap = {};

        this.startServer(preferedServerPort);
        this.findDevicesRunningHexHoot();

        this.userInfo = (await dbWrapper().getAll('LoggedInUserInfo'))[0];
        if (this.userInfo) {
            this.userPublicKey =
                utils.getPublicKeyFromPrivateKey(this.userInfo.privateKey);
            this.subscribeToChannel(
                utils.stringToBuffer(this.userPublicKey), true);
        }
    }

    /**
     * Ping surrounding IP Addresses to populate the ARP table
     * @return {Promise} promise that resolves once pinging the range is
     * complete
     */
    populateARPTableAndIpAddresses() {
        // Get all IP Addresses that is associated with this system
        const net = os.networkInterfaces();
        const promises = [];
        Object.values(net).forEach(function(netInterface) {
            netInterface.forEach(function(info) {
                if (
                    info.address.startsWith('192.') ||
                    info.address.startsWith('172.') ||
                    info.address.startsWith('10.')
                ) {
                    this.ipAddresses.push(info.address);
                    promises.push(new Promise(function(resolve, reject) {
                        // Populate the system ARP table by pinging a range of
                        // surrounding IP addresses
                        arpulate(info.address, 254, async function() {
                            console.log(`Pinged around ${info.address}`);
                            resolve('ARP Table loaded');
                        });
                    }));
                }
            }.bind(this));
        }.bind(this));

        return Promise.allSettled(promises);
    }

    /**
     * Information about this HexHoot instance
     * @return {Object} Information about this HexHoot instance
     */
    getInformationAboutSelf() {
        const info = {};
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
    startServer(port) {
        const server = http.createServer(function(req, res) {
            if (req.url === '/') {
                if (req.method === 'GET') {
                    const response = this.getInformationAboutSelf();
                    res.writeHead(200, {'Content-Type': 'application/json'});
                    res.write(JSON.stringify(response));
                    res.end();
                } else if (req.method === 'POST') {
                    let body = '';
                    req.on('data', function(chunk) {
                        body += chunk.toString();
                    });
                    req.on('end', function() {
                        const data = JSON.parse(body);

                        // Assert that the data response has the same URL
                        // information as the URL we sent to
                        data.ip = this.assertIPInArrayAndReturn(
                            req.connection.remoteAddress, data.ips
                        );

                        // Extract information about this
                        this.saveInfoAboutPeers(data);

                        res.end('ok');
                    }.bind(this));
                }
            } else if (req.url === '/subscribeChannels') {
                if (req.method === 'POST') {
                    let body = '';
                    req.on('data', function(chunk) {
                        body += chunk.toString();
                    });
                    req.on('end', function() {
                        const data = JSON.parse(body);

                        // Assert that the data response has the same URL
                        // information as the URL we sent to
                        data.ip = this.assertIPInArrayAndReturn(
                            req.connection.remoteAddress, data.ips
                        );

                        // Add the channel to the peer
                        this.addChannelToPeer(data.ip, data.channelNames);

                        res.end('ok');
                    }.bind(this));
                }
            } else if (req.url === '/message') {
                if (req.method === 'POST') {
                    let body = '';
                    req.on('data', function(chunk) {
                        body += chunk.toString();
                    });
                    req.on('end', function() {
                        console.log('Message received (intranet): ' + body);
                        this.messageReceivedCallback(body);
                        res.end('ok');
                    }.bind(this));
                }
            } else {
                console.log('Unrecognized request: ' + req.url);
            }
        }.bind(this));

        server.on('error', function(err) {
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
        }.bind(this));

        server.on('listening', function() {
            this.port = port;
            console.log(`Server: http://${ip.address()}:${port}`);
        }.bind(this));

        server.listen(port);
    }

    /**
     * Find all devices that run HexHoot.
     */
    findDevicesRunningHexHoot() {
        arp.get(function(table) {
            table.forEach(async function(row) {
                // The address is enclosed in brackets; we need to remove that
                const address = row.PhysicalAddress
                    .substring(1, row.PhysicalAddress.length - 1);

                // Search through different ports that HexHoot can take to see
                // if the given address has HexHoot runnings
                for (let i = 0; i < maxTryDiffPorts; i++) {
                    this.fetchInfo(
                        `http://${address}:${preferedServerPort + i}`);
                }
            }.bind(this));
        }.bind(this));
    }

    /**
     * Process and save the information about an instance of HexHoot running
     * on another computer.
     * @param {Object} info information other HexHoot instance
     */
    saveInfoAboutPeers(info) {
        // Extract information on other hosts with HexHoot
        const otherhostsWithHexHootMap = info.hostsWithHexHootMap;

        // Remove the other hosts information and store the rest
        delete info.hostsWithHexHootMap;
        this.hostsWithHexHootMap[info.ip] = info;

        // Collect the latest information from the other hosts; not
        // just copy over the information.
        Object.keys(otherhostsWithHexHootMap).forEach(function(ip) {
            if (!ip in this.hostsWithHexHootMap) {
                this.fetchInfo(this.getURLFromIP(ip));
            }
        }.bind(this));
    }

    /**
     * Get URL from IP address
     * @param {string} ip ip address
     * @return {string} url to the corresponding server instance
     */
    getURLFromIP(ip) {
        const info = this.hostsWithHexHootMap[ip];
        return `http://${info.ip}:${info.port}`;
    }

    /**
     * Add new channels to a peer.
     * @param {string} ip ip address of the peer
     * @param {Array} channelNames Name of channels that the peer would like to
     * subscribe to
     */
    addChannelToPeer(ip, channelNames) {
        channelNames.forEach(function(channelNameStr) {
            if (!this.hostsWithHexHootMap[ip].listOfChannelsSubscribedTo
                .includes(channelNameStr)) {
                this.hostsWithHexHootMap[ip].listOfChannelsSubscribedTo.push(
                    channelNameStr);
            }
        }.bind(this));
    }

    /**
     * Check if the URL has HexHoot; if yes, get information from that.
     * Furthermore, it may have already found other URLs where HexHoot is
     * running. Get information on that as well.
     * @param {string} url the full url to the server instance (would contain
     * 'http://', hostname and port)
     */
    fetchInfo(url) {
        http.get(url, function(response) {
            let data = '';

            // A chunk of data has been received.
            response.on('data', function(chunk) {
                data += chunk;
            });

            // The whole response has been received.
            response.on('end', function() {
                data = JSON.parse(data);
                if (data.application === 'hexhoot') {
                    // Assert that the data response has the same URL
                    // information as the URL we sent to
                    data.ip = this.assertIPInArrayAndReturn(
                        url, data.ips
                    );

                    // Extract information about this
                    this.saveInfoAboutPeers(data);

                    // Send back information about this instance
                    const info = JSON.stringify(
                        this.getInformationAboutSelf());
                    this.sendMessage(url, info);
                }
            }.bind(this));
        }.bind(this)).on('error', function(err) {
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
    assertIPInArrayAndReturn(url, ipAddresses) {
        const parsedURL = require('url').parse(url);
        var hostname = '';
        if (parsedURL.hostname === null) {
            // Example: url = '::ffff:172.16.29.1'
            hostname = url.slice(url.lastIndexOf(':') + 1);
        } else {
            // Example: url = 'http://172.16.29.1'
            hostname = parsedURL.hostname;
        }

        if(!ipAddresses.includes(hostname)) {
            throw new Error("Sender IP doesn't match the data provided");
        }
        return hostname;
    }

    /**
     * Send post request to a particular url
     * @param {string} url the full url to the server instance (would contain
     * 'http://', hostname and port)
     * @param {string} message the message that needs to be sent
     */
    sendMessage(url, message) {
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
        }, function(res) {
            res.resume();
            res.on('end', function() {
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
    messageReceivedCallback(message) {
        const messageObj = JSON.parse(message);

        const sharedKeyString = utils.getSharedKey(
            this.userInfo.privateKey, messageObj.senderPublicKey);

        messageObj.iv = Buffer.from(messageObj.iv); // Ensuring the type
        messageObj.message = JSON.parse(utils.decryptMessage(
            messageObj.message, sharedKeyString, messageObj.iv));

        console.log('Message received (intranet):');
        console.log(messageObj);

        // Send this information to DBMessenger
        this.messageReceiveCallbackFunction(messageObj);
    }

    /**
     * Send message to all known devices stating that you are subscribing to
     * this channel.
     * @param {string} channelName name of the channel
     */
    async subscribeToChannel(channelName) {
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
        let message = {};
        message.ip = ip.address();
        message.channelNames = [channelNameStr];
        message = JSON.stringify(message);
        Object.keys(this.hostsWithHexHootMap).forEach(function(ip) {
            this.sendMessage(
                this.getURLFromIP(ip) + '/subscribeChannels',
                message,
            );
        }.bind(this));

        console.log('Subscribed to channel (intranet): ' + channelNameStr);
        this.listOfChannelsSubscribedTo.push(channelNameStr);
    }

    /**
     * Send a message to a channel
     * @param {Buffer} channelName is also the other user's public key
     * @param {string} message
     */
    sendMessageToChannel(channelName, message) {
        let channelNameStr = '';
        if (typeof(channelName) === 'string') {
            channelNameStr = channelName;
            channelName = utils.stringToBuffer(channelName);
        } else {
            channelNameStr = utils.bufferToString(channelName);
        }

        // Encrypt the message using the shared key
        const sharedKeyString =
            utils.getSharedKey(this.userInfo.privateKey, channelName);

        let iv = [];
        [message, iv] = utils.encryptMessage(
            JSON.stringify(message), sharedKeyString);

        // Add sender and 'iv' informations to the message, which are needed to
        // decrypt the message
        message = JSON.stringify({
            'senderPublicKey': this.userPublicKey,
            'iv': iv,
            'message': message,
        });

        console.log('Sending message to channel (intranet): ' +
            channelNameStr);

        for (const [ip, info] of Object.entries(this.hostsWithHexHootMap)) {
            if (info.listOfChannelsSubscribedTo.includes(channelNameStr)) {
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
    setMessageReceiveCallbackFunction(func) {
        this.messageReceiveCallbackFunction = func;
    }
}

module.exports = function() {
    return new IntranetMessenger();
};
