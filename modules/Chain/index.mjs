/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// A conversation as a chain: a spine down the middle, their messages on one
// side and yours on the other, each on a small hexagon that is hollow while
// it waits for your friend and filled once delivered. Events (letting in,
// verifying, a new name or photo) sit on the spine. The header shows how
// the friend was last heard from.

import dbMessenger from '../DBMessenger/index.mjs';
import i18n from '../I18n/index.mjs';
import {t, avatar, displayName, firstName, timeOfDay, dayLabel, ago, icon,
    toast} from '../UI/index.mjs';
import {MAX_CHAT_MESSAGE_LENGTH} from '../Sanitize/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';

const styleLoaded = loadStyle(new URL('./style.css', import.meta.url));
const draftKey = (key) => 'hexhoot.draft.' + key;
// Folded with "Show all" beyond this many characters or lines
const LONG_CHARS = 1200;
const LONG_LINES = 20;
// Shown large if the message is only this many emoji or fewer
const EMOJI_ONLY = 6;
// The counter appears when fewer characters than this are left
const COUNT_FROM = 2000;
const LINK = /\bhttps?:\/\/[^\s<>"]+/gi;

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
            <button id="newBelow" class="hh-btn hh-primary" hidden></button>
            <div id="composer">
                <div class="field">
                    <label for="composerInput" class="sr-only">
                        ${t('Chain.message')}</label>
                    <textarea id="composerInput" rows="1"
                        maxlength="${MAX_CHAT_MESSAGE_LENGTH}"
                        placeholder="${waiting ? t('Chain.lockedPlaceholder',
        {name: firstName(contact)}) : t('Chain.placeholder')}"></textarea>
                </div>
                <span class="count" aria-live="polite" hidden></span>
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
        Chain.wireBody(app, pane);
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
        const state = t(delivered ? 'Chain.delivered' : 'Chain.waiting');
        const contact = app.contact(app.state.id);
        // Read aloud as "Alice, 10:12: text" or "You, 10:12, waiting: text".
        // The bubble comes first in the page; CSS puts it on its side. The
        // visible time and state would only repeat the lead, so are hidden.
        const lead = sent ? t('Chain.fromYou', {time, state}) :
            t('Chain.fromThem', {time, name: contact ? firstName(contact) :
                ''});
        const bubbleSide = html`<div class="side ${sent ? 'mine' : 'theirs'}">
            <span class="sr-only lead">${lead}</span>
            ${Chain.bubble(item.text)}</div>`;
        const otherSide = html`<div class="side ${sent ? 'theirs' : 'mine'}">
            ${sent ? html`<div class="status"><span class="state"
                aria-hidden="true">${time} · ${state}</span>
                ${delivered ? '' : html`<button class="hh-link cancel">
                    ${t('Chain.dontSend')}</button>`}</div>` :
        html`<span class="time" aria-hidden="true">${time}</span>`}</div>`;
        rows.insertAdjacentHTML('beforeend', html`<div
            class="msg ${sent ? 'sent' : 'received'}" data-id="${item.id}"
            data-delivered="${String(!sent || delivered)}">
            ${bubbleSide}
            <div class="node" aria-hidden="true"><span class="outer hx"><span
                class="inner hx"></span></span></div>
            ${otherSide}
        </div>`.toString());
        const row = rows.lastElementChild;
        for (const link of row.querySelectorAll('.text .link')) {
            link.onclick = () => Chain.confirmLink(app, link.dataset.url);
        }
        const more = row.querySelector('.more');
        if (more) {
            more.onclick = () => {
                const open = row.querySelector('.bubble').classList
                    .toggle('open');
                more.textContent = t(open ? 'Chain.showLess' :
                    'Chain.showAll');
                more.setAttribute('aria-expanded', String(open));
            };
        }
        const cancel = row.querySelector('.cancel');
        if (cancel) {
            cancel.onclick = () => Chain.dontSend(app, item.id);
        }
    }

    /**
     * A message's bubble. Links become buttons that ask before opening;
     * a message of only a few emoji is shown large; a long one is folded.
     * @param {string} text the message
     * @return {SafeHTML} the bubble
     */
    static bubble(text) {
        const graphemes = [...new Intl.Segmenter().segment(text.trim())];
        const emoji = graphemes.length > 0 && graphemes.length <= EMOJI_ONLY &&
            graphemes.every(({segment}) => /^\s*$/.test(segment) ||
                /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(
                    segment)) && !/[\p{L}\p{N}]/u.test(text);
        const long = text.length > LONG_CHARS ||
            text.split('\n').length > LONG_LINES;
        const parts = [];
        let last = 0;
        for (const match of text.matchAll(LINK)) {
            const url = match[0].replace(/[.,;:!?)\]'"]+$/, '');
            parts.push(text.slice(last, match.index));
            parts.push(html`<button type="button" class="link"
                data-url="${url}">${url}</button>`);
            last = match.index + url.length;
        }
        parts.push(text.slice(last));
        return html`<div class="bubble ${emoji ? 'emoji' : ''} ${long ?
            'long' : ''}"><div class="text">${parts}</div>${long ?
            html`<button class="hh-link more" aria-expanded="false">${
                t('Chain.showAll')}</button>` : ''}</div>`;
    }

    /**
     * Ask before opening a link from a message: show where it really goes
     * @param {Object} app the App
     * @param {string} url the link
     */
    static confirmLink(app, url) {
        let host = '';
        try {
            host = new URL(url).host;
        } catch (err) {
            return;
        }
        const contact = app.contact(app.state.id);
        const dialog = document.createElement('dialog');
        dialog.id = 'linkDialog';
        dialog.className = 'hh-dialog';
        dialog.setAttribute('aria-labelledby', 'linkTitle');
        dialog.setAttribute('aria-describedby', 'linkText');
        dialog.innerHTML = html`
            <div class="head"><h2 id="linkTitle">${t('Chain.linkTitle',
        {host})}</h2></div>
            <div class="body">
                <div class="url mono">${url}</div>
                <p class="muted" id="linkText">${t('Chain.linkText',
        {name: contact ? firstName(contact) : ''})}</p>
                <div class="hh-row end">
                    <button class="hh-btn hh-secondary" name="cancel">
                        ${t('Backup.cancel')}</button>
                    <button class="hh-btn hh-primary" name="open">
                        ${t('Chain.linkOpen')}</button>
                </div>
            </div>`.toString();
        document.body.appendChild(dialog);
        const close = () => {
            dialog.close();
            dialog.remove();
        };
        dialog.querySelector('[name=cancel]').onclick = close;
        dialog.oncancel = (event) => {
            event.preventDefault();
            close();
        };
        dialog.querySelector('[name=open]').onclick = () => {
            // Main opens http(s) links in the system browser
            window.open(url);
            close();
        };
        dialog.showModal();
        dialog.querySelector('[name=cancel]').focus();
    }

    /**
     * Scrolling: the "N new messages" button goes when the end is in view
     * @param {Object} app the App
     * @param {HTMLElement} pane the pane
     */
    static wireBody(app, pane) {
        const body = pane.querySelector('#chainBody');
        const below = pane.querySelector('#newBelow');
        Chain.unseen = 0;
        const atEnd = () => body.scrollHeight - body.scrollTop -
            body.clientHeight < 80;
        body.addEventListener('scroll', () => {
            if (atEnd() && !below.hidden) {
                Chain.unseen = 0;
                below.hidden = true;
            }
        });
        below.onclick = () => {
            body.scrollTop = body.scrollHeight;
            Chain.unseen = 0;
            below.hidden = true;
            document.getElementById('composerInput')?.focus();
        };
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
        const count = pane.querySelector('#composer .count');
        const grow = () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 160) + 'px';
            send.disabled = waiting || input.value.trim() === '';
            const left = MAX_CHAT_MESSAGE_LENGTH - input.value.length;
            count.hidden = left > COUNT_FROM;
            count.textContent = t('Chain.charsLeft', {n:
                left.toLocaleString(i18n.selectedLang)});
            count.dataset.tone = left < COUNT_FROM / 10 ? 'warn' : '';
            // The composer floats over the chain: keep the end visible
            const body = pane.querySelector('#chainBody');
            const atEnd = body.scrollHeight - body.scrollTop -
                body.clientHeight < 80;
            body.style.paddingBottom =
                pane.querySelector('#composer').offsetHeight + 40 + 'px';
            if (atEnd) {
                body.scrollTop = body.scrollHeight;
            }
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
        } else if (item.kind === 'received') {
            // Reading further up: say that something came in below
            const below = document.getElementById('newBelow');
            Chain.unseen = (Chain.unseen || 0) + 1;
            below.textContent = t('Chain.newBelow', {n: Chain.unseen});
            below.hidden = false;
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
        for (const el of row.querySelectorAll('.state, .lead')) {
            el.textContent = el.textContent.replace(t('Chain.waiting'),
                t('Chain.delivered'));
        }
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
