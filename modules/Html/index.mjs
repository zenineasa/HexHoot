/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Templates for the renderer. Every value interpolated into html`...` is
// escaped, unless it is itself the result of html`...` or raw(...), so peer
// data can only ever become text. This replaces the eval()-based templates.

import {escapeHTML} from '../Sanitize/index.mjs';

/** HTML that is already safe to insert */
class SafeHTML {
    /**
     * @param {string} value trusted HTML
     */
    constructor(value) {
        this.value = value;
    }

    /** @return {string} the HTML */
    toString() {
        return this.value;
    }
}

/**
 * Mark trusted HTML (for example, the app's own SVG) for insertion as is.
 * Never pass data that came from a peer.
 * @param {string} value trusted HTML
 * @return {SafeHTML}
 */
export function raw(value) {
    return new SafeHTML(String(value));
}

/**
 * Convert one interpolated value
 * @param {*} value the value
 * @return {string} HTML
 */
function render(value) {
    if (value instanceof SafeHTML) {
        return value.value;
    }
    if (Array.isArray(value)) {
        return value.map(render).join('');
    }
    return escapeHTML(value);
}

/**
 * Tagged template that escapes every interpolated value
 * @param {Array} strings literal parts
 * @param {...*} values interpolated values
 * @return {SafeHTML}
 */
export function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) {
        out += render(values[i]) + strings[i + 1];
    }
    return new SafeHTML(out);
}

/**
 * Load a stylesheet once; resolves when it has loaded
 * @param {string|URL} href stylesheet URL
 * @return {Promise}
 */
export function loadStyle(href) {
    href = String(href);
    const existing = [...document.querySelectorAll('link[rel=stylesheet]')]
        .find((link) => link.href === href);
    if (existing) {
        return existing.dataset.loaded ? Promise.resolve() :
            new Promise((resolve) => existing.addEventListener('load',
                resolve, {once: true}));
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    const loaded = new Promise((resolve, reject) => {
        link.addEventListener('load', () => {
            link.dataset.loaded = '1';
            resolve();
        }, {once: true});
        link.addEventListener('error', reject, {once: true});
    });
    document.head.appendChild(link);
    return loaded;
}
