/* Copyright (c) 2022-2023 Zenin Easa Panthakkalakath */

const dbWrapper = require('./DBWrapper')();
const messenger = require('./Messenger')();
const intranetMessenger = require('./IntranetMessenger')();
const utils = require('./utils.js');

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

        // Related to callback functions that are executed when new messages
        // arrive
        this.listOfMessageReceiveCallbackFunctions = [];
        messenger.setMessageReceiveCallbackFunction(
            this.messageReceivedCallback.bind(this));
        intranetMessenger.setMessageReceiveCallbackFunction(
            this.messageReceivedCallback.bind(this));
    }

    /**
     * Delete everything.
     */
    async deleteDatabaseContent() {
        dbWrapper.deleteDatabaseContent();
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
        messenger.sendMessageToChannel(
            otherUserPublicKey, messageToChannel);
        intranetMessenger.sendMessageToChannel(
            otherUserPublicKey, messageToChannel);

        // TODO: Need a better way here. We should not be waiting for one to
        // complete before sending the other. This causes a lot of lag.

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
     * Write the received chat message into the database
     * @param {Object} messageObj message object
     */
    async receivedChatMessage(messageObj) {
        // Store the received message
        const messageToDB = messageObj.message.message;
        dbWrapper.addOrEditEntry(
            this.tableNames.chat,
            {
                key: messageObj.senderPublicKey,
                timestamp: messageToDB.timestamp,
                message: messageToDB,
            },
        );

        // Update last message received and read flag
        dbWrapper.addOrEditEntry(
            this.tableNames.friends,
            {
                key: messageObj.senderPublicKey,
                lastMessageTimestamp: messageToDB.timestamp,
                isRead: false,
            },
        );
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
     * Update friend information
     * @param {Object} otherUserInfo information about the other user
     */
    async updateFriendInformation(otherUserInfo) {
        dbWrapper.addOrEditEntry(this.tableNames.friends, otherUserInfo);
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
     * is received.
     * @param {Object} messageObj message object
     */
    async messageReceivedCallback(messageObj) {
        // Perform actions that need to be taken from the data before other
        // callback functions get executed here.

        if (messageObj.message.type === this.messageType.friendRequest) {
            await this.sendRequestOrResponse(
                messageObj.message.senderInfo,
                this.messageType.userInfoResponse,
            );
        } else if (messageObj.message.type ===
            this.messageType.userInfoResponse) {
            await this.updateFriendInformation(messageObj.message.senderInfo);
        } else if (messageObj.message.type === this.messageType.chat) {
            // Nothing to do...
        } else {
            console.log('Unrecognized message type');
        }

        // Now, Invoke all other callback functions.
        this.listOfMessageReceiveCallbackFunctions.forEach(
            function(func) {
                func(messageObj);
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
