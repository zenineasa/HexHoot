/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Small pieces shared by the screens of the Hive UI: names, initials and
// colours of contacts, avatars, times, icons and toasts. Peer data only ever
// enters HTML through html`...` (escaped) or textContent.

import i18n from '../I18n/index.mjs';
import {safePhoto} from '../Sanitize/index.mjs';
import {html, raw} from '../Html/index.mjs';

export const t = (key, values) => i18n.getText(key, values);

// The original logo's outline (ImagePack/images/icon.svg), with its eyes,
// stroked in the text colour
const LOGO_PATH = 'm 76.617383,33.510491 h -3.204081 l -1.60204,-2.774815 ' +
    '1.602041,-2.774815 h 3.20408 l 1.60204,2.774815 z m -48.341762,' +
    '-8.19e-4 h -3.20424 l -1.60212,-2.774672 1.60212,-2.774672 h 3.204241 ' +
    'l 1.60212,2.774673 z M 99.18691,72.5122 50.84478,100.36359 2.5026501,' +
    '72.5122 2.5026511,44.660795 50.84478,72.5122 99.18691,44.660795 Z M ' +
    '2.5019531,44.660156 V 72.511719 L 50.845703,100.36328 99.1875,' +
    '72.511719 V 44.660156 L 50.845703,72.511719 Z M 99.186358,44.660805 ' +
    '75.0155,58.586506 50.84464,44.660805 50.844641,16.809399 75.0155,' +
    '2.883697 99.186358,16.809399 Z m -48.341579,-7e-6 L 26.673715,' +
    '58.586493 2.5026505,44.660798 2.5026508,16.809404 26.673716,2.8837085 ' +
    '50.844779,16.809405 Z';

/**
 * @param {number} size width and height in pixels
 * @return {SafeHTML} the logo
 */
export function logo(size) {
    return raw(`<svg class="logo" viewBox="0 0 101.689 103.249" ` +
        `width="${Number(size)}" height="${Number(size)}" aria-hidden="true">` +
        `<path fill="none" fill-rule="evenodd" stroke="currentColor" ` +
        `stroke-width="4" d="${LOGO_PATH}"/></svg>`);
}

const ICON_PATHS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/>' +
        '<circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/>' +
        '<circle cx="18" cy="18" r="2"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    info: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9Z"/>' +
        '<path d="M12 11v5M12 8v.01"/>',
    send: '<path d="M5 12h13M12 5l7 7-7 7"/>',
    back: '<path d="M19 12H6M11 5l-7 7 7 7"/>',
};

/**
 * @param {string} name a key of ICON_PATHS
 * @param {number} [size] pixels
 * @return {SafeHTML} the icon
 */
export function icon(name, size = 20) {
    return raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" ` +
        `fill="none" stroke="currentColor" stroke-width="2" ` +
        `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        `${ICON_PATHS[name]}</svg>`);
}

/**
 * The name to show; a contact who has not told us theirs yet is shown by
 * the start of their address
 * @param {Object} profile {displayName, key}
 * @return {string} the name
 */
export function displayName(profile) {
    const name = typeof profile?.displayName === 'string' ?
        profile.displayName.trim() : '';
    return name || shortAddress(profile?.key);
}

/**
 * @param {string} address hh21…
 * @return {string} its start and end, for where a name would go
 */
export function shortAddress(address) {
    address = String(address || '');
    return address.length > 16 ?
        address.slice(0, 8) + '…' + address.slice(-4) : address;
}

/**
 * @param {string} address hh21…
 * @return {string} in groups of four, easier to read aloud and compare
 */
export function groupedAddress(address) {
    return String(address || '').replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * Initials for a cell: works in every script, and for hostile names too
 * @param {Object} profile {displayName, key}
 * @return {string} one or two characters
 */
export function initials(profile) {
    const name = typeof profile?.displayName === 'string' ?
        profile.displayName.trim() : '';
    if (!name) {
        return '?';
    }
    const words = name.split(/\s+/).filter(Boolean);
    const first = (word) => [...word][0] || '';
    return (first(words[0]) + (words.length > 1 ?
        first(words[words.length - 1]) : '')).toUpperCase();
}

/**
 * The first word of a name, for the label under a cell
 * @param {Object} profile {displayName, key}
 * @return {string} the word
 */
export function firstName(profile) {
    const name = displayName(profile);
    return name.split(/\s+/)[0] || name;
}

// Colour pairs (background, ink) for cells without a photo, readable in
// both themes
const CELL_COLOURS = [
    ['#9ad8f5', '#002233'], ['#f4b26a', '#2b1600'], ['#c9e57a', '#223000'],
    ['#f59ab8', '#3a0016'], ['#b9a6ff', '#1a0b4a'], ['#7fe0c4', '#00291f'],
    ['#ffd36b', '#2e2000'], ['#f5a38a', '#3a1000'],
];

/**
 * A stable colour for an address
 * @param {string} address hh21…
 * @return {Array} [background, ink]
 */
export function colourFor(address) {
    let hash = 0;
    for (const char of String(address || '')) {
        hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return CELL_COLOURS[hash % CELL_COLOURS.length];
}

/**
 * A contact's hexagon: their photo, or initials on their colour
 * @param {Object} profile {displayName, key, photo}
 * @param {number} width pixels; the height follows the hexagon
 * @param {string} [extraClass] more classes
 * @return {SafeHTML} the avatar
 */
export function avatar(profile, width, extraClass = '') {
    const height = Math.round(width * 1.125);
    const photo = safePhoto(profile?.photo);
    const [bg, ink] = colourFor(profile?.key);
    // The photo is a checked data: URL, and html`` escapes the attribute
    const style = photo ?
        `width:${width}px;height:${height}px;background-image:url("${photo}")` :
        `width:${width}px;height:${height}px;background:${bg};color:${ink};` +
        `font-size:${Math.round(width / 3.2)}px`;
    return html`<span class="avatar ${extraClass}" style="${style}"
        aria-hidden="true">${photo ? '' : initials(profile)}</span>`;
}

/**
 * @param {number} ts milliseconds
 * @return {string} the time of day, in the user's locale
 */
export function timeOfDay(ts) {
    return new Date(ts).toLocaleTimeString(i18n.selectedLang,
        {hour: '2-digit', minute: '2-digit'});
}

/**
 * @param {number} ts milliseconds
 * @param {number} [now] milliseconds
 * @return {string} "Today", "Yesterday", a weekday, or a date
 */
export function dayLabel(ts, now = Date.now()) {
    const day = (value) => {
        const date = new Date(value);
        return new Date(date.getFullYear(), date.getMonth(), date.getDate())
            .getTime();
    };
    const days = Math.round((day(now) - day(ts)) / 86400000);
    if (days === 0) {
        return t('Hive.today');
    }
    if (days === 1) {
        return t('Hive.yesterday');
    }
    const options = days < 7 ? {weekday: 'long'} :
        {day: 'numeric', month: 'long', year: 'numeric'};
    return new Date(ts).toLocaleDateString(i18n.selectedLang, options);
}

/**
 * A short time for lists: the time today, else the day
 * @param {number} ts milliseconds
 * @return {string} the label
 */
export function shortTime(ts) {
    if (!ts) {
        return '';
    }
    const label = dayLabel(ts);
    return label === t('Hive.today') ? timeOfDay(ts) : label;
}

/**
 * How long ago, roughly
 * @param {number} ts milliseconds
 * @return {string} "just now", "5 minutes ago", ...
 */
export function ago(ts) {
    const minutes = Math.floor((Date.now() - ts) / 60000);
    if (minutes < 1) {
        return t('Hive.justNow');
    }
    if (minutes < 60) {
        return t('Hive.minutesAgo', {n: minutes});
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return t('Hive.hoursAgo', {n: hours});
    }
    return dayLabel(ts);
}

let toastTimer;

/**
 * Confirm an action with a short message at the bottom of the window
 * @param {string} text the message
 */
export function toast(text) {
    let box = document.getElementById('toast');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toast';
        box.setAttribute('role', 'status');
        document.body.appendChild(box);
    }
    box.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.remove(), 3400);
}

/**
 * Copy text to the clipboard; the button says so for a moment
 * @param {string} text what to copy
 * @param {HTMLButtonElement} button the button that was pressed
 */
export async function copyWithFeedback(text, button) {
    await navigator.clipboard.writeText(text);
    const label = button.textContent;
    button.textContent = t('AddFriend.copied');
    setTimeout(() => {
        button.textContent = label;
    }, 2000);
}
