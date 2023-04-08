/* Copyright (c) 2023 Zenin Easa Panthakkalakath */

const ip = require('ip');
const http = require('http');
const arp = require('arptable-js');
const arpulate = require('arpulate');

// Largest possible port number is 65535. Choose a number lower than that, but
// not potentially used by other applications.
const preferedServerPort = 43946;
const maxTryDiffPorts = 10;

// TODO: Implmenet channel message sending and receiing just like hat we have
// in Messenger.js.

/**
 * This is a singleton class.
 * The responsibility of this class are:
 * 1. Find machines in the local network (intranet) that are running HexHoot.
 * 2. Establish communication with these devices.
 */
class IntranetCommunicator {
    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (IntranetCommunicator._instance) {
            return IntranetCommunicator._instance;
        }
        IntranetCommunicator._instance = this;
        IntranetCommunicator._instance.initialize();
    }

    /**
     * Initialize IntranetCommunicator
     */
    initialize() {
        // This gets invoked recursively if the port is not free
        this.startServer(preferedServerPort);

        this.hostsWithHexHoot = [];
        this.findDeviesRunningHexHoot();

        // Populate the system ARP table by pinging a range of surrounding
        // IP addresses
        arpulate(ip.address(), 254, async function() {
            console.log('Pinged a few surrounding IP Addresses');
        });
    }

    /**
     * Start the HTTP server.
     * This gets invoked recursively if the port is not free. The port number
     * is increased by one in each successive recursive call.
     * @param {number} port the port in which we would like to start the server
     */
    startServer(port) {
        const server = http.createServer(function(req, res) {
            const response = {};
            response.application = process.env.npm_package_name;
            response.version = process.env.npm_package_version;
            response.ip = ip.address();
            response.port = port;
            response.hostsWithHexHoot = this.hostsWithHexHoot;

            res.writeHead(200, {'Content-Type': 'application/json'});
            res.write(JSON.stringify(response));
            res.end();
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
            console.log(`Server: http://${ip.address()}:${port}`);
        });

        server.listen(port);
    }

    /**
     * Find all devices that run HexHoot.
     */
    findDeviesRunningHexHoot() {
        const that = this;
        arp.get(function(table) {
            table.forEach(async function(row) {
                const address = row.PhysicalAddress
                    .substring(1, row.PhysicalAddress.length - 1);

                // Check if this 'address' has HexHoot
                for (let i = 0; i < maxTryDiffPorts; i++) {
                    const url = `http://${address}:${preferedServerPort + i}`;
                    http.get(url, function(response) {
                        let data = '';

                        // A chunk of data has been received.
                        response.on('data', function(chunk) {
                            data += chunk;
                        });

                        // The whole response has been received.
                        response.on('end', function() {
                            console.log(data);
                            data = JSON.parse(data);
                            if (data.application === 'hexhoot') {
                                that.hostsWithHexHoot.push(url);
                                // TODO: Import hosts detected by this peer.
                            }
                        });
                    }).on('error', function(err) {
                        // Let's ignore the error
                        // console.log("Error: " + err.message);
                    });
                }
            });
        });
    }
}

module.exports = function() {
    return new IntranetCommunicator();
};
