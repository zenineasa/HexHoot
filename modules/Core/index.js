/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

const os = require('os');
const v1Crypto = require('./v1Crypto');
const sanitize = require('./../Sanitize/index.mjs');
const {tableNames, messageType} = require('./constants.mjs');

// Name of the preference that holds friend requests waiting for the user to
// accept or decline them
const pendingRequestsPreference = 'pendingFriendRequests';

/**
 * HexHoot Core: storage, protocol and transports, with no UI and no
 * Electron dependency. In the app it runs in a utilityProcess (see main.js);
 * tests import it directly with in-memory storage.
 */
class Core {
    /**
     * @param {Object} options
     * @param {Storage} options.storage the database
     * @param {Array} [options.transports] carriers of v1 envelopes, each with
     * start(publicKey), stop(), send(recipient, envelope) and onMessage(func)
     * @param {boolean} [options.watchNetwork] restart the transports when
     * the network interfaces change
     * @param {function} [options.log] logger
     */
    constructor(options) {
        this.storage = options.storage;
        this.transports = options.transports || [];
        this.watchNetwork = Boolean(options.watchNetwork);
        this.log = options.log || console.log;
        this.tableNames = tableNames;
        this.messageType = messageType;
        this.eventListeners = new Set();
        this.identity = null;
        for (const transport of this.transports) {
            transport.onMessage((envelope) => this.receiveEnvelope(envelope));
        }
    }

    /** Load the account, if there is one, and start the transports */
    async start() {
        await this.restartTransports();
        if (this.watchNetwork) {
            let interfaces = JSON.stringify(os.networkInterfaces());
            this.networkTimer = setInterval(() => {
                const now = JSON.stringify(os.networkInterfaces());
                if (now !== interfaces) {
                    interfaces = now;
                    this.log('Network interface change detected');
                    this.restartTransports();
                }
            }, 5000);
            this.networkTimer.unref();
        }
    }

    /** Stop the transports and close the database */
    async stop() {
        clearInterval(this.networkTimer);
        await Promise.allSettled(this.transports.map((t) => t.stop()));
        this.storage.close();
    }

    /**
     * (Re)start every transport with the current identity; stop them if
     * there is no account.
     */
    async restartTransports() {
        const user = this.storage.get(tableNames.loggedInUser, 0);
        this.identity = user ? {
            privateKey: user.privateKey,
            publicKey: v1Crypto.getPublicKeyFromPrivateKey(user.privateKey),
        } : null;
        await Promise.all(this.transports.map(async (transport) => {
            try {
                if (this.identity) {
                    await transport.start(this.identity.publicKey);
                } else {
                    await transport.stop();
                }
            } catch (err) {
                this.log(`Transport ${transport.name} failed to start:`, err);
            }
        }));
    }

    /**
     * Listen to Core events. Events are plain objects: currently only
     * {type: 'message', senderPublicKey, message, isFromFriend}.
     * @param {function} func listener
     * @return {function} call to stop listening
     */
    onEvent(func) {
        this.eventListeners.add(func);
        return () => this.eventListeners.delete(func);
    }

    /**
     * @param {Object} event the event
     */
    emit(event) {
        for (const func of this.eventListeners) {
            try {
                func(event);
            } catch (err) {
                this.log('Error in event listener:', err);
            }
        }
    }

    /**
     * The state of each transport, for the UI and tests. Holds no key
     * material.
     * @return {Array} [{name, ready, ...}]
     */
    getTransportStatus() {
        return this.transports.map((transport) => transport.status ?
            transport.status() : {name: transport.name, ready: true});
    }

    /** Delete everything and stop the transports */
    async deleteDatabaseContent() {
        this.storage.clear();
        await this.restartTransports();
    }

    /**
     * Get the list of all friends
     * @return {Array} the list of all friends
     */
    async getAllFriends() {
        return this.storage.getAll(tableNames.friends);
    }

    /**
     * Get the information of the logged in user. Note, this should not be
     * shared with anyone else as it contains the user's private key.
     * @return {Object} user information
     */
    async getLoggedInUserInfoPrivate() {
        return this.storage.get(tableNames.loggedInUser, 0);
    }

    /**
     * Get the information of the logged in user, which can be shared with the
     * others.
     * @return {Object} user information
     */
    async getLoggedInUserInfoPublic() {
        const userInfo = await this.getLoggedInUserInfoPrivate();
        if (!userInfo) {
            return undefined;
        }
        userInfo.key = v1Crypto.getPublicKeyFromPrivateKey(
            userInfo.privateKey);
        delete userInfo.privateKey;
        return userInfo;
    }

    /**
     * Get the information of a particular person
     * @param {string} otherUserPublicKey user key of the other person
     * @return {Object} user information
     */
    async getUserInfo(otherUserPublicKey) {
        const loggedInUserInfo = await this.getLoggedInUserInfoPublic();
        if (loggedInUserInfo && loggedInUserInfo.key === otherUserPublicKey) {
            return loggedInUserInfo;
        }
        return this.storage.get(tableNames.friends, otherUserPublicKey);
    }

    /**
     * Write information about the user. A new private key is derived only
     * when a password is given (login); a profile edit keeps the existing
     * key. A private key supplied by the caller is never used.
     * @param {Object} info information about the user
     */
    async writeLoggedInUserInfo(info) {
        const existing = this.storage.get(tableNames.loggedInUser, 0);
        const profile = {
            key: 0,
            displayName: typeof info.displayName === 'string' ?
                info.displayName : existing?.displayName ?? '',
            about: typeof info.about === 'string' ?
                info.about : existing?.about ?? '',
            photo: typeof info.photo === 'string' ?
                info.photo : existing?.photo ?? '',
        };
        if (typeof info.password === 'string' && info.password !== '') {
            // v1 read 'username', which the login form never sent, so the
            // key depended on the password alone (finding S5)
            profile.privateKey = v1Crypto.generatePrivateKey({
                username: profile.displayName, password: info.password});
        } else if (existing) {
            profile.privateKey = existing.privateKey;
        } else {
            throw new Error('A password is needed to create an account');
        }
        this.storage.put(tableNames.loggedInUser, profile);

        // The public key may have changed, so listen on the new channel
        await this.restartTransports();

        // Report to every friend regarding this change.
        for (const friendInfo of await this.getAllFriends()) {
            this.sendRequestOrResponse(
                friendInfo, messageType.userInfoResponse);
        }
    }

    /**
     * Store a chat message and send it
     * @param {string} otherUserPublicKey user key of the other person
     * @param {Object} message the message and information associated with it
     */
    async sendChatMessage(otherUserPublicKey, message) {
        const chatMessage = sanitize.sanitizeChatMessage(message);
        if (!sanitize.isValidKey(otherUserPublicKey) || !chatMessage) {
            throw new Error('Invalid chat message');
        }
        chatMessage.type = 'sent';
        this.storage.putChat({
            key: otherUserPublicKey,
            timestamp: chatMessage.timestamp,
            message: chatMessage,
        });
        this.storage.put(tableNames.friends, {
            key: otherUserPublicKey,
            lastMessageTimestamp: chatMessage.timestamp,
            isRead: false,
        });
        await this.sendEnvelope(otherUserPublicKey,
            {type: messageType.chat, message: chatMessage});
    }

    /**
     * Update read flag; for notification to stop showing.
     * @param {string} otherUserPublicKey user key of the other person
     */
    async markChatRead(otherUserPublicKey) {
        if (this.storage.get(tableNames.friends, otherUserPublicKey)) {
            this.storage.put(tableNames.friends,
                {key: otherUserPublicKey, isRead: true});
        }
    }

    /**
     * Get all messages exchanged with a user, oldest first
     * @param {string} otherUserPublicKey user key of the other person
     * @return {Array} rows of {key, timestamp, message}
     */
    async getAllMessages(otherUserPublicKey) {
        return this.storage.getChat(otherUserPublicKey);
    }

    /**
     * Export the whole database
     * @return {string} JSON backup
     */
    async exportBackup() {
        return JSON.stringify(this.storage.export());
    }

    /**
     * Replace the whole database with a backup
     * @param {string} json JSON backup
     */
    async importBackup(json) {
        this.storage.import(JSON.parse(json));
        await this.restartTransports();
    }

    /**
     * Generate a new private key.
     * @return {string} a 32 character string depicting a private key
     */
    async generatePrivateKey() {
        return v1Crypto.generatePrivateKey();
    }

    /**
     * Get public key of the logged in user
     * @return {string} the public key corresponding to the logged in user's
     * private key
     */
    async getPublicKeyOfLoggedInUser() {
        const userInfo = await this.getLoggedInUserInfoPrivate();
        return userInfo ?
            v1Crypto.getPublicKeyFromPrivateKey(userInfo.privateKey) :
            undefined;
    }

    /**
     * Send friend request, or send an update on user information
     * @param {Object} otherUserInfo information about the other user
     * @param {string} requestType type of the request
     */
    async sendRequestOrResponse(otherUserInfo, requestType) {
        if (requestType !== messageType.friendRequest &&
            requestType !== messageType.userInfoResponse) {
            throw new Error('Invalid request type');
        }
        await this.sendEnvelope(otherUserInfo.key, {
            type: requestType,
            senderInfo: await this.getLoggedInUserInfoPublic(),
        });
    }

    /**
     * Encrypt a message for a user and hand it to every transport
     * @param {string} recipient their public key
     * @param {Object} message the message
     */
    async sendEnvelope(recipient, message) {
        if (!this.identity) {
            throw new Error('Not logged in');
        }
        if (!sanitize.isValidKey(recipient)) {
            throw new Error('Invalid public key');
        }
        const sharedKey =
            v1Crypto.getSharedKey(this.identity.privateKey, recipient);
        const [ciphertext, iv] =
            v1Crypto.encryptMessage(JSON.stringify(message), sharedKey);
        const envelope = JSON.stringify({
            senderPublicKey: this.identity.publicKey,
            iv: iv,
            message: ciphertext,
        });
        const results = await Promise.allSettled(this.transports.map(
            (transport) => transport.send(recipient, envelope)));
        for (const result of results) {
            if (result.status === 'rejected') {
                this.log('Send failed:', result.reason);
            }
        }
    }

    /**
     * Decrypt an envelope received by a transport
     * @param {string} envelope the envelope
     */
    async receiveEnvelope(envelope) {
        let messageObj;
        try {
            messageObj = JSON.parse(envelope);
            if (!this.identity || !messageObj ||
                !sanitize.isValidKey(messageObj.senderPublicKey) ||
                typeof messageObj.message !== 'string' ||
                !messageObj.iv || messageObj.iv.type !== 'Buffer' ||
                !Array.isArray(messageObj.iv.data) ||
                messageObj.iv.data.length !== 16) {
                throw new Error('Unexpected message format');
            }
            const sharedKey = v1Crypto.getSharedKey(
                this.identity.privateKey, messageObj.senderPublicKey);
            messageObj = {
                senderPublicKey: messageObj.senderPublicKey,
                message: JSON.parse(v1Crypto.decryptMessage(
                    messageObj.message, sharedKey,
                    Buffer.from(messageObj.iv.data))),
            };
        } catch (err) {
            this.log('Dropping a message that could not be read:',
                err.message);
            return;
        }
        await this.messageReceivedCallback(messageObj);
    }

    /**
     * Update friend information. Only the known profile fields are stored,
     * and they are sanitized first.
     * @param {Object} otherUserInfo information about the other user; must
     * contain a valid 'key'
     */
    async updateFriendInformation(otherUserInfo) {
        if (!otherUserInfo || !sanitize.isValidKey(otherUserInfo.key)) {
            throw new Error('Invalid public key');
        }
        const existing =
            this.storage.get(tableNames.friends, otherUserInfo.key);
        const profile = sanitize.sanitizeUserInfo(
            otherUserInfo, otherUserInfo.key);
        if (existing) {
            // Do not wipe out a known profile with empty fields
            for (const field of ['displayName', 'about', 'photo']) {
                if (profile[field] === '' &&
                    otherUserInfo[field] === undefined) {
                    delete profile[field];
                }
            }
        }
        this.storage.put(tableNames.friends, profile);
    }

    /**
     * Get friend requests that are waiting for the user's decision.
     * @return {Object} map from the requester's public key to their
     * (sanitized) profile
     */
    async getPendingFriendRequests() {
        const pref = await this.getPreference(pendingRequestsPreference);
        if (pref && pref.value && typeof pref.value === 'object') {
            return pref.value;
        }
        return {};
    }

    /**
     * Store a friend request until the user accepts or declines it.
     * @param {Object} profile sanitized profile of the requester
     */
    async addPendingFriendRequest(profile) {
        const pending = await this.getPendingFriendRequests();
        pending[profile.key] = Object.assign({}, profile,
            {receivedAt: Date.now()});
        await this.setPreference(pendingRequestsPreference, pending);
    }

    /**
     * Remove a friend request from the pending list.
     * @param {string} otherUserPublicKey public key of the requester
     * @return {Object|undefined} the removed request, if there was one
     */
    async removePendingFriendRequest(otherUserPublicKey) {
        const pending = await this.getPendingFriendRequests();
        if (!Object.hasOwn(pending, otherUserPublicKey)) {
            return undefined;
        }
        const request = pending[otherUserPublicKey];
        delete pending[otherUserPublicKey];
        await this.setPreference(pendingRequestsPreference, pending);
        return request;
    }

    /**
     * Accept a pending friend request: add the requester as a friend and
     * share our profile with them.
     * @param {string} otherUserPublicKey public key of the requester
     */
    async acceptFriendRequest(otherUserPublicKey) {
        const request =
            await this.removePendingFriendRequest(otherUserPublicKey);
        if (!request) {
            return;
        }
        delete request.receivedAt;
        await this.updateFriendInformation(request);
        await this.sendRequestOrResponse(
            {key: otherUserPublicKey}, messageType.userInfoResponse);
    }

    /**
     * Decline a pending friend request. Nothing is sent to the requester.
     * @param {string} otherUserPublicKey public key of the requester
     */
    async declineFriendRequest(otherUserPublicKey) {
        await this.removePendingFriendRequest(otherUserPublicKey);
    }

    /**
     * Handle a decrypted message. Everything in 'messageObj' is controlled by
     * the sender; only 'senderPublicKey' is authenticated (the message
     * decrypted with the key shared with it).
     * @param {Object} messageObj {senderPublicKey, message}
     */
    async messageReceivedCallback(messageObj) {
        const event = {type: 'message'};
        try {
            if (!messageObj || typeof messageObj.message !== 'object' ||
                messageObj.message === null ||
                !sanitize.isValidKey(messageObj.senderPublicKey)) {
                this.log('Dropping malformed message');
                return;
            }
            const sender = messageObj.senderPublicKey;
            const inner = messageObj.message;
            const friend = this.storage.get(tableNames.friends, sender);
            event.senderPublicKey = sender;

            if (inner.type === messageType.friendRequest) {
                const profile = sanitize.sanitizeUserInfo(
                    inner.senderInfo, sender);
                if (friend) {
                    // Already a friend (for instance, they re-added us after
                    // reinstalling); share our profile again.
                    await this.updateFriendInformation(profile);
                    await this.sendRequestOrResponse(
                        {key: sender}, messageType.userInfoResponse);
                } else {
                    // Wait for the user to accept; do not disclose our
                    // profile to strangers automatically.
                    await this.addPendingFriendRequest(profile);
                }
                event.message = {type: inner.type};
            } else if (inner.type === messageType.userInfoResponse) {
                if (!friend) {
                    this.log('Ignoring profile from an unknown sender');
                    return;
                }
                if (!inner.senderInfo || inner.senderInfo.key !== sender) {
                    this.log('Ignoring profile for a different key');
                    return;
                }
                await this.updateFriendInformation(
                    sanitize.sanitizeUserInfo(inner.senderInfo, sender));
                event.message = {type: inner.type};
            } else if (inner.type === messageType.chat) {
                const chatMessage = sanitize.sanitizeChatMessage(inner.message);
                if (!chatMessage) {
                    this.log('Dropping malformed chat message');
                    return;
                }
                if (!friend) {
                    const pending = await this.getPendingFriendRequests();
                    if (!Object.hasOwn(pending, sender)) {
                        this.log('Dropping chat from an unknown sender');
                        return;
                    }
                }
                // The same message may arrive over several transports
                if (this.storage.hasChat(sender, chatMessage.timestamp)) {
                    return;
                }
                chatMessage.type = 'received';
                this.storage.putChat({
                    key: sender,
                    timestamp: chatMessage.timestamp,
                    message: chatMessage,
                });
                // Strangers with a pending request are never added to the
                // friends list by a chat message.
                if (friend) {
                    this.storage.put(tableNames.friends, {
                        key: sender,
                        lastMessageTimestamp: chatMessage.timestamp,
                        isRead: false,
                    });
                }
                event.message = {type: inner.type, message: chatMessage};
                event.isFromFriend = Boolean(friend);
            } else {
                this.log('Unrecognized message type');
                return;
            }
        } catch (err) {
            this.log('Error while handling a received message:', err);
            return;
        }
        this.emit(event);
    }

    /**
     * Set preference in the database
     * @param {string} name name of the field
     * @param {*} value value of the field
     */
    async setPreference(name, value) {
        if (typeof name !== 'string') {
            throw new Error('Invalid preference name');
        }
        this.storage.put(tableNames.preferences, {key: name, value: value});
    }

    /**
     * Get preference from the database
     * @param {string} name name of the field
     * @return {*} value of the field
     */
    async getPreference(name) {
        return this.storage.get(tableNames.preferences, name);
    }
}

module.exports = Core;
