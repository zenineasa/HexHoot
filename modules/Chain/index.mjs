/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// A conversation as a chain: a spine down the middle, their messages on one
// side and yours on the other, each on a small hexagon that is hollow while
// it waits for your friend and filled once delivered. Events (letting in,
// verifying, a new name or photo) sit on the spine. The header shows how
// the friend was last heard from.

import dbMessenger from '../DBMessenger/index.mjs';
import {t, avatar, displayName, firstName, timeOfDay, dayLabel, ago, icon,
    toast} from '../UI/index.mjs';
import {MAX_CHAT_MESSAGE_LENGTH} from '../Sanitize/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';

const styleLoaded = loadStyle(new URL('./style.css', import.meta.url));
const draftKey = (key) => 'hexhoot.draft.' + key;

/**
 * The conversation pane
 */
export default class Chain {
    /**
     * Open the conversation with a contact (a friend, or someone you are
     * waiting for)
     * @param {Object} app the App
     * @param {HTMLElement} pane where to draw
     * @param {string} key their address
     */
    static async render(app, pane, key) {
        await styleLoaded;
        const contact = app.contact(key);
        const conversation = await dbMessenger.getConversation(key);
        if (app.state.route !== 'chat' || app.state.id !== key) {
            return; // the user moved on meanwhile
        }
        const waiting = contact.pending;
        pane.innerHTML = html`<div id="chain" data-chat=""
            data-waiting="${String(Boolean(waiting))}">
            <header id="chainHeader"></header>
            <div id="chainBody" tabindex="-1">
                <div class="spine" aria-hidden="true"></div>
                <div class="start" hidden></div>
                <div class="rows" role="log"
                    aria-label="${t('Chain.messages')}"></div>
            </div>
            <div id="composer">
                <div class="field">
                    <label for="composerInput" class="sr-only">
                        ${t('Chain.message')}</label>
                    <textarea id="composerInput" rows="1"
                        maxlength="${MAX_CHAT_MESSAGE_LENGTH}"
                        placeholder="${waiting ? t('Chain.lockedPlaceholder',
        {name: firstName(contact)}) : t('Chain.placeholder')}"></textarea>
                </div>
                <button class="send hx" aria-label="${t('Chain.send')}"
                    title="${t('Chain.send')}">${icon('send', 18)}</button>
            </div>
        </div>`.toString();
        Chain.renderHeader(app, key);
        const rows = pane.querySelector('.rows');
        for (const item of conversation) {
            Chain.append(app, rows, item);
        }
        Chain.renderStart(app, key);
        Chain.wireComposer(app, pane, key, waiting);
        const body = pane.querySelector('#chainBody');
        body.scrollTop = body.scrollHeight;
        // Tests wait for this: the chat is loaded and wired
        pane.querySelector('#chain').dataset.chat = key;
        if (contact.isRead === false) {
            await dbMessenger.markChatRead(key);
            app.refresh();
        }
        Chain.startTicking(app);
    }

    /**
     * The header: both cells joined by the link, the name, and actions
     * @param {Object} app the App
     * @param {string} key their address
     */
    static renderHeader(app, key) {
        const header = document.getElementById('chainHeader');
        const contact = app.contact(key);
        if (!header || !contact) {
            return;
        }
        const link = Chain.link(app, contact);
        header.innerHTML = html`
            <button class="hh-btn hh-quiet narrow-only" name="back">
                ← ${t('Hive.hive')}</button>
            <div class="figure" aria-hidden="true">
                ${avatar(app.data.me, 30)}
                <span class="line" data-link="${link.kind}"></span>
                ${avatar(contact, 40)}
            </div>
            <button class="who" title="${t('Contact.title')}"
                ${contact.pending ? 'disabled' : ''}>
                <span class="name">${displayName(contact)}${contact.verified ?
    html`<span class="verified" title="${t('Contact.verified')}">✓</span>` :
    ''}</span>
                <span class="link-text" data-link="${link.kind}">${link.text}
                </span>
            </button>
            ${contact.pending ? html`<button class="hh-btn hh-secondary"
                name="withdraw">${t('Chain.withdraw')}</button>` :
        html`<button class="hh-icon" name="info"
                aria-label="${t('Contact.title')}"
                title="${t('Contact.title')}">${icon('info')}</button>`}`
            .toString();
        header.querySelector('[name=back]').onclick = () => app.go('home');
        const open = () => app.openPanel();
        header.querySelector('.who').onclick = open;
        const info = header.querySelector('[name=info]');
        if (info) {
            info.onclick = open;
        }
        const withdraw = header.querySelector('[name=withdraw]');
        if (withdraw) {
            withdraw.onclick = async () => {
                withdraw.disabled = true;
                await dbMessenger.withdrawFriendRequest(key);
                await app.refresh();
                await app.go('home');
                toast(t('Chain.withdrawn'));
            };
        }
    }

    /**
     * How the friend was last heard from
     * @param {Object} app the App
     * @param {Object} contact the contact
     * @return {Object} {kind: 'direct'|'internet'|'none', text}
     */
    static link(app, contact) {
        if (contact.pending) {
            return {kind: 'none', text: t('Chain.linkWaiting')};
        }
        if (!navigator.onLine) {
            return {kind: 'none', text: t('Chain.linkOffline')};
        }
        const seen = app.data.links[contact.key];
        if (!seen) {
            return {kind: 'none', text: t('Chain.linkNone')};
        }
        const direct = seen.via !== 'dht';
        return {kind: direct ? 'direct' : 'internet',
            text: t(direct ? 'Chain.linkDirect' : 'Chain.linkInternet',
                {ago: ago(seen.at)})};
    }

    /** Keep "5 minutes ago" true while a conversation is open */
    static startTicking(app) {
        if (!Chain.ticker) {
            Chain.ticker = setInterval(() => {
                if (app.state.route === 'chat') {
                    Chain.renderHeader(app, app.state.id);
                }
            }, 60000);
        }
    }

    /**
     * The start of the chain, when no message has been written yet
     * @param {Object} app the App
     * @param {string} key their address
     */
    static renderStart(app, key) {
        const start = document.querySelector('#chainBody .start');
        const contact = app.contact(key);
        if (!start || !contact) {
            return;
        }
        const hasMessages = document.querySelector('#chainBody .msg');
        start.hidden = Boolean(hasMessages);
        const name = firstName(contact);
        start.innerHTML = html`<div class="intro">
            <h2>${contact.pending ? t('Chain.waitingTitle', {name}) :
        t('Chain.startTitle', {name})}</h2>
            ${contact.pending ? t('Chain.waitingText', {name}) :
        t('Chain.startText', {name})}</div>`.toString();
    }

    /**
     * Add one item to the chain, with a day label when the day changes
     * @param {Object} app the App
     * @param {HTMLElement} rows the chain's rows
     * @param {Object} item {id, ts, kind, text, delivered, event}
     */
    static append(app, rows, item) {
        const day = dayLabel(item.ts);
        if (rows.dataset.day !== day) {
            rows.dataset.day = day;
            rows.insertAdjacentHTML('beforeend', html`<div class="day">
                <span>${day}</span></div>`.toString());
        }
        if (item.kind === 'event') {
            const event = Chain.eventText(app, item.event);
            rows.insertAdjacentHTML('beforeend', html`<div class="event"
                data-kind="${item.event?.kind}"><span><span
                class="dot hx"></span>${event}</span></div>`.toString());
            return;
        }
        const sent = item.kind === 'sent';
        const delivered = sent && (item.delivered ||
            Chain.deliveredEarly.has(item.id));
        const time = timeOfDay(item.ts);
        const bubble = html`<div class="bubble"><div class="text"
            >${item.text}</div></div>`;
        rows.insertAdjacentHTML('beforeend', html`<div
            class="msg ${sent ? 'sent' : 'received'}" data-id="${item.id}"
            data-delivered="${String(!sent || delivered)}">
            <div class="side theirs">${sent ? html`<div class="status">
                <span class="state">${time} · ${delivered ?
    t('Chain.delivered') : t('Chain.waiting')}</span>
                ${delivered ? '' : html`<button class="hh-link cancel">
                    ${t('Chain.dontSend')}</button>`}</div>` : bubble}</div>
            <div class="node"><span class="outer hx" role="img"
                aria-label="${sent ? delivered ? t('Chain.delivered') :
        t('Chain.waiting') : t('Chain.received')}"><span
                class="inner hx"></span></span></div>
            <div class="side mine">${sent ? bubble :
        html`<span class="time">${time}</span>`}</div>
        </div>`.toString());
        const cancel = rows.lastElementChild.querySelector('.cancel');
        if (cancel) {
            cancel.onclick = () => Chain.dontSend(app, item.id);
        }
    }

    /**
     * @param {Object} app the App
     * @param {Object} event {kind, by, from, to}
     * @return {string} what happened, in words
     */
    static eventText(app, event = {}) {
        const contact = app.contact(app.state.id);
        const name = contact ? firstName(contact) : '';
        switch (event.kind) {
        case 'accepted':
            return event.by === 'both' ? t('Chain.eventBoth') :
                event.by === 'them' ? t('Chain.eventThem', {name}) :
                    t('Chain.eventMe', {name});
        case 'verified':
            return t('Chain.eventVerified');
        case 'unverified':
            return t('Chain.eventUnverified');
        case 'renamed':
            return t('Chain.eventRenamed', {from: event.from || '',
                to: event.to || ''});
        case 'photo':
            return t('Chain.eventPhoto', {name});
        default:
            return '';
        }
    }

    /**
     * Enter sends, Shift+Enter starts a new line. A draft is kept per
     * contact, also across a restart of Core (the window reloads).
     * @param {Object} app the App
     * @param {HTMLElement} pane the pane
     * @param {string} key their address
     * @param {boolean} waiting whether they have not let us in yet
     */
    static wireComposer(app, pane, key, waiting) {
        const input = pane.querySelector('#composerInput');
        const send = pane.querySelector('#composer .send');
        const grow = () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 160) + 'px';
            send.disabled = waiting || input.value.trim() === '';
        };
        input.disabled = waiting;
        input.value = waiting ? '' :
            sessionStorage.getItem(draftKey(key)) || '';
        grow();
        input.oninput = () => {
            sessionStorage.setItem(draftKey(key), input.value);
            grow();
        };
        input.onkeydown = (event) => {
            if (event.key === 'Enter' && !event.shiftKey &&
                !event.isComposing) {
                event.preventDefault();
                Chain.send(app, key, input, grow);
            }
        };
        send.onclick = () => Chain.send(app, key, input, grow);
        if (!waiting) {
            input.focus();
        }
    }

    /**
     * Send what was typed
     * @param {Object} app the App
     * @param {string} key their address
     * @param {HTMLTextAreaElement} input the composer
     * @param {function} grow resizes the composer
     */
    static async send(app, key, input, grow) {
        const text = input.value.trim();
        if (text === '') {
            return;
        }
        // Cleared now, not when Core answers: by then the user may have
        // typed the next message
        input.value = '';
        sessionStorage.removeItem(draftKey(key));
        grow();
        let id;
        try {
            id = await dbMessenger.sendChatMessage(key, {message: text});
        } catch (err) {
            if (input.value === '') {
                input.value = text;
                grow();
            }
            toast(t('Chain.notFriendYet'));
            return;
        }
        if (app.state.route === 'chat' && app.state.id === key) {
            Chain.add(app, {id, ts: Date.now(), kind: 'sent', text,
                delivered: false});
        }
        app.refresh();
    }

    /**
     * Add an item to the open chain and keep the newest in view
     * @param {Object} app the App
     * @param {Object} item a conversation item
     */
    static add(app, item) {
        const body = document.getElementById('chainBody');
        const rows = body?.querySelector('.rows');
        if (!rows || rows.querySelector(
            `.msg[data-id="${CSS.escape(String(item.id))}"]`)) {
            return;
        }
        const atEnd = body.scrollHeight - body.scrollTop -
            body.clientHeight < 80;
        Chain.append(app, rows, item);
        Chain.renderStart(app, app.state.id);
        if (atEnd || item.kind === 'sent') {
            body.scrollTop = body.scrollHeight;
        }
    }

    /**
     * Take back a message that has not left
     * @param {Object} app the App
     * @param {string} id the message
     */
    static async dontSend(app, id) {
        const key = app.state.id;
        if (await dbMessenger.cancelUnsent(key, id)) {
            document.querySelector(`#chainBody .msg[data-id="${
                CSS.escape(id)}"]`)?.remove();
            Chain.renderStart(app, key);
            toast(t('Chain.notSent'));
            app.refresh();
        } else {
            toast(t('Chain.alreadyDelivered'));
        }
    }

    /**
     * A message arrived in the open chat
     * @param {Object} app the App
     * @param {string} key the sender
     * @param {Object} message {timestamp, message, type, id}
     */
    static onMessage(app, key, message) {
        Chain.add(app, {id: message.id, ts: message.timestamp,
            kind: 'received', text: message.message});
    }

    /**
     * A message we sent was delivered: fill its hexagon
     * @param {Object} app the App
     * @param {Object} event {senderPublicKey, id}
     */
    static onDelivered(app, event) {
        const row = document.querySelector(`#chainBody .msg[data-id="${
            CSS.escape(String(event.id))}"]`);
        if (!row) {
            // It may be delivered before Chain.send has drawn it
            Chain.deliveredEarly.add(event.id);
            if (Chain.deliveredEarly.size > 100) {
                Chain.deliveredEarly.delete(
                    Chain.deliveredEarly.values().next().value);
            }
            return;
        }
        row.dataset.delivered = 'true';
        const status = row.querySelector('.status');
        status.querySelector('.cancel')?.remove();
        const state = status.querySelector('.state');
        state.textContent = state.textContent.replace(t('Chain.waiting'),
            t('Chain.delivered'));
        row.querySelector('.outer').setAttribute('aria-label',
            t('Chain.delivered'));
    }

    /**
     * A friend was heard from
     * @param {Object} app the App
     * @param {string} key the friend
     */
    static onLink(app, key) {
        if (app.state.route === 'chat' && app.state.id === key) {
            Chain.renderHeader(app, key);
        }
    }

    /**
     * Their profile or status changed (renamed, let us in, removed)
     * @param {Object} app the App
     * @param {string} key the contact
     */
    static async onContactChanged(app, key) {
        const contact = app.contact(key);
        const shown = document.getElementById('chain');
        if (!contact) {
            await app.go('home');
        } else if (shown && (shown.dataset.waiting === 'true') !==
            Boolean(contact.pending)) {
            await app.show(); // they let us in: unlock the composer
        } else {
            Chain.renderHeader(app, key);
            // A rename or new photo adds an event
            const known = document.querySelectorAll('#chainBody .event')
                .length;
            const events = (await dbMessenger.getConversation(key))
                .filter((m) => m.kind === 'event');
            for (const event of events.slice(known)) {
                Chain.add(app, event);
            }
        }
    }
}

Chain.deliveredEarly = new Set();
