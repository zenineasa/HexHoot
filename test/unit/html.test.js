/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

const test = require('node:test');
const assert = require('node:assert/strict');
const {html, raw} = require('./../../modules/Html/index.mjs');

test('html escapes interpolated values', () => {
    const name = '<img src=x onerror="alert(1)">';
    assert.equal(String(html`<div title="${name}">${name}</div>`),
        '<div title="&lt;img src=x onerror=&quot;alert(1)&quot;&gt;">' +
        '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</div>');
    assert.equal(String(html`${undefined}${null}${0}`), '0');
});

test('html nests templates and arrays without double escaping', () => {
    const items = ['a&b', '<c>'].map((item) => html`<li>${item}</li>`);
    assert.equal(String(html`<ul>${items}</ul>`),
        '<ul><li>a&amp;b</li><li>&lt;c&gt;</li></ul>');
});

test('raw marks trusted HTML only', () => {
    assert.equal(String(html`${raw('<svg></svg>')}`), '<svg></svg>');
    // A string that merely looks like HTML is still escaped
    assert.equal(String(html`${'<svg></svg>'}`), '&lt;svg&gt;&lt;/svg&gt;');
});
