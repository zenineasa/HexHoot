/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

import requireText = require('require-text');
import Layout from '../Layout';
import DBMessenger from '../DBMessenger';
import AddFriend from '../AddFriend';
import EditProfile from '../EditProfile';
import ViewProfile from '../ViewProfile';
import * as imagePack from '../ImagePack';
import Sounds from '../Sounds';
import I18n from '../I18n';

const dbMessenger = new DBMessenger();
const sounds = new Sounds();
const i18n = new I18n();
const editProfile = new EditProfile();
const viewProfile = new ViewProfile();

/**
 * This class implements the functionality for chatting
 */
export default class Chat {
    private static _instance: Chat;
    private sidebarLiIdPrefix: string;
    private activeChat: string;
    private messageType: {[key: string]: string};
    private messageIdentifierLog: string[];
    private numMessagesEncountered: number;
    private maxLogSize: number;
    private emojiCounterMap: {[key: string]: number};
    private allFriends: any[];

    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (Chat._instance) {
            return Chat._instance;
        }
        Chat._instance = this;
        this.initialize();
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

        this.messageIdentifierLog = [];
        this.numMessagesEncountered = 0;
        this.maxLogSize = 20;
    }

    /**
     * This function renders the template into the UI.
     */
    async render() {
        console.log('Chat.render called');
        await Layout.render();
        editProfile.renderToIconBar(this.render.bind(this));

        // Get the stats for emoji counts
        const emojiCounterMap =
            await dbMessenger.getPreference('emojiCounterMap');
        if (typeof(emojiCounterMap) === 'undefined') {
            this.emojiCounterMap = {};
        } else {
            this.emojiCounterMap = emojiCounterMap.value;
        }

        // Link css
        const cssPath = __dirname + '/style.css';
        if (!document.querySelector(`link[href="${cssPath}"]`)) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = cssPath;
            document.body.appendChild(link);

            // Ensure that the CSS is loaded before the HTML is
            link.addEventListener('load', () => {
                this.loadSidebar();
                this.loadMainContent();
            });
        } else {
            this.loadSidebar();
            this.loadMainContent();
        }

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
        if (sidebarDOMNode) {
            // Prevent duplication
            if (sidebarDOMNode.querySelector('#addFriendButton')) {
                return;
            }

            sidebarDOMNode.innerHTML += eval('`' +
                requireText('./template_sidebar.html', require) + '`');

            const addFriendBtn = sidebarDOMNode.querySelector('#addFriendButton') as HTMLElement;
            if (addFriendBtn) {
                addFriendBtn.onclick = this.addFriendCallback.bind(this);
            }
            const searchInput = sidebarDOMNode.querySelector('#searchInput') as HTMLElement;
            if (searchInput) {
                searchInput.onkeyup = this.search;
            }

            this.loadFriendsInSidebar();
        }
    }

    /**
     * Load friends in the sidebar from the database
     */
    async loadFriendsInSidebar() {
        // ... (unchanged)
        const ul = document.getElementById('friendsList');
        if (ul) {
            ul.innerHTML = ''; // Clear everything

            // Load friends from the DB
            this.allFriends = await dbMessenger.getAllFriends();

            // Sort 'allFriends' by 'lastMessageTimestamp'
            this.allFriends.sort(function(a, b) {
                return b.lastMessageTimestamp - a.lastMessageTimestamp;
            });

            for (let i = 0; i < this.allFriends.length; i++) {
                const li = document.createElement('li');
                li.id = this.sidebarLiIdPrefix + this.allFriends[i].key;
                li.innerHTML = `
                    <div class="photo" style="background-image: url(
                        ${this.getProfilePic(this.allFriends[i].photo)}
                    );"></div>
                    <div class="name">${this.allFriends[i].displayName}</div>
                `;
                li.onclick = this.loadChat(this.allFriends[i]);
                ul.appendChild(li);

                if (!this.allFriends[i].isRead) {
                    this.doNotify(this.allFriends[i].key);
                }
            }
        }
    }

    /**
     * Load the main content
     */
    loadMainContent() {
        const mainContentDOMNode = document.getElementById('mainContent');
        if (mainContentDOMNode) {
            // Prevent duplication
            if (mainContentDOMNode.querySelector('#messageReader')) {
                return;
            }

            mainContentDOMNode.innerHTML += eval('`' +
                requireText('./template_mainContent.html', require) + '`');
        }
    }

    /**
     * Load the chat in the main content
     * @param {Object} friend information about a friend stored in the database
     * @return {function} callback function that attempts to fetch data from
     * the database
     */
    loadChat(friend: any) {
        return async () => {
            const messages = await dbMessenger.getAllMessages(friend.key);
            const messageSenderInfo =
                document.getElementById('messageSenderInfo');
            if (messageSenderInfo) {
                messageSenderInfo.innerHTML = `
                    <div class="photo" style="background-image: url(
                        ${this.getProfilePic(friend.photo)}
                    );"></div>
                    <div class="name">${friend.displayName}</div>
                    <!-- div class="about">${friend.about}</div -->
                    <!-- div class="key">${friend.key}</div -->
                `;
                // eslint-disable-next-line @typescript-eslint/no-this-alias
                const self = this;
                messageSenderInfo.onclick = function() {
                    viewProfile.render(self.render.bind(self), friend);
                };
            }

            const messageReader =
                document.getElementById('messageReader');
            if (messageReader) {
                messageReader.innerHTML = ''; // Clear existing messages
                for (let i = 0; i < messages.length; i++) {
                    this.insertChatMessageToDOM(messages[i].message);
                }
            }

            const messageComposer = document.getElementById('messageComposer');
            if (messageComposer) {
                const messageTextArea =
                    messageComposer.getElementsByTagName('textarea')[0];
                const messageSendButton =
                    messageComposer.getElementsByClassName('send')[0] as HTMLElement;

                // eslint-disable-next-line @typescript-eslint/no-this-alias
                const self = this;
                messageTextArea.onkeydown = function(event) {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        self.sendMessage(friend.key, messageTextArea);
                    }
                };
                if (messageSendButton) {
                    messageSendButton.onclick = function() {
                        self.sendMessage(friend.key, messageTextArea);
                    };
                }

                // Display the message text area; also clear it if it already has
                // some content
                messageComposer.style.display = 'flex';
                messageComposer.getElementsByTagName('textarea')[0].value = '';
            }

            // For emojis
            const messageEmojis = document.getElementById('messageEmojis');
            if (messageEmojis) {
                messageEmojis.style.display = 'flex';
                // eslint-disable-next-line @typescript-eslint/no-this-alias
                const self = this;
                messageEmojis.onclick = function(e) {
                    if ((e.target as HTMLElement).nodeName === 'SPAN') {
                        // Insert emoji into textarea
                        const emoji = (e.target as HTMLElement).textContent;
                        if (!emoji) return;

                        const messageTextArea = messageComposer?.getElementsByTagName('textarea')[0];
                        if (!messageTextArea) return;

                        const start = messageTextArea.selectionStart || 0;
                        const end = messageTextArea.selectionEnd || 0;
                        messageTextArea.value =
                            messageTextArea.value.substring(0, start) +
                            emoji +
                            messageTextArea.value.substring(end);

                        // Ensure that the cursor is in the right position
                        messageTextArea.focus();
                        messageTextArea.selectionStart = start + emoji.length;
                        messageTextArea.selectionEnd = start + emoji.length;

                        // Increment the emoji counter
                        if (emoji in self.emojiCounterMap) {
                            self.emojiCounterMap[emoji]++;
                        } else {
                            self.emojiCounterMap[emoji] = 1;
                        }
                        dbMessenger.setPreference(
                            'emojiCounterMap', self.emojiCounterMap,
                        );
                    }
                };
            }

            // Update the active chat
            this.activeChat = friend.key;

            // Switch the notification
            if (!friend.isRead) {
                this.unDoNotify(friend.key);
            }
        };
    }

    /**
     * Insert the chat message into a DOM (to view in the frontend)
     * @param {Object} message the message and information associated with it
     */
    insertChatMessageToDOM(message: any) {
        const messageReader = document.getElementById('messageReader');
        if (messageReader) {
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
    }

    /**
     * Get the profile pic
     * @param {string} photo either an empty string or a string that contains
     * the entire image (base64 encoded image, data URL)
     * @return {string} an image that can be used as CSS background URL
     */
    getProfilePic(photo: string) {
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
        new AddFriend().render(this.render.bind(this));

        // Update the active chat
        this.activeChat = '';
    }

    /**
     * Callback function when you search in the sidebar
     */
    search(this: HTMLElement) {
        const filter = (this as HTMLInputElement).value.toUpperCase();
        const ul = document.getElementById('friendsList');
        if (ul) {
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
    }

    /**
     * Send message
     * @param {string} userKey
     * @param {object} messageTextArea DOM element for the textarea where the
     * message is composed
     */
    sendMessage(userKey: string, messageTextArea: HTMLTextAreaElement) {
        const textAreaValue = messageTextArea.value.trim();
        if (textAreaValue !== '') {
            const message = {
                timestamp: Date.now(),
                type: this.messageType.sent,
                message: textAreaValue,
            };
            this.insertChatMessageToDOM(message);
            dbMessenger.sendChatMessage(userKey, message);
            messageTextArea.value = '';
        }
    }

    /**
     * Activate notification
     * @param {string} userKey
     */
    doNotify(userKey: string) {
        const id = this.sidebarLiIdPrefix + userKey;
        const elem = document.getElementById(id);
        if (elem) elem.classList.add('notification');
    }
    /**
     * De-activate notification
     * @param {string} userKey
     */
    unDoNotify(userKey: string) {
        const id = this.sidebarLiIdPrefix + userKey;
        const elem = document.getElementById(id);
        if (elem) elem.classList.remove('notification');
        dbMessenger.markChatRead(userKey);
    }

    /**
     * Checks if the incoming message identifier is already present in the log.
     * If it is, then we return true. If it is not, we store the new message
     * identifier.
     * @param {string} messageIdentifier the identifier for the message. We use
     * a concatenation of sender's public key and message timestamp for this.
     * @return {boolean} returns true if the identifier was previously present
     * in the log.
     */
    isMessageInIdentifierLog(messageIdentifier: string) {
        const ret = this.messageIdentifierLog.includes(messageIdentifier);
        if (!ret) {
            this.messageIdentifierLog[
                this.numMessagesEncountered++ % this.maxLogSize
            ] = messageIdentifier;
        }
        return ret;
    }

    /**
     * Receive messages from different channels as callback
     * @param {Object} message message received from DBMessenger
     */
    async receiveMessageCallback(message: any) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        if (message.message.type === 'ChatMessage' || message.message.type === 'chat') { // Assuming literal check as dbMessenger.messageType is private
             // If the new message being received is present in this log,
            // then do not insert.
            if (this.isMessageInIdentifierLog(
                message.senderPublicKey + message.message.message.timestamp,
            )) {
                return;
            }

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
            sounds.messageReceivedSound();
            console.log(Notification);
            const friend = this.allFriends.find(function(friend) {
                return friend.key == message.senderPublicKey;
            });
            if (Notification.permission !== 'denied') {
                const permission = await Notification.requestPermission();
                if (permission === 'granted' && friend) {
                    const title = friend.displayName + ' sent you a message.';
                    const body = message.message.message.message;
                    const icon = this.getProfilePic(friend.photo);
                    new Notification(title, {
                        body: body,
                        icon: icon,
                    });
                }
            }
        } else if (message.message.type === 'UserInformation' || message.message.type === 'userInfoResponse') {
            // Reload the sidebar
            await this.loadFriendsInSidebar();
        }
    }

    /**
     * Help load emoticons in the template
     * @return {string} content for HTML template to render emojis
     */
    loadEmoticonsHTML() {
        /**
         * Each character in the range is returned inside a span tag
         * @param {number} startRange start of range of characters
         * @param {number} endRange end of range of characters
         * @return {string} HTML content in string format
         */
        function returnCharactersInRangeAsSpan(startRange: number, endRange: number) {
            let ret = '';
            for (let i = startRange; i <= endRange; i++) {
                ret += '<span>&#' + i + ';</span>';
            }
            return ret;
        }

        let ret = '';

        // Get the first five most frequently used emojis
        const obj = this.emojiCounterMap;
        if (obj) {
             const frequentlyUsed = Object.keys(obj).sort((a, b) => obj[b] - obj[a])
                .slice(0, 5);

            frequentlyUsed.forEach(function(emoji) {
                ret += '<span>' + emoji + '</span>';
            });
        }

        // Add a separator
        ret += '&vellip;';

        // Get all emojis
        ret += returnCharactersInRangeAsSpan(128512, 128591);
        ret += returnCharactersInRangeAsSpan(9984, 10175);
        ret += returnCharactersInRangeAsSpan(127744, 128511);
        ret += returnCharactersInRangeAsSpan(128640, 128767);
        ret += returnCharactersInRangeAsSpan(127462, 127487);

        return ret;
    }
}
