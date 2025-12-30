/* Copyright (c) 2022-2025 Zenin Easa Panthakkalakath */

import Hyperswarm = require('hyperswarm');
import * as utils from './utils';
import DBWrapper from './DBWrapper';
const dbWrapper = new DBWrapper();

/**
 * This class contains methods to send and receive messages from peers
 */
export default class Messenger {
    private static _instance: Messenger;
    private subscribedSwarms: any[] = [];
    private senderSwarms: any[] = [];
    private listOfChannelsSubscribedTo: string[] = [];
    private messageReceiveCallbackFunction: (msg: any) => void = () => {};
    private connMap: {[key: string]: any} = {};
    private userInfo: any;
    private userPublicKey: string;

    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (Messenger._instance) {
            return Messenger._instance;
        }
        Messenger._instance = this;

        this.subscribedSwarms = [];
        this.senderSwarms = [];
        this.listOfChannelsSubscribedTo = [];
        this.messageReceiveCallbackFunction = function() {};
        this.connMap = {};

        this.initialize();
    }

    /**
     * Initialize messenger
     */
    async initialize() {
        const users = await dbWrapper.getAll('LoggedInUserInfo');
        this.userInfo = users[0];
        if (this.userInfo) {
            this.userPublicKey =
                utils.getPublicKeyFromPrivateKey(this.userInfo.privateKey);
            this.subscribeToChannel(
                utils.stringToBuffer(this.userPublicKey), true);
        }
    }

    /**
     * Cleanup Messenger
     */
    async cleanup() {
    }

    /**
     * Re-initialize Messenger
     */
    async reInitialize() {
        await this.cleanup();
        await this.initialize();
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

        console.log('Message received:');
        console.log(messageObj);

        this.messageReceiveCallbackFunction(messageObj);
    }

    /**
     * Subscribe for messages from a channel
     * @param {Buffer | string} channelName The channel name can be other users
     * @param {boolean} isServer whether it is joining as a server or not
     * public key or shared key between two (or more) users
     */
    async subscribeToChannel(channelName: Buffer | string, isServer: boolean) {
        let channelNameStr = '';
        let channelNameBuf: Buffer;
        if (typeof(channelName) === 'string') {
            channelNameStr = channelName;
            channelNameBuf = utils.stringToBuffer(channelName);
        } else {
            channelNameStr = utils.bufferToString(channelName);
            channelNameBuf = channelName;
        }
        if (this.listOfChannelsSubscribedTo.includes(channelNameStr)) {
            // Already subscribed to the channel
            console.log('Already subscribed to the channel');
            return;
        }

        const idx = this.subscribedSwarms.length;
        this.subscribedSwarms.push(new Hyperswarm());

        this.subscribedSwarms[idx].on('connection', (conn: any, peerInfo: any) => {
            conn.on('error', this.errorCallback.bind(this));
            conn.on('data', this.messageReceivedCallback.bind(this));
        });

        const discovery = this.subscribedSwarms[idx].join(
            channelNameBuf, {server: isServer, client: !isServer});
        await discovery.flushed();

        console.log('Subscribed to channel: ' + channelNameStr);
        this.listOfChannelsSubscribedTo.push(channelNameStr);
    }

    /**
     * Send a message to a channel
     * @param {Buffer | string} channelName is also the other user's public key
     * @param {any} message
     */
    async sendMessageToChannel(channelName: Buffer | string, message: any) {
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
            utils.getSharedKey(this.userInfo.privateKey, channelNameBuf.toString('hex')); // fix: verify if channelName is pk

        let iv: Buffer = Buffer.alloc(0);
        let ret: [string, Buffer];
        ret = utils.encryptMessage(
            JSON.stringify(message), sharedKeyString);
        let encryptedMessage = ret[0];
        iv = ret[1];

        // Add sender and 'iv' informations to the message, which are needed to
        // decrypt the message
        const finalMessage = JSON.stringify({
            'senderPublicKey': this.userPublicKey,
            'iv': iv,
            'message': encryptedMessage,
        });

        console.log('Sending message to channel: ' + channelNameStr);

        if (typeof(this.connMap[channelNameStr]) === 'undefined') {
            const idx = this.senderSwarms.length;
            this.senderSwarms.push(new Hyperswarm());
            this.senderSwarms[idx].on('connection', (conn: any) => {
                conn.on('error', this.errorCallback.bind(this));
                conn.on('data', this.messageReceivedCallback.bind(this));
                conn.write(finalMessage);
                this.connMap[channelNameStr] = conn;
            });

            this.senderSwarms[idx].join(
                channelNameBuf, {server: false, client: true},
            );
            await this.senderSwarms[idx].flush();
            // TODO: Perhaps for a more reliable communication, we should not
            // use a temporary connection. We could have a more premanent
            // connection.
        } else {
            this.connMap[channelNameStr].write(finalMessage);
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

    /**
     * Display error message in the console
     * @param {*} err Error message
     */
    errorCallback(err: any) {
        console.log(err);
    }
}
