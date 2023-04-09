/* Copyright (c) 2023 Zenin Easa Panthakkalakath */

const ip = require('ip');
const http = require('http');
const arp = require('arptable-js');
const arpulate = require('arpulate');
const assert = require('assert');

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

        // Populate the system ARP table by pinging a range of surrounding
        // IP addresses
        arpulate(ip.address(), 254, async function() {
            console.log('Pinged a few surrounding IP Addresses');
        });

        this.hostsWithHexHoot = {};
        this.listOfChannelsSubscribedTo = [];
        this.messageReceiveCallbackFunction = function() {};

        IntranetMessenger._instance.initialize();
    }

    /**
     * Initialize IntranetMessenger
     */
    async initialize() {
        this.userInfo = (await dbWrapper().getAll('LoggedInUserInfo'))[0];
        if (this.userInfo) {
            this.userPublicKey =
                utils.getPublicKeyFromPrivateKey(this.userInfo.privateKey);
            this.subscribeToChannel(
                utils.stringToBuffer(this.userPublicKey), true);
        }

        this.startServer(preferedServerPort);
        this.findDevicesRunningHexHoot();
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
        info.port = this.port;
        info.hostsWithHexHoot = this.hostsWithHexHoot;
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
                        assert(req.connection.remoteAddress.includes(data.ip));
                        // TODO: How do we take care of proxy forwarding???

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
                        assert(req.connection.remoteAddress.includes(data.ip));
                        // TODO: How do we take care of proxy forwarding???

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
        const otherHostsWithHexHoot = info.hostsWithHexHoot;

        // Remove the other hosts information and store the rest
        delete info.hostsWithHexHoot;
        this.hostsWithHexHoot[info.ip] = info;

        // Collect the latest information from the other hosts; not
        // just copy over the information.
        Object.keys(otherHostsWithHexHoot).forEach(function(ip) {
            if (!ip in this.hostsWithHexHoot) {
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
        const info = this.hostsWithHexHoot[ip];
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
            if (!this.hostsWithHexHoot[ip].listOfChannelsSubscribedTo
                .includes(channelNameStr)) {
                this.hostsWithHexHoot[ip].listOfChannelsSubscribedTo.push(
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
                    assert(url.includes(data.ip));

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
        Object.keys(this.hostsWithHexHoot).forEach(function(ip) {
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

        for (const [ip, info] of Object.entries(this.hostsWithHexHoot)) {
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
