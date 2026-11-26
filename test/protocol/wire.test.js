/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// L1 tests of wire protocol v2: framing, envelopes, padding.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const wire = require('../../modules/Protocol/wire');

test('Frames survive any split or merge of the stream (T5)', () => {
    const envelopes = [10, 1, 5000, 70000].map((n) =>
        wire.encodeEnvelope(wire.kinds.msg, crypto.randomBytes(32),
            crypto.randomBytes(n)));
    const stream = Buffer.concat(envelopes.map(wire.encodeFrame));
    for (const chunkSize of [1, 3, 7, 4096, stream.length]) {
        const received = [];
        const decoder = new wire.FrameDecoder((e) => received.push(e));
        for (let i = 0; i < stream.length; i += chunkSize) {
            decoder.push(stream.subarray(i, i + chunkSize));
        }
        assert.deepEqual(received, envelopes, 'chunk ' + chunkSize);
    }
});

test('Oversized frames are refused', () => {
    const decoder = new wire.FrameDecoder(() => assert.fail());
    const header = Buffer.alloc(4);
    header.writeUInt32BE(wire.maxFrameBytes + 1);
    assert.throws(() => decoder.push(header), {code: 'BAD_MESSAGE'});
    assert.throws(() => wire.encodeEnvelope(wire.kinds.msg,
        Buffer.alloc(32), Buffer.alloc(wire.maxFrameBytes)));
});

test('Malformed envelopes are dropped, not thrown (T3)', () => {
    const good = wire.encodeEnvelope(wire.kinds.hs1, Buffer.alloc(32, 1),
        Buffer.from('body'));
    assert.deepEqual(wire.decodeEnvelope(good).body, Buffer.from('body'));
    for (const bad of [Buffer.alloc(0), good.subarray(0, 20),
        Buffer.concat([Buffer.from([1]), good.subarray(1)]),
        Buffer.concat([Buffer.from([2, 9]), good.subarray(2)]),
        'not a buffer', null]) {
        assert.equal(wire.decodeEnvelope(bad), null);
    }
});

test('Padmé rounds lengths as the algorithm defines', () => {
    // Worked by hand: E = floor(log2 L), S = floor(log2 E) + 1, round up
    // to a multiple of 2^(E - S)
    assert.equal(wire.padme(0), 0);
    assert.equal(wire.padme(9), 10);
    assert.equal(wire.padme(1000), 1024);
    assert.equal(wire.padme(1025), 1088); // E=10, S=4: multiple of 64
    assert.equal(wire.padme(1000000), 1015808);
    for (let length = 2; length < 200000; length += 997) {
        const padded = wire.padme(length);
        assert.ok(padded >= length && padded <= length * 1.12 + 2, length);
    }
});

test('Inner messages are padded so short ones look the same', () => {
    const short = wire.encodeInner({type: 'chat', body: {text: 'hi'}});
    const longer = wire.encodeInner({type: 'chat',
        body: {text: 'a somewhat longer message, still short'}});
    assert.equal(short.bytes.length, 1024);
    assert.equal(longer.bytes.length, 1024);
    const big = wire.encodeInner({type: 'chat',
        body: {text: 'x'.repeat(5000)}});
    assert.equal(big.bytes.length, wire.padme(big.bytes.readUInt32BE(0) + 4));
    const decoded = wire.decodeInner(short.bytes);
    assert.equal(decoded.id, short.id);
    assert.deepEqual(decoded.body, {text: 'hi'});
    assert.equal(decoded.type, 'chat');
    assert.throws(() => wire.encodeInner({type: 'evil'}));
});

test('Invalid inner messages are dropped', () => {
    const encode = (value) => {
        const json = Buffer.from(JSON.stringify(value));
        const bytes = Buffer.alloc(1024);
        bytes.writeUInt32BE(json.length);
        json.copy(bytes, 4);
        return bytes;
    };
    const ok = {id: 'abc', ts: 1, type: 'chat', body: {}};
    assert.ok(wire.decodeInner(encode(ok)));
    for (const bad of [{...ok, id: 5}, {...ok, id: 'a b'}, {...ok, ts: 'x'},
        {...ok, type: 'evil'}, {...ok, body: null}, {...ok, body: []},
        null, 'text']) {
        assert.equal(wire.decodeInner(encode(bad)), null, JSON.stringify(bad));
    }
    const lying = Buffer.alloc(16);
    lying.writeUInt32BE(1000);
    assert.equal(wire.decodeInner(lying), null);
});
