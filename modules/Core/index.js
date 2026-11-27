/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

const crypto = require('node:crypto');
const os = require('node:os');
const sanitize = require('./../Sanitize/index.mjs');
const {messageType} = require('./constants.mjs');
const Keyring = require('../Crypto/Keyring');
const {Identity} = require('../Crypto/Identity');
const credentials = require('../Crypto/credentials');
const {scryptOutlook} = require('../Crypto/primitives');
const addressing = require('../Crypto/address');
const backup = require('../Crypto/backup');
const {Messenger} = require('../Protocol/Messenger');

/**
 * An error the UI can show: 'code' says what went wrong
 * @param {string} code machine-readable code
 * @param {string} message description
 * @param {Object} [extra] more fields
 * @return {Error} the error
 */
function failure(code, message, extra = {}) {
    return Object.assign(new Error(message), {code}, extra);
}

/**
 * The key of a chat record. The direction is part of it: ids of received
 * messages are chosen by the sender, so they must never land on a message
 * we sent (F6).
 * @param {string} address the contact
 * @param {string} type 'sent' or 'received'
 * @param {string} id the message id
 * @return {string} the key
 */
function chatKey(address, type, id) {
    return `${address}:${type}:${id}`;
}

/**
 * HexHoot Core: the account, storage and messaging, with no UI and no
 * Electron dependency. In the app it runs in a utilityProcess (main.js);
 * tests create it directly with temporary files and in-memory carriers.
 *
 * Account states:
 *   'none'   no account here: log in (which creates or restores one) or
 *            import a backup
 *   'locked' an account exists, but the OS keyring cannot open it (Linux
 *            without a secret service): unlock with the password
 *   'ready'  signed in
 */
class Core {
    /**
     * @param {Object} options
     * @param {EncryptedStore} options.store the database
     * @param {string} options.keyringFile path of keyring.json
     * @param {Object} [options.sealer] the OS keyring (see Keyring.js)
     * @param {function} [options.carriers] () => [carriers]; called once
     * the account is open
     * @param {Object} [options.scryptParams] tests only: a cheaper scrypt
     * @param {number} [options.retryMs] tests only: resend sooner
     * @param {boolean} [options.watchNetwork] restart the carriers when the
     * network interfaces change
     * @param {function} [options.now] clock
     * @param {function} [options.log] logger
     */
    constructor(options) {
        this.store = options.store;
        this.keyringFile = options.keyringFile;
        this.sealer = options.sealer || null;
        this.makeCarriers = options.carriers || (() => []);
        this.scryptParams = options.scryptParams;
        this.retryMs = options.retryMs;
        this.version = options.version || '';
        this.watchNetwork = Boolean(options.watchNetwork);
        this.now = options.now || Date.now;
        this.log = options.log || console.log;
        this.messageType = messageType;
        this.eventListeners = new Set();
        this.state = 'none';
        this.keyring = null;
        this.identity = null;
        this.messenger = null;
        this.lockedPreferences = new Map(); // set before signing in
    }

    /** Open the account if there is one and the OS keyring allows it */
    async start() {
        if (!Keyring.exists(this.keyringFile)) {
            return;
        }
        this.keyring = Keyring.open({file: this.keyringFile,
            sealer: this.sealer, scryptParams: this.scryptParams});
        try {
            await this.keyring.unlock();
        } catch (err) {
            this.state = 'locked';
            this.log('The account is locked: ' + err.message);
            return;
        }
        await this.openAccount();
    }

    /** Stop messaging and close the database; again does nothing */
    async stop() {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        clearInterval(this.networkTimer);
        await this.messenger?.stop();
        this.keyring?.lock();
        this.store.close();
    }

    /**
     * @param {function} func called with every event
     * @return {function} call it to stop listening
     */
    onEvent(func) {
        this.eventListeners.add(func);
        return () => this.eventListeners.delete(func);
    }

    /** @param {Object} event sent to every listener */
    emit(event) {
        for (const func of this.eventListeners) {
            try {
                func(event);
            } catch (err) {
                this.log('Event listener failed:', err);
            }
        }
    }

    /** @throws {Error} NOT_SIGNED_IN */
    assertReady() {
        if (this.state !== 'ready') {
            throw failure('NOT_SIGNED_IN', 'Not signed in');
        }
    }

    // ---- Account --------------------------------------------------------

    /**
     * @return {Object} {state, address, passphraseRequired, scryptSlow}
     */
    async getAccountState() {
        const outlook = scryptOutlook(this.scryptParams);
        return {
            state: this.state,
            address: this.identity?.address,
            scryptSlow: outlook.likelySlow,
            version: this.version,
        };
    }

    /**
     * Log in, which creates the account on this computer, or edit the
     * profile. With a password: derive the identity from the name and
     * password (several seconds) and set up the keyring. Without: change
     * the profile only; a key supplied by the caller is never used (S4).
     * @param {Object} info {displayName, password} or {displayName, about,
     * photo}
     */
    async writeLoggedInUserInfo(info) {
        if (typeof info?.password === 'string' && info.password !== '') {
            return this.login(info.displayName, info.password);
        }
        return this.updateProfile(info || {});
    }

    /**
     * @param {string} name the account name, also the first display name
     * @param {string} password the password
     */
    async login(name, password) {
        if (this.state !== 'none') {
            throw failure('ALREADY_SIGNED_IN', 'An account is already here');
        }
        const problems = credentials.checkCredentials(name, password);
        if (problems.length > 0) {
            throw failure('WEAK_CREDENTIALS', problems.join(', '),
                {problems});
        }
        this.state = 'busy';
        try {
            const identity = await Identity.fromCredentials(name, password,
                {scryptParams: this.scryptParams, createdAt: this.now()});
            await this.createKeyring(password);
            this.saveIdentity(identity);
            this.store.put('Profile', 'me', {
                displayName: sanitize.clipString(String(name).trim(),
                    sanitize.MAX_DISPLAY_NAME_LENGTH),
                about: '', photo: ''});
            this.store.put('PasswordCheck', 'state',
                credentials.nextPasswordCheck({},
                    {now: this.now(), result: 'created'}));
            await this.openAccount();
        } catch (err) {
            if (this.state === 'busy') {
                this.state = 'none';
                this.store.lock();
                this.keyring?.lock();
                this.keyring = null;
                Keyring.reset(this.keyringFile);
            }
            throw err;
        }
    }

    /**
     * Create the keyring. Where the OS keyring is weak, the account
     * password (or the backup passphrase) becomes its passphrase.
     * @param {string} password the password
     */
    async createKeyring(password) {
        Keyring.reset(this.keyringFile);
        const status = this.sealer ? await this.sealer.status() :
            {strong: false};
        this.keyring = await Keyring.create({file: this.keyringFile,
            sealer: this.sealer, scryptParams: this.scryptParams,
            passphrase: status.strong ? undefined : password});
        this.unlockStore();
        this.store.clear();
    }

    /**
     * Unlock an account whose keyring needs the password
     * @param {string} password the account password
     */
    async unlock(password) {
        if (this.state !== 'locked') {
            throw failure('NOT_LOCKED', 'Nothing to unlock');
        }
        try {
            await this.keyring.unlock({passphrase: String(password)});
        } catch (err) {
            throw failure(err.code === 'BAD_PASSPHRASE' ? 'WRONG_PASSWORD' :
                err.code, err.message);
        }
        await this.openAccount();
    }

    /** Give the store its keys */
    unlockStore() {
        this.store.unlock({db: this.keyring.cipher('db'),
            secrets: this.keyring.cipher('secrets'),
            index: this.keyring.indexKey()});
    }

    /** @param {Identity} identity stored in the 'secrets' part */
    saveIdentity(identity) {
        this.store.put('Identity', 'me', identity.secret());
    }

    /** With the keyring unlocked: load the identity and start messaging */
    async openAccount() {
        this.unlockStore();
        const secret = this.store.get('Identity', 'me');
        if (!secret) {
            throw failure('CORRUPT', 'The account data is missing');
        }
        this.identity = Identity.fromSecret(secret);
        for (const [key, value] of this.lockedPreferences) {
            this.store.put('Preferences', key, value);
        }
        this.lockedPreferences.clear();
        await this.startMessenger();
        this.state = 'ready';
        this.emit({type: 'account', state: 'ready'});
    }

    /** Start (or restart) messaging with fresh carriers */
    async startMessenger() {
        await this.messenger?.stop();
        const store = this.store;
        this.messenger = new Messenger({
            identity: this.identity,
            carriers: this.makeCarriers(),
            now: this.now,
            log: this.log,
            ...this.retryMs ? {retryMs: this.retryMs} : {},
            // Anyone but a blocked address may complete a handshake, so
            // friend requests can arrive; what strangers may send is
            // decided per message
            authorize: (peer) => !this.store.get('Blocked', peer.address),
            store: {
                loadSessions: async () => store.all('Sessions'),
                saveSessions: async (address, entries) => entries.length ?
                    store.put('Sessions', address, {address, entries}) :
                    store.delete('Sessions', address),
                loadOutbox: async () => store.all('Outbox'),
                putOutboxItem: async (item) => store.put('Outbox', item.id,
                    item),
                deleteOutboxItem: async (id) => store.delete('Outbox', id),
            },
        });
        this.messenger.onMessage((m) => this.receive(m).catch((err) =>
            this.log('A received message failed:', err)));
        this.messenger.onDelivered((d) => this.markDelivered(d));
        this.messenger.onSeen(({address, via, at}) => this.emit({type: 'link',
            senderPublicKey: address, via, at}));
        await this.messenger.start();
        if (this.watchNetwork && !this.networkTimer) {
            let interfaces = JSON.stringify(os.networkInterfaces());
            this.networkTimer = setInterval(() => {
                const now = JSON.stringify(os.networkInterfaces());
                if (now !== interfaces && this.state === 'ready') {
                    interfaces = now;
                    this.startMessenger().catch((err) =>
                        this.log('Restarting the carriers failed:', err));
                }
            }, 5000);
            this.networkTimer.unref();
        }
    }

    /** Delete the account and everything stored on this computer */
    async deleteDatabaseContent() {
        await this.messenger?.stop();
        this.messenger = null;
        if (this.store.unlocked) {
            this.store.clear();
        }
        this.store.lock();
        this.keyring?.lock();
        Keyring.reset(this.keyringFile);
        this.keyring = null;
        this.identity = null;
        this.state = 'none';
        this.emit({type: 'account', state: 'none'});
    }

    // ---- Password checks (ADR-004) -------------------------------------

    /** @return {Object} {due, nextAt} */
    async getPasswordCheck() {
        this.assertReady();
        const state = this.store.get('PasswordCheck', 'state') || {};
        return {due: this.now() >= (state.nextAt ?? 0),
            nextAt: state.nextAt ?? 0};
    }

    /**
     * Check whether the user remembers their password (several seconds)
     * @param {string} password as typed
     * @return {Object} {correct, afterMiss, nextAt}
     */
    async checkPassword(password) {
        this.assertReady();
        const before = this.store.get('PasswordCheck', 'state') || {};
        const correct = await this.identity.checkPassword(String(password),
            {scryptParams: this.scryptParams});
        const next = credentials.nextPasswordCheck(before,
            {now: this.now(), result: correct ? 'right' : 'wrong'});
        next.missedLast = !correct;
        this.store.put('PasswordCheck', 'state', next);
        return {correct, afterMiss: correct && Boolean(before.missedLast),
            nextAt: next.nextAt};
    }

    /** The user dismissed the check */
    async skipPasswordCheck() {
        this.assertReady();
        const before = this.store.get('PasswordCheck', 'state') || {};
        this.store.put('PasswordCheck', 'state', {...before,
            ...credentials.nextPasswordCheck(before,
                {now: this.now(), result: 'skipped'})});
    }

    // ---- Profile --------------------------------------------------------

    /** @return {Object|undefined} our profile, with our address as 'key' */
    async getLoggedInUserInfoPublic() {
        if (this.state !== 'ready') {
            return undefined;
        }
        return {key: this.identity.address,
            ...this.store.get('Profile', 'me')};
    }

    /** @return {string|undefined} our address, if signed in */
    async getMyAddress() {
        return this.state === 'ready' ? this.identity.address : undefined;
    }

    /**
     * Change our profile and send it to every friend
     * @param {Object} info {displayName, about, photo}; missing fields keep
     * their value
     */
    async updateProfile(info) {
        this.assertReady();
        const old = this.store.get('Profile', 'me') || {};
        const profile = {};
        for (const field of ['displayName', 'about', 'photo']) {
            profile[field] = typeof info[field] === 'string' ?
                info[field] : old[field] ?? '';
        }
        const clean = sanitize.sanitizeUserInfo(profile, '');
        delete clean.key;
        this.store.put('Profile', 'me', clean);
        for (const contact of this.store.all('Contacts')) {
            if (contact.status === 'friend') {
                await this.messenger.send(contact.key, 'profile', clean);
            }
        }
    }

    /** @return {Object} our profile as we send it */
    ownProfile() {
        const profile = this.store.get('Profile', 'me') || {};
        return {displayName: profile.displayName || '',
            about: profile.about || '', photo: profile.photo || ''};
    }

    // ---- Contacts -------------------------------------------------------

    /**
     * Friends, and people we sent a request to (pending: true)
     * @return {Array} contacts with 'key' = address
     */
    async getAllFriends() {
        this.assertReady();
        return this.store.all('Contacts')
            .filter((c) => c.status === 'friend' || c.status === 'pending-out')
            .map((c) => ({...c, pending: c.status === 'pending-out'}));
    }

    /**
     * @param {string} address a contact's address, or ours
     * @return {Object|undefined} their profile
     */
    async getUserInfo(address) {
        this.assertReady();
        if (address === this.identity.address) {
            return this.getLoggedInUserInfoPublic();
        }
        return this.store.get('Contacts', String(address));
    }

    /**
     * Send a friend request (or accept theirs, if they sent one first)
     * @param {string} address their hh21… address
     */
    async addFriend(address) {
        this.assertReady();
        address = String(address).replace(/\s+/g, '').toLowerCase();
        try {
            addressing.addressToFingerprint(address);
        } catch (err) {
            throw failure('BAD_ADDRESS', err.message);
        }
        if (address === this.identity.address) {
            throw failure('BAD_ADDRESS', 'That is your own address');
        }
        const contact = this.store.get('Contacts', address);
        if (contact?.status === 'pending-in') {
            return this.acceptFriendRequest(address);
        }
        // Adding someone again is a clear wish to hear from them
        this.store.delete('Blocked', address);
        if (contact?.status !== 'friend') {
            this.store.put('Contacts', address, {key: address,
                status: 'pending-out', displayName: '', about: '', photo: '',
                lastMessageTimestamp: this.now(), isRead: true});
        }
        await this.messenger.send(address, 'friend_request',
            this.ownProfile());
    }

    /** @return {Object} {address: profile} of requests waiting for us */
    async getPendingFriendRequests() {
        this.assertReady();
        const pending = {};
        for (const contact of this.store.all('Contacts')) {
            if (contact.status === 'pending-in') {
                pending[contact.key] = contact;
            }
        }
        return pending;
    }

    /** @param {string} address the requester */
    async acceptFriendRequest(address) {
        this.assertReady();
        const contact = this.store.get('Contacts', String(address));
        if (!contact || contact.status !== 'pending-in') {
            return;
        }
        this.store.put('Contacts', contact.key, {...contact,
            status: 'friend', lastMessageTimestamp: this.now()});
        this.addEvent(contact.key, 'accepted', {by: 'me'});
        await this.messenger.send(contact.key, 'friend_accept',
            this.ownProfile());
    }

    /** @param {string} address the requester; nothing is sent to them */
    async declineFriendRequest(address) {
        this.assertReady();
        const contact = this.store.get('Contacts', String(address));
        if (contact?.status === 'pending-in') {
            this.store.delete('Contacts', contact.key);
        }
    }

    /**
     * @param {string} address a contact
     * @return {string|null} the safety number to compare with them
     */
    async getSafetyNumber(address) {
        this.assertReady();
        try {
            return addressing.safetyNumber(this.identity.fingerprint,
                addressing.addressToFingerprint(String(address)));
        } catch (err) {
            return null;
        }
    }

    /**
     * Mark that the user compared safety numbers with a contact. Only the
     * user sets it; profiles from peers are sanitized and cannot.
     * @param {string} address the contact
     * @param {boolean} verified whether the numbers matched
     */
    async setVerified(address, verified) {
        this.assertReady();
        const contact = this.store.get('Contacts', String(address));
        if (!contact) {
            throw failure('NOT_A_CONTACT', 'No such contact');
        }
        if (Boolean(contact.verified) !== Boolean(verified)) {
            this.addEvent(contact.key, verified ? 'verified' : 'unverified');
        }
        this.store.put('Contacts', contact.key, {...contact,
            verified: Boolean(verified)});
    }

    /**
     * Take back a friend request we sent. If it is still waiting, it is not
     * sent; if it arrived, a withdrawal follows it.
     * @param {string} address who we knocked on
     */
    async withdrawFriendRequest(address) {
        this.assertReady();
        const contact = this.store.get('Contacts', String(address));
        if (contact?.status !== 'pending-out') {
            throw failure('NOT_PENDING', 'No request of ours is waiting');
        }
        for (const item of [...this.messenger.outbox.values()]) {
            if (item.address === contact.key &&
                item.type === 'friend_request') {
                await this.messenger.cancel(item.id);
            }
        }
        this.store.delete('Contacts', contact.key);
        this.store.deleteGroup('Chat', contact.key);
        await this.messenger.send(contact.key, 'friend_withdraw', {});
    }

    /**
     * Remove a contact from this computer: their profile, the conversation
     * and the session. They are not told, and may send a request again.
     * @param {string} address the contact
     */
    async removeContact(address) {
        this.assertReady();
        const key = String(address);
        this.store.delete('Contacts', key);
        this.store.deleteGroup('Chat', key);
        await this.messenger.forget(key);
    }

    /**
     * Remove a contact (or anyone) and drop everything they send from now
     * on: handshakes, requests and messages. They are not told.
     * @param {string} address the address to block
     */
    async blockAddress(address) {
        this.assertReady();
        const key = String(address).replace(/\s+/g, '').toLowerCase();
        try {
            addressing.addressToFingerprint(key);
        } catch (err) {
            throw failure('BAD_ADDRESS', err.message);
        }
        const contact = this.store.get('Contacts', key);
        await this.removeContact(key);
        this.store.put('Blocked', key, {address: key,
            displayName: contact?.displayName || '', at: this.now()});
    }

    /** @param {string} address an address blocked earlier */
    async unblockAddress(address) {
        this.assertReady();
        this.store.delete('Blocked', String(address));
    }

    /** @return {Array} [{address, displayName, at}] blocked addresses */
    async getBlocked() {
        this.assertReady();
        return this.store.all('Blocked').sort((a, b) => b.at - a.at);
    }

    /**
     * Don't send a message that has not been delivered yet. It leaves the
     * outbox and the conversation; a copy already on its way may still
     * arrive.
     * @param {string} address the contact
     * @param {string} id the message id
     * @return {boolean} whether it was still waiting
     */
    async cancelUnsent(address, id) {
        this.assertReady();
        const key = chatKey(String(address), 'sent', String(id));
        const message = this.store.get('Chat', key);
        if (!message || message.delivered) {
            return false;
        }
        await this.messenger.cancel(message.id);
        this.store.delete('Chat', key);
        return true;
    }

    /**
     * How each contact was last heard from: over the local network or the
     * internet, and when. Nothing is known about contacts not heard from
     * since HexHoot started.
     * @return {Object} {address: {via: 'lan'|'dht'|..., at}}
     */
    async getContactLinks() {
        this.assertReady();
        return Object.fromEntries(this.messenger.lastSeen);
    }

    /**
     * Add an event to a conversation (let in, verified, renamed, ...)
     * @param {string} address the contact
     * @param {string} kind the event
     * @param {Object} [data] details
     */
    addEvent(address, kind, data = {}) {
        // Ordered within a millisecond, then unique
        this.eventSeq = (this.eventSeq || 0) + 1;
        const id = 'e' + String(this.eventSeq).padStart(9, '0') +
            crypto.randomBytes(6).toString('base64url');
        this.store.put('Chat', chatKey(address, 'event', id), {id,
            ts: this.now(), type: 'event', event: {kind, ...data},
            contact: address}, address);
    }

    // ---- Chat -----------------------------------------------------------

    /**
     * Send a chat message to a friend
     * @param {string} address the friend
     * @param {Object} message {message: text}
     * @return {string} the message id
     */
    async sendChatMessage(address, message) {
        this.assertReady();
        const contact = this.store.get('Contacts', String(address));
        if (contact?.status !== 'friend') {
            throw failure('NOT_A_FRIEND',
                'They have not accepted your friend request yet');
        }
        const text = String(message?.message ?? '');
        if (text.length === 0 ||
            text.length > sanitize.MAX_CHAT_MESSAGE_LENGTH) {
            throw failure('BAD_MESSAGE', 'Empty or too long');
        }
        const id = await this.messenger.send(contact.key, 'chat', {text});
        const ts = this.now();
        this.store.put('Chat', chatKey(contact.key, 'sent', id), {id, ts, text,
            type: 'sent',
            delivered: false, contact: contact.key}, contact.key);
        this.store.put('Contacts', contact.key, {...contact,
            lastMessageTimestamp: ts});
        return id;
    }

    /**
     * @param {string} address a contact
     * @return {Array} [{key: id, message: {timestamp, message, type,
     * delivered}}], oldest first
     */
    async getAllMessages(address) {
        this.assertReady();
        return this.store.group('Chat', String(address))
            .filter((m) => m.type !== 'event')
            .sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1))
            .map((m) => ({key: m.id, message: {timestamp: m.ts,
                message: m.text, type: m.type, delivered: m.delivered}}));
    }

    /**
     * A conversation with its events, oldest first
     * @param {string} address a contact
     * @return {Array} [{id, ts, kind: 'sent'|'received'|'event', text,
     * delivered, event}]
     */
    async getConversation(address) {
        this.assertReady();
        return this.store.group('Chat', String(address))
            .sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1))
            .map((m) => ({id: m.id, ts: m.ts, kind: m.type,
                text: m.type === 'event' ? '' : m.text,
                delivered: Boolean(m.delivered),
                event: m.type === 'event' ? m.event : undefined}));
    }

    /** @param {string} address the contact whose chat was read */
    async markChatRead(address) {
        this.assertReady();
        const contact = this.store.get('Contacts', String(address));
        if (contact && !contact.isRead) {
            this.store.put('Contacts', contact.key, {...contact,
                isRead: true});
        }
    }

    /** @param {Object} delivered {to, id} from the Messenger */
    markDelivered({to, id}) {
        const message = this.store.get('Chat', chatKey(to, 'sent', id));
        if (message && message.contact === to) {
            this.store.put('Chat', chatKey(to, 'sent', id), {...message,
                delivered: true}, to);
            this.emit({type: 'delivered', senderPublicKey: to, id});
        }
    }

    /**
     * Act on a message from the Messenger. The sender is the identity the
     * session authenticated (S2), and strangers can only send friend
     * requests (S3).
     * @param {Object} received {from, id, ts, type, body}
     */
    async receive({from, id, ts, type, body}) {
        if (this.state !== 'ready') {
            return;
        }
        const address = from.address;
        if (this.store.get('Blocked', address)) {
            return;
        }
        const contact = this.store.get('Contacts', address);
        const profile = () => {
            const clean = sanitize.sanitizeUserInfo(body, address);
            delete clean.key;
            return clean;
        };
        const event = (kind, message) => this.emit({type: 'message',
            senderPublicKey: address, isFromFriend:
                this.store.get('Contacts', address)?.status === 'friend',
            message: {type: kind, message}});

        if (type === 'friend_request') {
            if (contact?.status === 'friend' ||
                contact?.status === 'pending-out') {
                // They added us too, or lost us: we are friends
                this.store.put('Contacts', address, {...contact, ...profile(),
                    status: 'friend'});
                if (contact.status === 'pending-out') {
                    this.addEvent(address, 'accepted', {by: 'both'});
                }
                await this.messenger.send(address, 'friend_accept',
                    this.ownProfile());
                event(messageType.userInfoResponse, {});
            } else {
                this.store.put('Contacts', address, {key: address,
                    ...profile(), status: 'pending-in',
                    lastMessageTimestamp: this.now(), isRead: false});
                event(messageType.friendRequest, {});
            }
        } else if (type === 'friend_accept' || type === 'profile') {
            if (contact?.status === 'friend' ||
                (type === 'friend_accept' && contact?.status ===
                    'pending-out')) {
                const fresh = profile();
                if (contact.status === 'pending-out') {
                    this.addEvent(address, 'accepted', {by: 'them'});
                } else {
                    if (contact.displayName && fresh.displayName !==
                        contact.displayName) {
                        this.addEvent(address, 'renamed', {
                            from: contact.displayName,
                            to: fresh.displayName});
                    }
                    if (fresh.photo !== (contact.photo || '')) {
                        this.addEvent(address, 'photo');
                    }
                }
                this.store.put('Contacts', address, {...contact, ...fresh,
                    status: 'friend'});
                event(messageType.userInfoResponse, {});
            }
        } else if (type === 'friend_withdraw') {
            if (contact?.status === 'pending-in') {
                this.store.delete('Contacts', address);
                event(messageType.friendRequest, {withdrawn: true});
            }
        } else if (type === 'chat') {
            const text = body?.text;
            if (contact?.status !== 'friend' || typeof text !== 'string' ||
                text.length > sanitize.MAX_CHAT_MESSAGE_LENGTH) {
                return;
            }
            const receivedAt = this.now();
            // Keyed by contact and id, so nobody can overwrite another
            // conversation's messages by reusing an id (F6)
            this.store.put('Chat', chatKey(address, 'received', id), {id,
                ts: receivedAt,
                sentAt: ts, text, type: 'received', contact: address},
            address);
            this.store.put('Contacts', address, {...contact,
                lastMessageTimestamp: receivedAt, isRead: false});
            event(messageType.chat, {timestamp: receivedAt, message: text,
                type: 'received', id});
        }
    }

    // ---- Preferences ----------------------------------------------------

    /**
     * @param {string} key preference name
     * @param {*} value JSON-safe value
     */
    async setPreference(key, value) {
        const record = {key: String(key), value};
        if (this.state === 'ready') {
            this.store.put('Preferences', record.key, record);
        } else {
            this.lockedPreferences.set(record.key, record);
        }
    }

    /**
     * @param {string} key preference name
     * @return {Object|undefined} {key, value}
     */
    async getPreference(key) {
        if (this.state === 'ready') {
            return this.store.get('Preferences', String(key));
        }
        return this.lockedPreferences.get(String(key));
    }

    // ---- Backup ---------------------------------------------------------

    /**
     * @param {string} passphrase 16 characters or more
     * @return {Uint8Array} the .hexhoot2 file
     */
    async exportBackup(passphrase) {
        this.assertReady();
        const tables = {};
        for (const name of ['Profile', 'Contacts', 'Chat', 'Preferences',
            'PasswordCheck', 'Blocked']) {
            tables[name] = this.store.all(name);
        }
        return new Uint8Array(await backup.exportBackup(
            {identity: this.identity, tables}, String(passphrase),
            {scryptParams: this.scryptParams}));
    }

    /**
     * Restore a backup onto this computer (when no account is here)
     * @param {Uint8Array} file the .hexhoot2 file
     * @param {string} passphrase its passphrase
     */
    async importBackup(file, passphrase) {
        if (this.state !== 'none') {
            throw failure('ALREADY_SIGNED_IN', 'An account is already here');
        }
        let restored;
        try {
            restored = await backup.importBackup(Buffer.from(file),
                String(passphrase));
        } catch (err) {
            throw failure(err.code, err.message);
        }
        await this.createKeyring(String(passphrase));
        this.saveIdentity(restored.identity);
        const keys = {Profile: () => 'me', PasswordCheck: () => 'state',
            Contacts: (r) => r.key, Preferences: (r) => r.key,
            Blocked: (r) => r.address,
            Chat: (r) => r.contact && r.id && chatKey(r.contact, r.type, r.id)};
        for (const [name, keyOf] of Object.entries(keys)) {
            for (const row of Array.isArray(restored.tables[name]) ?
                restored.tables[name] : []) {
                if (row && typeof row === 'object' && keyOf(row)) {
                    this.store.put(name, String(keyOf(row)), row,
                        name === 'Chat' ? row.contact : undefined);
                }
            }
        }
        await this.openAccount();
    }

    // ---- Status ---------------------------------------------------------

    /** @return {Array} [{name, ready, ...}] per carrier; no key material */
    async getTransportStatus() {
        return this.messenger ? this.messenger.carriers.map((carrier) =>
            carrier.status ? carrier.status() :
                {name: carrier.name, ready: true}) : [];
    }
}

module.exports = Core;
