/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

const os = require('os');
const dbWrapper = require('./DBWrapper')();
const messenger = require('./Messenger')();
const intranetMessenger = require('./IntranetMessenger')();
const utils = require('./utils.js');
const sanitize = require('./../Sanitize');

/**
 * This is a singleton class.
 * This class has two responsibilities:
 * 1. Store information in a local database
 * 2. Communicate information with peers
 */
class DBMessenger {
    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (DBMessenger._instance) {
            return DBMessenger._instance;
        }
        DBMessenger._instance = this;

        DBMessenger._instance.detectNetworkChanges();
        DBMessenger._instance.initialize();
    }

    /**
     * Initialize DBMessenger
     */
    initialize() {
        // Data table names; like enum
        this.tableNames = {
            friends: 'Friends',
            chat: 'Chat',
            loggedInUser: 'LoggedInUserInfo',
            preferences: 'Preferences',
        };

        // Message types; like enum
        this.messageType = {
            chat: 'ChatMessage',
            friendRequest: 'FriendRequest',
            userInfoResponse: 'UserInformation',
        };

        // Name of the preference that holds friend requests waiting for the
        // user to accept or decline them
        this.pendingRequestsPreference = 'pendingFriendRequests';

        // Related to callback functions that are executed when new messages
        // arrive
        this.listOfMessageReceiveCallbackFunctions = [];
        messenger.setMessageReceiveCallbackFunction(
            this.messageReceivedCallback.bind(this));
        intranetMessenger.setMessageReceiveCallbackFunction(
            this.messageReceivedCallback.bind(this));
    }

    /**
     * Detect network changes and act accordingly
     */
    async detectNetworkChanges() {
        let net = os.networkInterfaces();
        /** Recursively check (infinite loop) if the interface has changed */
        async function checkInterfaces() {
            if (
                JSON.stringify(net) !==
                JSON.stringify(os.networkInterfaces())
            ) {
                net = os.networkInterfaces();
                console.log('Network interface change detected');
                messenger.reInitialize();
                intranetMessenger.reInitialize();
            }
            setTimeout(checkInterfaces, 5000); // Check again after 5 seconds
        }
        checkInterfaces();
    }

    /**
     * Delete everything.
     */
    async deleteDatabaseContent() {
        for (const key in this.tableNames) {
            await dbWrapper.deleteTable(this.tableNames[key]);
        }
        window.reload();
    }

    /**
     * Get the list of all friends as a callback
     * @return {Array} the list of all friends
     */
    async getAllFriends() {
        return await dbWrapper.getAll(this.tableNames.friends);
    }

    /**
     * Get the information of the logged in user. Note, this should not be
     * shared with anyone else as it contains the user's private key.
     * @return {Object} user information
     */
    async getLoggedInUserInfoPrivate() {
        return (await dbWrapper.getAll(this.tableNames.loggedInUser))[0];
    }

    /**
     * Get the information of the logged in user, which can be shared with the
     * others.
     * @return {Object} user information
     */
    async getLoggedInUserInfoPublic() {
        const userInfo = await this.getLoggedInUserInfoPrivate();
        userInfo.key = utils.getPublicKeyFromPrivateKey(userInfo.privateKey);
        delete userInfo.privateKey;
        return userInfo;
    }

    /**
     * Get the information of a particular person
     * @param {string} otherUserPublicKey user key of the other person
     */
    async getUserInfo(otherUserPublicKey) {
        const loggedInUserInfo = await this.getLoggedInUserInfoPublic();
        if (loggedInUserInfo.key === otherUserPublicKey) {
            return loggedInUserInfo;
        }
        return await dbWrapper.get(this.tableNames.friends, otherUserPublicKey);
    }

    /**
     * Write information about the user to the database.
     * Note that we expect this database to only have one element and the key
     * for the same is 0.
     * @param {Object} info information about the user
     */
    async writeLoggedInUserInfo(info) {
        // Replace password with private key
        const privateKey = utils.generatePrivateKey(info);
        delete info.password
        info.privateKey = privateKey;

        // Update it in the database
        info.key = 0;
        await dbWrapper.addOrEditEntry(this.tableNames.loggedInUser, info);

        // Report to every friend regarding this change.
        const allFriends = await this.getAllFriends();
        allFriends.forEach(function(friendInfo) {
            this.sendRequestOrResponse(
                friendInfo,
                this.messageType.userInfoResponse,
            );
        }.bind(this));

        // If there is a change in the private key, then the public key also
        // changes, which means that we need to subscribe to the new channel.
        messenger.initialize();
        intranetMessenger.initialize();
    }

    /**
     * Write a chat message to the database
     * @param {string} otherUserPublicKey user key of the other person
     * @param {Object} message the message and information associated with it
     */
    async sendChatMessage(otherUserPublicKey, message) {
        dbWrapper.addOrEditEntry(
            this.tableNames.chat,
            {
                key: otherUserPublicKey,
                timestamp: message.timestamp,
                message: message,
            },
        );

        // Send the message via channel
        const messageToChannel = {
            type: this.messageType.chat,
            message: message,
        };
        const promise1 = messenger.sendMessageToChannel(
            otherUserPublicKey, messageToChannel);
        const promise2 = intranetMessenger.sendMessageToChannel(
            otherUserPublicKey, messageToChannel);
        await Promise.allSettled([promise1, promise2]);

        // Update last message received and read flag
        dbWrapper.addOrEditEntry(
            this.tableNames.friends,
            {
                key: otherUserPublicKey,
                lastMessageTimestamp: message.timestamp,
                isRead: false,
            },
        );
    }

    /**
     * Write the received chat message into the database. The message must
     * already have been validated by messageReceivedCallback.
     * @param {Object} messageObj message object
     */
    async receivedChatMessage(messageObj) {
        // Store the received message
        const messageToDB = messageObj.message.message;
        await dbWrapper.addOrEditEntry(
            this.tableNames.chat,
            {
                key: messageObj.senderPublicKey,
                timestamp: messageToDB.timestamp,
                message: messageToDB,
            },
        );

        // Update last message received and read flag; only for accepted
        // friends, so that strangers never get added to the friends list.
        const friend = await dbWrapper.get(
            this.tableNames.friends, messageObj.senderPublicKey);
        if (friend) {
            await dbWrapper.addOrEditEntry(
                this.tableNames.friends,
                {
                    key: messageObj.senderPublicKey,
                    lastMessageTimestamp: messageToDB.timestamp,
                    isRead: false,
                },
            );
        }
    }

    /**
     * Update read flag; for notification to stop showing.
     * @param {string} otherUserPublicKey user key of the other person
     */
    async markChatRead(otherUserPublicKey) {
        dbWrapper.addOrEditEntry(
            this.tableNames.friends,
            {
                key: otherUserPublicKey,
                isRead: true,
            },
        );
    }

    /**
     * Get all messages in a shared key channel
     * @param {string} otherUserPublicKey user key of the other person
     */
    async getAllMessages(otherUserPublicKey) {
        const chat = await dbWrapper.getInKeyRange(
            this.tableNames.chat,
            [otherUserPublicKey, 0], // Lowerbound key
            [otherUserPublicKey, Date.now()], // Upperbound key
        );
        // chat.value
        if (chat) {
            return chat;
        }
        return [];
    }

    /**
     * Download database as JSON.
     */
    async downloadDBAsJSON() {
        dbWrapper.downloadDBAsJSON();
    }

    /**
     * Upload database as JSON.
     */
    async uploadDBAsJSON() {
        return dbWrapper.uploadDBAsJSON();
    }

    /**
     * Generate a new private key.
     * @return {string} a 32 character string depicting a private key
     */
    generatePrivateKey() {
        return utils.generatePrivateKey();
    }

    /**
     * Get public key of the logged in user
     * @return {string} the public key corresponding to the logged in user's
     * private key
     */
    async getPublicKeyOfLoggedInUser() {
        const userInfo = await this.getLoggedInUserInfoPrivate();
        return utils.getPublicKeyFromPrivateKey(userInfo.privateKey);
    }

    /**
     * Send friend request, acknowledge friend request, or, send an update on
     * user information
     * @param {Object} otherUserInfo information about the other user
     * @param {string} requestType type of the request
     */
    async sendRequestOrResponse(otherUserInfo, requestType) {
        // Send a message to the other user
        const messageToChannel = {
            type: requestType,
            senderInfo: await this.getLoggedInUserInfoPublic(),
        };
        await messenger.sendMessageToChannel(
            otherUserInfo.key, messageToChannel);
        await intranetMessenger.sendMessageToChannel(
            otherUserInfo.key, messageToChannel);
    }


    /**
     * Update friend information. Only the known profile fields are stored,
     * and they are sanitized first.
     * @param {Object} otherUserInfo information about the other user; must
     * contain a valid 'key'
     */
    async updateFriendInformation(otherUserInfo) {
        if (!sanitize.isValidKey(otherUserInfo.key)) {
            throw new Error('Invalid public key');
        }
        const existing =
            await dbWrapper.get(this.tableNames.friends, otherUserInfo.key);
        const profile = sanitize.sanitizeUserInfo(
            otherUserInfo, otherUserInfo.key);
        if (existing) {
            // Do not wipe out a known profile with empty fields
            for (const field of ['displayName', 'about', 'photo']) {
                if (profile[field] === '' && otherUserInfo[field] ===
                    undefined) {
                    delete profile[field];
                }
            }
        }
        await dbWrapper.addOrEditEntry(this.tableNames.friends, profile);
    }

    /**
     * Get friend requests that are waiting for the user's decision.
     * @return {Object} map from the requester's public key to their
     * (sanitized) profile
     */
    async getPendingFriendRequests() {
        const pref = await this.getPreference(this.pendingRequestsPreference);
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
        await this.setPreference(this.pendingRequestsPreference, pending);
    }

    /**
     * Remove a friend request from the pending list.
     * @param {string} otherUserPublicKey public key of the requester
     * @return {Object|undefined} the removed request, if there was one
     */
    async removePendingFriendRequest(otherUserPublicKey) {
        const pending = await this.getPendingFriendRequests();
        const request = pending[otherUserPublicKey];
        delete pending[otherUserPublicKey];
        await this.setPreference(this.pendingRequestsPreference, pending);
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
        await this.updateFriendInformation(request);
        await this.sendRequestOrResponse(
            {key: otherUserPublicKey}, this.messageType.userInfoResponse);
    }

    /**
     * Decline a pending friend request. Nothing is sent to the requester.
     * @param {string} otherUserPublicKey public key of the requester
     */
    async declineFriendRequest(otherUserPublicKey) {
        await this.removePendingFriendRequest(otherUserPublicKey);
    }

    /**
     * Add functions from other modules to Messenger which gets triggered when
     * new messages arrive in subscribed channels
     * @param {function} func callback function that gets invoked when a new
     * new message is received
     */
    addMessageReceiveCallbackFunction(func) {
        this.listOfMessageReceiveCallbackFunctions.push(func);
    }

    /**
     * The callback function that gets invoked by Messenger when a new message
     * is received. Everything in 'messageObj' is controlled by the sender;
     * only 'senderPublicKey' is authenticated (the message decrypted with the
     * key shared with it).
     * @param {Object} messageObj message object
     */
    async messageReceivedCallback(messageObj) {
        try {
            if (!messageObj || typeof messageObj.message !== 'object' ||
                messageObj.message === null ||
                !sanitize.isValidKey(messageObj.senderPublicKey)) {
                console.log('Dropping malformed message');
                return;
            }
            const sender = messageObj.senderPublicKey;
            const inner = messageObj.message;
            const friend = await dbWrapper.get(this.tableNames.friends, sender);

            if (inner.type === this.messageType.friendRequest) {
                const profile = sanitize.sanitizeUserInfo(
                    inner.senderInfo, sender);
                if (friend) {
                    // Already a friend (for instance, they re-added us after
                    // reinstalling); share our profile again.
                    await this.updateFriendInformation(profile);
                    await this.sendRequestOrResponse(
                        {key: sender}, this.messageType.userInfoResponse);
                } else {
                    // Wait for the user to accept; do not disclose our
                    // profile to strangers automatically.
                    await this.addPendingFriendRequest(profile);
                }
            } else if (inner.type === this.messageType.userInfoResponse) {
                if (!friend) {
                    console.log('Ignoring profile from an unknown sender');
                    return;
                }
                if (!inner.senderInfo ||
                    inner.senderInfo.key !== sender) {
                    console.log('Ignoring profile for a different key');
                    return;
                }
                await this.updateFriendInformation(
                    sanitize.sanitizeUserInfo(inner.senderInfo, sender));
            } else if (inner.type === this.messageType.chat) {
                const chatMessage = sanitize.sanitizeChatMessage(inner.message);
                if (!chatMessage) {
                    console.log('Dropping malformed chat message');
                    return;
                }
                if (!friend) {
                    const pending = await this.getPendingFriendRequests();
                    if (!pending[sender]) {
                        console.log('Dropping chat from an unknown sender');
                        return;
                    }
                }
                inner.message = chatMessage;
                messageObj.isFromFriend = Boolean(friend);
            } else {
                console.log('Unrecognized message type');
                return;
            }
        } catch (err) {
            console.log('Error while handling a received message:', err);
            return;
        }

        // Now, Invoke all other callback functions.
        this.listOfMessageReceiveCallbackFunctions.forEach(
            function(func) {
                try {
                    func(messageObj);
                } catch (err) {
                    console.log('Error in message callback:', err);
                }
            },
        );
    }

    /**
     * Set preference in the database
     * @param {string} name name of the field
     * @param {*} value value of the field
     */
    async setPreference(name, value) {
        dbWrapper.addOrEditEntry(
            this.tableNames.preferences,
            {key: name, value: value},
        );
    }
    /**
     * Get preference from the database
     * @param {string} name name of the field
     * @return {*} value of the field
     */
    async getPreference(name) {
        return await dbWrapper.get(
            this.tableNames.preferences,
            name,
        );
    }
}

module.exports = function() {
    return new DBMessenger();
};
