/* Copyright (c) 2022-2023 Zenin Easa Panthakkalakath */

const requireText = require('require-text');
const Layout = require('./../Layout');
const dbMessenger = require('./../DBMessenger')();
const addFriend = require('./../AddFriend');
const EditProfile = require('./../EditProfile');
const ViewProfile = require('./../ViewProfile');
const imagePack = require('../ImagePack');
const sounds = require('../Sounds');
const i18n = require('./../I18n')();


/**
 * This class implements the functionality for chatting
 */
class Chat {
    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (Chat._instance) {
            return Chat._instance;
        }
        Chat._instance = this;
        Chat._instance.initialize();
    }

    /**
     * Initialize messenger
     */
    initialize() {
        this.sidebarLiIdPrefix = 'sidebar_li_';
        this.activeChat = ''; // to know which chat is active in the view

        dbMessenger.addMessageReceiveCallbackFunction(
            this.receiveMessageCallback.bind(this));

        // Message types; like enum
        this.messageType = {
            sent: 'sent',
            received: 'received',
        };
    }

    /**
     * This function renders the template into the UI.
     */
    async render() {
        Layout.render();
        await EditProfile.renderToIconBar(this.render.bind(this));

        // Link css
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = __dirname + '/style.css';
        document.body.appendChild(link);

        this.loadSidebar();
        this.loadMainContent();

        this.activeChat = '';
    }

    /**
     * To check if the chat module is active in the view.
     * @return {boolean} whether chat module is active in the view or not
     */
    isActiveInView() {
        // TODO: Need to find a better way of doing this
        return document.getElementById('friendsList') !== null;
    }

    /**
     * Load the sidebar
     */
    loadSidebar() {
        const sidebarDOMNode = document.getElementById('sidebar');
        sidebarDOMNode.innerHTML += eval('`' +
            requireText('./template_sidebar.html', require) + '`');

        sidebarDOMNode.querySelector('#addFriendButton').onclick =
            this.addFriendCallback.bind(this);
        sidebarDOMNode.querySelector('#searchInput').onkeyup = this.search;

        this.loadFriendsInSidebar();
    }

    /**
     * Load friends in the sidebar from the database
     */
    async loadFriendsInSidebar() {
        const ul = document.getElementById('friendsList');
        ul.innerHTML = ''; // Clear everything

        // Load friends from the DB
        const allFriends = await dbMessenger.getAllFriends();

        // Sort 'allFriends' by 'lastMessageTimestamp'
        allFriends.sort(function(a, b) {
            return b.lastMessageTimestamp - a.lastMessageTimestamp;
        });

        for (let i = 0; i < allFriends.length; i++) {
            const li = document.createElement('li');
            li.id = this.sidebarLiIdPrefix + allFriends[i].key;
            li.innerHTML = `
                <div class="photo" style="background-image: url(
                    ${this.getProfilePic(allFriends[i].photo)}
                );"></div>
                <div class="name">${allFriends[i].displayName}</div>
            `;
            li.onclick = this.loadChat(allFriends[i]);
            ul.appendChild(li);

            if (!allFriends[i].isRead) {
                this.doNotify(allFriends[i].key);
            }
        }
    }

    /**
     * Load the main content
     */
    loadMainContent() {
        const mainContentDOMNode = document.getElementById('mainContent');
        mainContentDOMNode.innerHTML += eval('`' +
            requireText('./template_mainContent.html', require) + '`');
    }

    /**
     * Load the chat in the main content
     * @param {Object} friend information about a friend stored in the database
     * @return {function} callback function that attempts to fetch data from
     * the database
     */
    loadChat(friend) {
        return async function() {
            const messages = await dbMessenger.getAllMessages(friend.key);
            const messageSenderInfo =
                document.getElementById('messageSenderInfo');
            messageSenderInfo.innerHTML = `
                <div class="photo" style="background-image: url(
                    ${this.getProfilePic(friend.photo)}
                );"></div>
                <div class="name">${friend.displayName}</div>
                <!-- div class="about">${friend.about}</div -->
                <!-- div class="key">${friend.key}</div -->
            `;
            messageSenderInfo.onclick = function() {
                ViewProfile.render(this.render.bind(this), friend);
            }.bind(this);

            const messageReader =
                document.getElementById('messageReader');
            messageReader.innerHTML = ''; // Clear existing messages
            for (let i = 0; i < messages.length; i++) {
                this.insertChatMessageToDOM(messages[i].message);
            }

            const messageComposer =
                document.getElementById('messageComposer');
            const messageTextArea =
                messageComposer.getElementsByTagName('textarea')[0];
            const messageSendButton =
                messageComposer.getElementsByClassName('send')[0];
            messageTextArea.onkeyup = function(event) {
                if (event.key === 'Enter' && !event.shiftKey) {
                    this.sendMessage(friend.key, messageTextArea);
                }
            }.bind(this);
            messageSendButton.onclick = function(event) {
                this.sendMessage(friend.key, messageTextArea);
            }.bind(this);

            // Display the message text area; also clear it if it already has
            // some content
            messageComposer.style.display = 'flex';
            messageComposer.getElementsByTagName('textarea')[0].value = '';

            // Update the active chat
            this.activeChat = friend.key;

            // Switch the notification
            if (!friend.isRead) {
                this.unDoNotify(friend.key);
            }
        }.bind(this);
    }

    /**
     * Insert the chat message into a DOM (to view in the frontend)
     * @param {Object} message the message and information associated with it
     */
    insertChatMessageToDOM(message) {
        const messageReader = document.getElementById('messageReader');
        const div = document.createElement('div');
        div.innerText = message.message;
        div.className = ((message.type == this.messageType.sent) ?
            'sentMessage' : 'receivedMessage');

        // Show the time at which the message arrived
        const span = document.createElement('span');
        const date = new Date(message.timestamp);
        span.innerHTML = date.toDateString() + '<br>' +
            i18n.getText('Chat.at') + ' ' + date.toLocaleTimeString();
        div.appendChild(span);

        messageReader.prepend(div);
    }

    /**
     * Get the profile pic
     * @param {string} photo either an empty string or a string that contains
     * the entire image (base64 encoded image, data URL)
     * @return {string} an image that can be used as CSS background URL
     */
    getProfilePic(photo) {
        if (photo) {
            return photo;
        } else {
            return imagePack.getPath('interface.defaultProfilePic');
        }
    }

    /**
     * Callback function when you press "Add Friend" vutton
     */
    addFriendCallback() {
        addFriend().render(this.render.bind(this));

        // Update the active chat
        this.activeChat = '';
    }

    /**
     * Callback function when you search in the sidebar
     */
    search() {
        const filter = this.value.toUpperCase();
        const ul = document.getElementById('friendsList');
        const li = ul.getElementsByTagName('li');
        for (let i = 0; i < li.length; i++) {
            const txtValue = li[i].innerText;
            if (txtValue.toUpperCase().indexOf(filter) > -1) {
                li[i].style.display = '';
            } else {
                li[i].style.display = 'none';
            }
        }
    }

    /**
     * Send message
     * @param {string} userKey
     * @param {object} messageTextArea DOM element for the textarea where the
     * message is composed
     */
    sendMessage(userKey, messageTextArea) {
        const message = {
            timestamp: Date.now(),
            type: this.messageType.sent,
            message: messageTextArea.value.trim(),
        };
        this.insertChatMessageToDOM(message);
        dbMessenger.sendChatMessage(userKey, message);
        messageTextArea.value = '';
    }

    /**
     * Activate notification
     * @param {string} userKey
     */
    doNotify(userKey) {
        const id = this.sidebarLiIdPrefix + userKey;
        document.getElementById(id).classList.add('notification');
    }
    /**
     * De-activate notification
     * @param {string} userKey
     */
    unDoNotify(userKey) {
        const id = this.sidebarLiIdPrefix + userKey;
        document.getElementById(id).classList.remove('notification');
        dbMessenger.markChatRead(userKey);
    }

    /**
     * Receive messages from different channels as callback
     * @param {Object} message message received from DBMessenger
     */
    async receiveMessageCallback(message) {
        if (message.message.type === dbMessenger.messageType.chat) {
            // TODO: Check if the message has already reached via any other
            // routes.
            // If intranet message receives first, then the internet message is
            // received, then we don't have to push it into the DOM or play the
            // sound.

            // Add it to the database
            message.message.message.type = this.messageType.received;
            dbMessenger.receivedChatMessage(message);

            // Before rendering, confirm if the chat module is active in the
            // view. If so, check if the chat that is active is the same as
            // that of the incoming message.
            if (this.isActiveInView()) {
                if (message.senderPublicKey === this.activeChat) {
                    this.insertChatMessageToDOM(message.message.message);
                    // Remove the notification if it's already there
                    this.unDoNotify(message.senderPublicKey);
                } else {
                    // Notify
                    this.doNotify(message.senderPublicKey);
                }
            }

            // Play sound for alert
            sounds().messageReceivedSound();
        } else if (message.message.type ===
            dbMessenger.messageType.userInfoResponse) {
            // Reload the sidebar
            await this.loadFriendsInSidebar();
        }
    }
}

module.exports = function() {
    return new Chat();
};
