/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

// Plain Node unit tests (node --test). Run with: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const sanitize = require('./../../modules/Sanitize/index.mjs');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAA' +
    'fFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('escapeHTML escapes markup and quotes', function() {
    assert.equal(
        sanitize.escapeHTML('<img onerror="require(\'fs\')">'),
        '&lt;img onerror=&quot;require(&#39;fs&#39;)&quot;&gt;');
    assert.equal(sanitize.escapeHTML('a & b ` c'), 'a &amp; b &#96; c');
    assert.equal(sanitize.escapeHTML(undefined), '');
    assert.equal(sanitize.escapeHTML(null), '');
    assert.equal(sanitize.escapeHTML(42), '42');
});

test('safePhoto only allows base64 png, jpeg and webp data URLs', function() {
    assert.equal(sanitize.safePhoto(PNG), PNG);
    assert.equal(sanitize.safePhoto('data:image/jpeg;base64,AAAA'),
        'data:image/jpeg;base64,AAAA');
    for (const bad of [
        'https://evil.example/track.png',
        'javascript:alert(1)',
        'data:image/svg+xml;base64,PHN2Zz4=',
        'data:text/html;base64,PHNjcmlwdD4=',
        'data:image/png;base64,AAAA);background:url(https://evil.example',
        'data:image/png;base64,AAAA"',
        'data:image/png,<svg>',
        '',
        undefined,
        {},
        'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024),
    ]) {
        assert.equal(sanitize.safePhoto(bad), '', String(bad).slice(0, 60));
    }
});

test('isValidAddress accepts hh21 addresses only', function() {
    const address = 'hh21' + 'q'.repeat(58);
    assert.equal(sanitize.isValidAddress(address), true);
    assert.equal(sanitize.isValidAddress(address.toUpperCase()), false);
    assert.equal(sanitize.isValidAddress(address + 'q'), false);
    assert.equal(sanitize.isValidAddress('hh21' + 'b'.repeat(58)), false);
    assert.equal(sanitize.isValidAddress('04abcdef0123'), false);
    assert.equal(sanitize.isValidAddress(123), false);
});

test('sanitizeUserInfo keeps profile fields and the given key', function() {
    const result = sanitize.sanitizeUserInfo({
        key: 'ffff', // must be ignored in favour of the authenticated key
        displayName: 'x'.repeat(500),
        about: 42,
        photo: 'https://evil.example/a.png',
        isRead: true,
        lastMessageTimestamp: 1,
        privateKey: 'secret',
    }, 'abcd');
    assert.deepEqual(result, {
        key: 'abcd',
        displayName: 'x'.repeat(sanitize.MAX_DISPLAY_NAME_LENGTH),
        about: '',
        photo: '',
    });
    assert.deepEqual(sanitize.sanitizeUserInfo(null, 'abcd'),
        {key: 'abcd', displayName: '', about: '', photo: ''});
});

test('sanitizeChatMessage validates text and timestamp', function() {
    assert.deepEqual(
        sanitize.sanitizeChatMessage(
            {message: 'hi', timestamp: 1700000000000, type: 'sent', x: 1}),
        {message: 'hi', timestamp: 1700000000000});
    assert.equal(sanitize.sanitizeChatMessage({message: 1, timestamp: 1}),
        null);
    assert.equal(sanitize.sanitizeChatMessage({message: 'a', timestamp: '1'}),
        null);
    assert.equal(sanitize.sanitizeChatMessage({message: 'a', timestamp: -1}),
        null);
    assert.equal(sanitize.sanitizeChatMessage(
        {message: 'a'.repeat(sanitize.MAX_CHAT_MESSAGE_LENGTH + 1),
            timestamp: 1}), null);
    assert.equal(sanitize.sanitizeChatMessage(null), null);
});

test('tryParseJSON never throws', function() {
    assert.deepEqual(sanitize.tryParseJSON('{"a":1}'), {a: 1});
    assert.equal(sanitize.tryParseJSON('{not json'), undefined);
});
