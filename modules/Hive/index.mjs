/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// The hive: contacts as a honeycomb of hexagon cells. Knocking (a request
// for you) first, then friends in a stable, alphabetical place, then the
// people you are waiting for, and "+ Add". The Latest list below restores
// the order by recency that a grid loses.

import AddFriend from '../AddFriend/index.mjs';
import {t, logo, icon, avatar, displayName, firstName, initials, colourFor,
    shortTime} from '../UI/index.mjs';
import {safePhoto} from '../Sanitize/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';

const styleLoaded = loadStyle(new URL('./style.css', import.meta.url));
// With more cells than this, cells get smaller and rows longer
const MANY = 15;

/**
 * The hive (left side of the window)
 */
export default class Hive {
    /**
     * Draw the hive; the search field keeps its text and focus
     * @param {Object} app the App
     */
    static async render(app) {
        await styleLoaded;
        const el = document.getElementById('hive');
        if (!el) {
            return;
        }
        if (!el.dataset.built) {
            Hive.build(app, el);
        }
        const focused = document.activeElement?.closest?.('#hive .cell')
            ?.dataset.key;
        Hive.renderCells(app, el);
        Hive.renderLatest(app, el);
        Hive.renderMe(app, el);
        if (focused) {
            el.querySelector(`.cell[data-key="${CSS.escape(focused)}"]`)
                ?.focus();
        }
    }

    /**
     * The parts that do not change with the data
     * @param {Object} app the App
     * @param {HTMLElement} el the hive element
     */
    static build(app, el) {
        const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl';
        el.innerHTML = html`
            <div class="hive-head">
                ${logo(28)}
                <button class="wordmark" id="homeButton"
                    title="${t('Hive.home')} (Esc)">HexHoot</button>
                <button class="hh-icon" id="addFriendButton"
                    aria-label="${t('Hive.addFriend')} (${mod}+N)"
                    title="${t('Hive.addFriend')} (${mod}+N)">
                    ${icon('plus')}</button>
                <button class="hh-icon" id="settingsButton"
                    aria-label="${t('Settings.title')} (${mod}+,)"
                    title="${t('Settings.title')} (${mod}+,)">
                    ${icon('settings')}</button>
            </div>
            <div class="find">
                <label for="find" class="sr-only">${t('Hive.find')}</label>
                <input id="find" class="hh-input" type="search"
                    autocomplete="off" spellcheck="false"
                    placeholder="${t('Hive.find')}">
                <span class="hh-kbd">${mod} K</span>
            </div>
            <div class="cells-head">
                <span class="label">${t('Hive.yourHive')}</span>
                <button class="hh-link" id="knockingLink" hidden></button>
            </div>
            <div class="no-match" hidden></div>
            <div class="cells" role="list"
                aria-label="${t('Hive.cellsLabel')}"></div>
            <div class="latest" hidden>
                <div class="label">${t('Hive.latest')}</div>
                <div class="list"></div>
            </div>
            <button id="me" title="${t('Hive.meTitle')}"></button>`
            .toString();
        el.dataset.built = '1';

        el.querySelector('#homeButton').onclick = () => app.go('home');
        el.querySelector('#addFriendButton').onclick = () =>
            AddFriend.open(app);
        el.querySelector('#settingsButton').onclick = () =>
            app.go('settings');
        el.querySelector('#knockingLink').onclick = () =>
            app.go('requests');
        el.querySelector('#me').onclick = () =>
            app.go('settings', {section: 'profile'});
        const find = el.querySelector('#find');
        find.oninput = () => Hive.renderCells(app, el);
        find.onkeydown = (event) => {
            if (event.key === 'Escape' && find.value) {
                event.stopPropagation();
                find.value = '';
                Hive.renderCells(app, el);
            } else if (event.key === 'Enter' || event.key === 'ArrowDown') {
                event.preventDefault();
                el.querySelector('.cell')?.focus();
                if (event.key === 'Enter') {
                    el.querySelector('.cell')?.click();
                }
            }
        };
        el.querySelector('.cells').addEventListener('keydown',
            (event) => Hive.moveFocus(event));
    }

    /**
     * The cells that match the search
     * @param {Object} app the App
     * @param {string} query the search text
     * @return {Array} [{kind, key, profile, label, select}]
     */
    static cells(app, query) {
        const q = query.trim().toLowerCase();
        const matches = (profile) => !q ||
            displayName(profile).toLowerCase().includes(q) ||
            profile.key.startsWith(q);
        const byName = (a, b) => displayName(a).localeCompare(displayName(b),
            undefined, {sensitivity: 'base'});
        const {route, id} = app.state;
        const cells = [];
        for (const profile of app.knocking().filter(matches)) {
            cells.push({kind: 'knocking', key: profile.key, profile,
                small: t('Hive.knocking'),
                label: t('Hive.isKnocking', {name: displayName(profile)}),
                current: route === 'request' && id === profile.key,
                select: () => app.go('request', {id: profile.key})});
        }
        const contacts = app.data.contacts.filter(matches);
        for (const profile of [
            ...contacts.filter((c) => !c.pending).sort(byName),
            ...contacts.filter((c) => c.pending).sort(byName)]) {
            const waiting = profile.pending;
            const current = route === 'chat' && id === profile.key;
            const unread = !waiting && profile.isRead === false;
            cells.push({kind: waiting ? 'waiting' : 'friend',
                key: profile.key, profile, current, unread,
                small: waiting ? t('Hive.waiting') : firstName(profile),
                label: (waiting ? t('Hive.waitingFor',
                    {name: displayName(profile)}) : displayName(profile)) +
                    (unread ? ', ' + t('Hive.unread') : '') +
                    (profile.verified ? ', ' + t('Contact.verified') : ''),
                // Clicking the open chat's cell again goes Home
                select: () => current ? app.go('home') :
                    app.go('chat', {id: profile.key})});
        }
        if (!q) {
            cells.push({kind: 'add', key: '', small: t('Hive.add'),
                label: t('Hive.addFriend'),
                select: () => AddFriend.open(app)});
        }
        return cells;
    }

    /**
     * Draw the honeycomb
     * @param {Object} app the App
     * @param {HTMLElement} el the hive element
     */
    static renderCells(app, el) {
        const query = el.querySelector('#find').value;
        const cells = Hive.cells(app, query);
        const many = cells.length > MANY;
        const perRow = many ? [5, 4] : [4, 3];
        const rows = [];
        for (let i = 0, r = 0; i < cells.length; r++) {
            rows.push(cells.slice(i, i + perRow[r % 2]));
            i += perRow[r % 2];
        }
        const box = el.querySelector('.cells');
        box.classList.toggle('many', many);
        box.innerHTML = html`${rows.map((row, r) => html`
            <div class="row ${r % 2 ? 'odd' : ''}">${row.map((cell) =>
    Hive.cellHTML(cell))}</div>`)}`.toString();
        const byKey = new Map(cells.map((cell) => [cell.key, cell]));
        for (const button of box.querySelectorAll('.cell')) {
            button.onclick = () => byKey.get(button.dataset.key).select();
        }

        const knocking = app.knocking().length;
        const link = el.querySelector('#knockingLink');
        link.hidden = knocking < 2;
        link.textContent = t('Hive.nKnocking', {n: knocking});

        const noMatch = el.querySelector('.no-match');
        const none = query.trim() && cells.length === 0;
        noMatch.hidden = !none;
        if (none) {
            noMatch.innerHTML = html`${t('Hive.noMatch', {query: query.trim()})}
                <button class="hh-link">${t('Hive.useAddress')}</button>`
                .toString();
            noMatch.querySelector('button').onclick = () =>
                AddFriend.open(app);
        }
    }

    /**
     * @param {Object} cell from cells()
     * @return {SafeHTML} the cell
     */
    static cellHTML(cell) {
        const profile = cell.profile;
        const photo = cell.kind === 'friend' || cell.kind === 'knocking' ?
            safePhoto(profile?.photo) : '';
        const [bg, ink] = colourFor(cell.key);
        const style = cell.kind === 'waiting' || cell.kind === 'add' ? '' :
            photo ? `background-image:url("${photo}")` :
                `background:${bg};color:${ink}`;
        return html`<div role="listitem" class="cell-wrap">
            <button class="cell" data-testid="cell" data-kind="${cell.kind}"
                data-key="${cell.key}"
                data-name="${profile ? displayName(profile) : ''}"
                aria-label="${cell.label}" title="${cell.label}"
                aria-current="${cell.current ? 'true' : 'false'}">
                <span class="ring hx"><span class="inner hx ${photo ?
        'photo' : ''}" style="${style}">${photo ? '' : html`
                    <span class="big">${cell.kind === 'add' ? '+' :
        initials(profile)}</span>
                    <span class="small">${cell.small}</span>`}
                </span></span>
            </button>
            ${cell.kind === 'knocking' || cell.unread ? html`<span
                class="badge hx" aria-hidden="true">${cell.kind ===
                'knocking' ? '!' : ''}</span>` : ''}
        </div>`;
    }

    /**
     * Arrow keys move between cells, by position on the screen
     * @param {KeyboardEvent} event the key
     */
    static moveFocus(event) {
        const cell = event.target.closest('.cell');
        if (!cell || !event.key.startsWith('Arrow')) {
            return;
        }
        event.preventDefault();
        const all = [...event.currentTarget.querySelectorAll('.cell')];
        const index = all.indexOf(cell);
        let next;
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            next = all[index + (event.key === 'ArrowRight' ? 1 : -1)];
        } else {
            const here = cell.getBoundingClientRect();
            const down = event.key === 'ArrowDown';
            const rows = all.map((c) => ({c, r: c.getBoundingClientRect()}))
                .filter(({r}) => down ? r.top > here.top + 4 :
                    r.top < here.top - 4);
            const rowTop = down ? Math.min(...rows.map(({r}) => r.top)) :
                Math.max(...rows.map(({r}) => r.top));
            const centre = (r) => r.left + r.width / 2;
            next = rows.filter(({r}) => Math.abs(r.top - rowTop) < 4)
                .sort((a, b) => Math.abs(centre(a.r) - centre(here)) -
                    Math.abs(centre(b.r) - centre(here)))[0]?.c;
        }
        next?.focus();
    }

    /**
     * The Latest list: recent conversations
     * @param {Object} app the App
     * @param {HTMLElement} el the hive element
     */
    static renderLatest(app, el) {
        const box = el.querySelector('.latest');
        const latest = app.data.latest;
        box.hidden = latest.length === 0;
        box.querySelector('.list').innerHTML = html`${latest.map(
            ({friend, last}) => html`<button class="now"
                data-key="${friend.key}">
                <span class="who ${friend.isRead === false ? 'unread' : ''}"
                    >${firstName(friend)}</span>
                <span class="what">${last ? (last.kind === 'sent' ?
        t('Hive.you') + ' ' : '') + last.text : t('Hive.sayHello')}</span>
                <span class="when">${last ? shortTime(last.ts) : ''}</span>
            </button>`)}`.toString();
        for (const button of box.querySelectorAll('.now')) {
            button.onclick = () => app.go('chat', {id: button.dataset.key});
        }
    }

    /**
     * Your own cell, at the bottom
     * @param {Object} app the App
     * @param {HTMLElement} el the hive element
     */
    static renderMe(app, el) {
        const me = app.data.me;
        el.querySelector('#me').innerHTML = html`
            ${avatar(me, 32)}
            <span class="me-text">
                <span class="me-name">${displayName(me)}</span>
                <span class="me-status"><span class="dot hx"></span>${
    navigator.onLine ? t('Hive.reachable') : t('Hive.offlineShort')}</span>
            </span>
            <span class="muted">${t('Hive.edit')}</span>`.toString();
    }
}
