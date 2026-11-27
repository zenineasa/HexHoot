/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// The signed-in app: the shell, the routes between its places and the
// keyboard model of docs/design/ui-hive.md.
//
//   Hive (left, always there)  | Home, Conversation, Request or Requests
//                              | (+ the contact panel over a conversation)
//   Settings covers the window; Add a friend is a dialog over anything.
//
// Esc goes one step back. Nothing navigates away under the user: events only
// update what is shown.

import dbMessenger from '../DBMessenger/index.mjs';
import Hive from '../Hive/index.mjs';
import Home from '../Home/index.mjs';
import Chain from '../Chain/index.mjs';
import Requests from '../Requests/index.mjs';
import Contact from '../Contact/index.mjs';
import AddFriend from '../AddFriend/index.mjs';
import Settings from '../Settings/index.mjs';
import sounds from '../Sounds/index.mjs';
import {t, displayName} from '../UI/index.mjs';
import {applyTheme, loadTheme} from './theme.mjs';
import {html, loadStyle} from '../Html/index.mjs';

// Where the user is, kept for the session (sessionStorage)
const PLACE_KEY = 'hexhoot.place';
// How long the "engine restarted" banner stays
const RESTART_NOTICE_MS = 8000;
// Routes that fill the right pane; Settings covers the window
const PANE_ROUTES = new Set(['home', 'chat', 'request', 'requests']);

/**
 * The signed-in app
 */
class App {
    /** constructor */
    constructor() {
        this.state = {route: 'home', id: null, prev: null, panel: false,
            section: 'profile'};
        this.data = {me: null, contacts: [], pending: {}, links: {},
            latest: []};
        this.generation = 0;
        // Counts navigations, so that an event never undoes one
        this.navigations = 0;
        this.started = false;
    }

    /**
     * Draw the shell and the current route. Called on start and after a
     * language change (window.reload).
     */
    async render() {
        await loadStyle(new URL('./style.css', import.meta.url));
        if (!this.started) {
            this.started = true;
            this.listen();
        }
        this.theme = await loadTheme();
        document.getElementById('container').innerHTML = html`
            <div id="app" data-route="home">
                <div id="banner" role="status" hidden></div>
                <div id="shell">
                    <aside id="hive" aria-label="${t('Hive.yourHive')}"></aside>
                    <main id="pane"></main>
                    <aside id="contactPanel" hidden
                        aria-label="${t('Contact.title')}"></aside>
                </div>
                <div id="settings" hidden></div>
            </div>`.toString();
        this.updateBanner();
        await this.refresh();
        // After Core restarted (the window reloaded), go back to where the
        // user was
        if (this.restartedAt && !this.restored) {
            this.restored = true;
            try {
                const saved = JSON.parse(sessionStorage.getItem(PLACE_KEY));
                if (PANE_ROUTES.has(saved?.route) ||
                    saved?.route === 'settings') {
                    Object.assign(this.state, {route: saved.route,
                        id: saved.id ?? null, section: saved.section ||
                            'profile'});
                }
            } catch (err) {
                // Nothing saved
            }
        }
        await this.show();
    }

    // ---- Data -----------------------------------------------------------

    /**
     * Read contacts, requests and links from Core, then redraw the hive.
     * Several can run at once: only the newest one writes, and each waits
     * for it, so that callers always see fresh data afterwards.
     */
    async refresh() {
        let run = this.load(++this.generation);
        this.latestRefresh = run;
        await run;
        while (this.latestRefresh !== run) {
            run = this.latestRefresh;
            await run;
        }
    }

    /**
     * @param {number} generation this load's number; a newer one wins
     */
    async load(generation) {
        const [me, contacts, pending, links] = await Promise.all([
            dbMessenger.getLoggedInUserInfoPublic(),
            dbMessenger.getAllFriends(),
            dbMessenger.getPendingFriendRequests(),
            dbMessenger.getContactLinks(),
        ]);
        const friends = contacts.filter((c) => !c.pending)
            .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
        const latest = await Promise.all(friends.slice(0, 5).map(
            async (friend) => {
                const last = (await dbMessenger.getConversation(friend.key))
                    .filter((m) => m.kind !== 'event').pop();
                return {friend, last};
            }));
        if (generation !== this.generation || !me) {
            return;
        }
        this.data = {me, contacts, pending, links, latest};
        if (document.getElementById('hive')) {
            Hive.render(this);
        }
    }

    /** @return {Array} profiles of everyone knocking, oldest first */
    knocking() {
        return Object.values(this.data.pending)
            .sort((a, b) => a.lastMessageTimestamp - b.lastMessageTimestamp);
    }

    /**
     * @param {string} key an address
     * @return {Object|undefined} the contact (friend or waiting)
     */
    contact(key) {
        return this.data.contacts.find((c) => c.key === key);
    }

    // ---- Navigation -----------------------------------------------------

    /**
     * Go to a place
     * @param {string} route home, chat, request, requests or settings
     * @param {Object} [options] {id, section}
     */
    async go(route, options = {}) {
        this.navigations++;
        const s = this.state;
        const prev = PANE_ROUTES.has(s.route) ? {route: s.route, id: s.id} :
            s.prev;
        this.state = {...s, route, id: options.id ?? null, panel: false,
            prev: route === s.route && route !== 'settings' ? s.prev : prev,
            section: options.section || (route === 'settings' ?
                'profile' : s.section)};
        await this.show();
    }

    /** One step back: panel, then Settings or Requests, then Home */
    async back() {
        const s = this.state;
        this.navigations++;
        if (s.panel) {
            return this.closePanel();
        }
        if (s.route === 'settings' || s.route === 'requests') {
            const prev = s.prev && s.prev.route !== 'requests' ? s.prev :
                {route: 'home', id: null};
            this.state = {...s, route: prev.route, id: prev.id, prev: null};
            return this.show();
        }
        if (s.route !== 'home') {
            return this.go('home');
        }
    }

    /** @return {string} the place "Back" returns to, for its label */
    backLabel() {
        const prev = this.state.prev;
        if (prev?.route === 'chat' && this.contact(prev.id)) {
            return displayName(this.contact(prev.id));
        }
        if (prev?.route === 'request' || prev?.route === 'requests') {
            return t('Requests.title');
        }
        return t('Hive.home');
    }

    /** Draw the current route */
    async show() {
        const {route, id} = this.state;
        const root = document.getElementById('app');
        if (!root) {
            return;
        }
        root.dataset.route = route;
        sessionStorage.setItem(PLACE_KEY, JSON.stringify({route, id,
            section: this.state.section}));
        const settings = document.getElementById('settings');
        const shell = document.getElementById('shell');
        settings.hidden = route !== 'settings';
        shell.hidden = route === 'settings';
        this.renderPanel();
        Hive.render(this);
        if (route === 'settings') {
            await Settings.render(this, settings);
            return;
        }
        const pane = document.getElementById('pane');
        if (route === 'chat' && this.contact(id)) {
            await Chain.render(this, pane, id);
        } else if (route === 'request' && this.data.pending[id]) {
            Requests.renderOne(this, pane, this.data.pending[id]);
        } else if (route === 'requests') {
            Requests.renderList(this, pane);
        } else {
            this.state.route = 'home';
            root.dataset.route = 'home';
            Home.render(this, pane);
        }
    }

    /** Open the contact panel over the conversation */
    openPanel() {
        if (this.state.route === 'chat') {
            this.state.panel = true;
            this.renderPanel();
        }
    }

    /** Close the contact panel; the conversation is unchanged */
    closePanel() {
        this.state.panel = false;
        this.renderPanel();
        document.querySelector('#chainHeader .who')?.focus();
    }

    /** Show or hide the contact panel for the current state */
    renderPanel() {
        const panel = document.getElementById('contactPanel');
        if (!panel) {
            return;
        }
        const open = this.state.panel && this.state.route === 'chat';
        document.getElementById('app').dataset.panel = String(open);
        panel.hidden = !open;
        if (open) {
            Contact.render(this, panel, this.state.id);
        } else {
            panel.replaceChildren();
        }
    }

    // ---- Events and keyboard --------------------------------------------

    /** Listen to Core, the keyboard and the network, once */
    listen() {
        dbMessenger.on('message', (event) => this.onMessage(event));
        dbMessenger.on('delivered', (event) => Chain.onDelivered(this, event));
        dbMessenger.on('link', (event) => {
            this.data.links[event.senderPublicKey] = {via: event.via,
                at: event.at};
            Chain.onLink(this, event.senderPublicKey);
        });
        document.addEventListener('keydown', (event) => this.onKey(event));
        // A message that arrived while the window was in the background is
        // read once the user comes back to its open chat
        window.addEventListener('focus', async () => {
            const contact = this.state.route === 'chat' &&
                this.contact(this.state.id);
            if (contact && contact.isRead === false) {
                await dbMessenger.markChatRead(contact.key);
                await this.refresh();
            }
        });
        window.addEventListener('online', () => this.updateBanner());
        window.addEventListener('offline', () => this.updateBanner());
        // The theme can follow the computer
        matchMedia('(prefers-color-scheme: light)').addEventListener(
            'change', () => applyTheme(this.theme));
    }

    /**
     * Something arrived: update what is shown; never navigate
     * @param {Object} event a 'message' event from Core
     */
    async onMessage(event) {
        const navigations = this.navigations;
        const key = event.senderPublicKey;
        const isChat = event.message?.type === dbMessenger.messageType.chat;
        const open = this.state.route === 'chat' && this.state.id === key;
        if (isChat && open) {
            Chain.onMessage(this, key, event.message.message);
            if (document.hasFocus()) {
                await dbMessenger.markChatRead(key);
            }
        }
        await this.refresh();
        if (!isChat) {
            // Only if the user has not gone somewhere meanwhile
            if (navigations === this.navigations) {
                await this.afterContactsChanged();
            }
            return;
        }
        if (event.isFromFriend && (!open || !document.hasFocus())) {
            this.notify(key, event.message.message.message);
        }
    }

    /** A request or profile changed: keep the pane consistent */
    async afterContactsChanged() {
        const {route, id} = this.state;
        if (route === 'request' && !this.data.pending[id]) {
            // Withdrawn while shown (when let in, the chain opens)
            if (!this.contact(id)) {
                await this.go('home');
            }
        } else if (route === 'requests') {
            Requests.renderList(this, document.getElementById('pane'));
        } else if (route === 'chat') {
            Chain.onContactChanged(this, id);
        } else if (route === 'home') {
            Home.render(this, document.getElementById('pane'));
        }
    }

    /**
     * Tell the user about a message they are not looking at
     * @param {string} key the friend
     * @param {string} text the message
     */
    async notify(key, text) {
        const friend = this.contact(key);
        if (!friend) {
            return;
        }
        try {
            sounds().messageReceivedSound();
        } catch (err) {
            // No audio device
        }
        if (document.hasFocus() || Notification.permission === 'denied' ||
            (Notification.permission === 'default' &&
                await Notification.requestPermission() !== 'granted')) {
            return;
        }
        const note = new Notification(displayName(friend), {
            body: text.length > 200 ? text.slice(0, 200) + '…' : text,
            silent: true,
        });
        note.onclick = () => {
            window.focus();
            this.go('chat', {id: key});
        };
    }

    /**
     * Shortcuts: Esc back, Ctrl/Cmd+K find, +N add a friend, +, settings
     * @param {KeyboardEvent} event the key
     */
    onKey(event) {
        if (!document.getElementById('app') ||
            document.querySelector('dialog[open]')) {
            return; // dialogs handle their own keys
        }
        const mod = event.ctrlKey || event.metaKey;
        if (event.key === 'Escape') {
            event.preventDefault();
            this.back();
        } else if (mod && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            this.findFriend();
        } else if (mod && event.key.toLowerCase() === 'n') {
            event.preventDefault();
            AddFriend.open(this);
        } else if (mod && event.key === ',') {
            event.preventDefault();
            this.go('settings');
        }
    }

    /** Focus the friend search (on a narrow window, the hive comes back) */
    async findFriend() {
        const narrow = matchMedia('(max-width: 959px)').matches;
        if (this.state.route === 'settings' ||
            (narrow && this.state.route !== 'home')) {
            await this.go('home');
        }
        document.getElementById('find')?.focus();
    }

    /** The banner: offline, or for a moment after Core restarted */
    updateBanner() {
        const banner = document.getElementById('banner');
        if (!banner) {
            return;
        }
        const restarted = this.restartedAt &&
            Date.now() - this.restartedAt < RESTART_NOTICE_MS;
        banner.textContent = !navigator.onLine ? t('Hive.offline') :
            restarted ? t('Hive.engineRestarted') : '';
        banner.hidden = navigator.onLine && !restarted;
        banner.dataset.kind = navigator.onLine ? 'restarted' : 'offline';
        document.getElementById('app').dataset.offline =
            String(!navigator.onLine);
        if (restarted) {
            clearTimeout(this.bannerTimer);
            this.bannerTimer = setTimeout(() => this.updateBanner(),
                RESTART_NOTICE_MS - (Date.now() - this.restartedAt) + 50);
        }
    }
}

const app = new App();
export default app;
