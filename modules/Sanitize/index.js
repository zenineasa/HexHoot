/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

/**
 * Helpers for handling data that comes from peers (or from an imported
 * database). Nothing received over the network may be inserted into HTML or
 * CSS without passing through these functions first.
 *
 * This module has no DOM or Electron dependencies so that it can be unit
 * tested from plain Node.
 */

const MAX_DISPLAY_NAME_LENGTH = 64;
const MAX_ABOUT_LENGTH = 1000;
const MAX_PHOTO_LENGTH = 2 * 1024 * 1024; // 2 MiB of base64
const MAX_CHAT_MESSAGE_LENGTH = 64 * 1024;
const MAX_KEY_LENGTH = 256;

const SAFE_PHOTO_REGEX =
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const KEY_REGEX = /^[0-9a-fA-F]+$/;

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
 * Check that a value looks like a v1 public key (a hex string).
 * @param {*} key candidate key
 * @return {boolean} whether it is a well-formed key
 */
function isValidKey(key) {
    return typeof key === 'string' && key.length > 0 &&
        key.length <= MAX_KEY_LENGTH && KEY_REGEX.test(key);
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

module.exports = {
    MAX_DISPLAY_NAME_LENGTH,
    MAX_ABOUT_LENGTH,
    MAX_CHAT_MESSAGE_LENGTH,
    escapeHTML,
    safePhoto,
    isValidKey,
    sanitizeUserInfo,
    sanitizeChatMessage,
    tryParseJSON,
};
