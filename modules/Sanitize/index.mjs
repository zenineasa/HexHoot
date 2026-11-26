/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

/**
 * Helpers for handling data that comes from peers (or from an imported
 * database). Nothing received over the network may be inserted into HTML or
 * CSS without passing through these functions first.
 *
 * This module has no DOM or Electron dependencies. It is an ES module shared
 * by the renderer and Core (which loads it with require()).
 */

const MAX_DISPLAY_NAME_LENGTH = 64;
const MAX_ABOUT_LENGTH = 1000;
const MAX_PHOTO_LENGTH = 2 * 1024 * 1024; // 2 MiB of base64
const MAX_CHAT_MESSAGE_LENGTH = 64 * 1024;

const SAFE_PHOTO_REGEX =
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Escape a value so that it can be inserted into HTML text or into a quoted
 * HTML attribute value.
 * @param {*} value any value; non-strings are converted with String()
 * @return {string} escaped string
 */
function escapeHTML(value) {
    if (value === undefined || value === null) {
        return '';
    }
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/`/g, '&#96;');
}

/**
 * Return the photo only if it is a base64 data URL of an allowed raster image
 * type. Anything else (remote URLs, SVG, javascript:, CSS breakouts) is
 * rejected.
 * @param {*} photo candidate photo value
 * @return {string} the photo, or an empty string if it is not allowed
 */
function safePhoto(photo) {
    if (typeof photo !== 'string' || photo.length > MAX_PHOTO_LENGTH) {
        return '';
    }
    return SAFE_PHOTO_REGEX.test(photo) ? photo : '';
}

/**
 * Check that a value looks like a HexHoot address (hh21…, Bech32m). Core
 * checks the checksum; this is the quick check for the UI.
 * @param {*} address candidate address
 * @return {boolean} whether it has the right form
 */
function isValidAddress(address) {
    return typeof address === 'string' &&
        /^hh21[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/.test(address);
}

/**
 * Clip a value to a string of at most maxLength characters.
 * @param {*} value candidate value
 * @param {number} maxLength maximum number of characters
 * @return {string} the clipped string ('' for non-strings)
 */
function clipString(value, maxLength) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.slice(0, maxLength);
}

/**
 * Build a profile object from untrusted user information. Only the known
 * profile fields are copied, so a peer cannot overwrite local fields such as
 * 'isRead' or 'lastMessageTimestamp'.
 * @param {Object} info untrusted user information
 * @param {string} key the key the profile belongs to; this must come from the
 * authenticated sender, never from 'info' itself
 * @return {Object} sanitized profile
 */
function sanitizeUserInfo(info, key) {
    if (info === null || typeof info !== 'object') {
        info = {};
    }
    return {
        key: key,
        displayName: clipString(info.displayName, MAX_DISPLAY_NAME_LENGTH),
        about: clipString(info.about, MAX_ABOUT_LENGTH),
        photo: safePhoto(info.photo),
    };
}

/**
 * Validate the inner chat message of a received 'ChatMessage'.
 * @param {*} message untrusted message object
 * @return {Object|null} a clean message object, or null if invalid
 */
function sanitizeChatMessage(message) {
    if (message === null || typeof message !== 'object') {
        return null;
    }
    if (typeof message.message !== 'string' ||
        message.message.length > MAX_CHAT_MESSAGE_LENGTH) {
        return null;
    }
    if (!Number.isSafeInteger(message.timestamp) || message.timestamp < 0) {
        return null;
    }
    return {
        timestamp: message.timestamp,
        message: message.message,
    };
}

/**
 * Parse JSON without throwing.
 * @param {string} text JSON text
 * @return {*} the parsed value, or undefined if the text is not valid JSON
 */
function tryParseJSON(text) {
    try {
        return JSON.parse(text);
    } catch (err) {
        return undefined;
    }
}

export {
    MAX_DISPLAY_NAME_LENGTH,
    MAX_ABOUT_LENGTH,
    MAX_CHAT_MESSAGE_LENGTH,
    escapeHTML,
    safePhoto,
    isValidAddress,
    clipString,
    sanitizeUserInfo,
    sanitizeChatMessage,
    tryParseJSON,
};
