/* Copyright (c) 2022-2023 Zenin Easa Panthakkalakath */

const Hyperswarm = require('hyperswarm');
const utils = require('./utils');

// TODO: See if this dependency can be removed
const dbWrapper = require('./DBWrapper');

/**
 * This class contains methods to send and receive messages from peers
 */
class Messenger {
    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (Messenger._instance) {
            return Messenger._instance;
        }
        Messenger._instance = this;

        this.swarms = [];
        this.listOfChannelsSubscribedTo = [];
        this.messageReceiveCallbackFunction = function() {};
        this.connMap = [];

        Messenger._instance.initialize();
    }

    /**
     * Initialize messenger
     */
    async initialize() {
        this.userInfo = (await dbWrapper().getAll('LoggedInUserInfo'))[0];
        if (this.userInfo) {
            this.userPublicKey =
                utils.getPublicKeyFromPrivateKey(this.userInfo.privateKey);
            this.subscribeToChannel(
                utils.stringToBuffer(this.userPublicKey), true);
        }
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

        console.log('Message received:');
        console.log(messageObj);

        this.messageReceiveCallbackFunction(messageObj);
    }

    /**
     * Display error message in the console
     * @param {*} err Error message
     */
    errorCallback(err) {
        console.log(err);
    }

    /**
     * Subscribe for messages from a channel
     * @param {Buffer} channelName The channel name can be other users
     * @param {boolean} isServer whether it is joining as a server or not
     * public key or shared key between two (or more) users
     */
    async subscribeToChannel(channelName, isServer) {
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

        this.swarms.push(new Hyperswarm());
        const idx = this.swarms.length - 1;

        this.swarms[idx].on('connection', function(conn, peerInfo) {
            conn.on('error', this.errorCallback.bind(this));
            conn.on('data', this.messageReceivedCallback.bind(this));
        }.bind(this));

        const discovery = this.swarms[idx].join(
            channelName, {server: isServer, client: !isServer});
        await discovery.flushed();

        console.log('Subscribed to channel: ' + channelNameStr);
        this.listOfChannelsSubscribedTo.push(channelNameStr);
    }

    /**
     * Send a message to a channel
     * @param {Buffer} channelName is also the other user's public key
     * @param {string} message
     */
    async sendMessageToChannel(channelName, message) {
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

        console.log('Sending message to channel: ' +
            utils.bufferToString(channelName));

        if (typeof(this.connMap[channelNameStr]) === 'undefined') {
            const tempSwarm = new Hyperswarm();
            tempSwarm.on('connection', function(conn) {
                conn.on('error', this.errorCallback.bind(this));
                conn.on('data', this.messageReceivedCallback.bind(this));
                conn.write(message);
                this.connMap[channelNameStr] = conn;
            }.bind(this));

            tempSwarm.join(
                channelName, {server: false, client: true},
            );
            await tempSwarm.flush();
        } else {
            this.connMap[channelNameStr].write(message);
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
    return new Messenger();
};
