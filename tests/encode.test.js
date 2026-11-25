// @ts-check

import test from 'ava';

import { DEFAULT_CONFIG, resolveConfig } from '../src/config.js';
import { encodeText, generateSessionId, splitText } from '../src/encode.js';
import { decodeText } from '../src/decode.js';

const { metaLength } = DEFAULT_CONFIG;

// ── generateSessionId ────────────────────────────────────────────────────────

test('generateSessionId: matches default 6-char session length', t => {
    t.regex(generateSessionId(), /^[a-z][0-9a-z]{5}$/);
});

test('generateSessionId: honours custom config', t => {
    const custom = resolveConfig({ sessionLength: 8, checksum: 'crc16' });
    t.regex(generateSessionId(custom), /^[a-z][0-9a-z]{7}$/);
});

test('generateSessionId: always starts with a lowercase letter', t => {
    const samples = Array.from({ length: 200 }, () => generateSessionId());
    t.true(samples.every(s => /^[a-z]/.test(s)));
});

// ── encodeText ───────────────────────────────────────────────────────────────

test('encodeText: single short line', t => {
    t.is(encodeText('Hello').length, 1);
});

test('encodeText: emits base36-only lines', t => {
    const lines = encodeText('Привет, мир!'.repeat(50), { maxLen: 63 });
    t.true(lines.every(l => /^[0-9a-z]+$/.test(l)));
});

test('encodeText: respects maxLen', t => {
    const lines = encodeText('Zażółć gęślą jaźń '.repeat(50), { maxLen: 63 });
    t.true(lines.every(l => l.length <= 63));
});

test('encodeText: rejects maxLen <= metaLength', t => {
    t.throws(() => encodeText('x', { maxLen: 10 }), {
        message: /must be greater than metaLength/,
    });
});

test('encodeText: rejects maxLen too small for any payload', t => {
    t.throws(() => encodeText('x', { maxLen: metaLength + 1 }), {
        message: /too small/,
    });
});

// ── splitText ────────────────────────────────────────────────────────────────

test('splitText: chunk sizes match bytesPerChunk', t => {
    t.deepEqual(
        splitText('abcdefghij', { bytesPerChunk: 3 }).map(c => c.bytes.length),
        [3, 3, 3, 1]
    );
});

test('splitText: deterministic for a fixed sessionId', t => {
    const opts = { maxLen: 40, sessionId: 'abcd12' };
    t.deepEqual(splitText('some text '.repeat(10), opts), splitText('some text '.repeat(10), opts));
});

// ── UTF-8 safety ────────────────────────────────────────────────────────────

test('splitText: never splits inside a UTF-8 character', t => {
    const text = '😀'.repeat(10); // 4 bytes each
    const chunks = splitText(text, { bytesPerChunk: 5 });
    const decoder = new TextDecoder('utf-8', { fatal: true });
    t.true(
        chunks.every(c => {
            try {
                decoder.decode(c.bytes);
                return true;
            } catch {
                return false;
            }
        })
    );
});

test('splitText: roundtrips emoji', t => {
    const text = '😀'.repeat(100);
    t.is(decodeText(encodeText(text, { maxLen: 40 })), text);
});

test('splitText: roundtrips mixed ASCII / Cyrillic / emoji', t => {
    const text = 'aПривет😀'.repeat(50);
    t.is(decodeText(encodeText(text, { maxLen: 40 })), text);
});

test('splitText: bytesPerChunk = 4 fits one emoji per chunk', t => {
    const chunks = splitText('😀😀', { bytesPerChunk: 4 });
    t.deepEqual(
        chunks.map(c => c.bytes.length),
        [4, 4]
    );
});

test('splitText: bytesPerChunk = 8 fits two emoji per chunk', t => {
    const chunks = splitText('😀😀', { bytesPerChunk: 8 });
    t.deepEqual(
        chunks.map(c => c.bytes.length),
        [8]
    );
});

test('splitText: rejects bytesPerChunk too small for a 4-byte character', t => {
    t.throws(() => splitText('😀', { bytesPerChunk: 3 }), {
        message: /too small for a 4-byte UTF-8 character/,
    });
});

test('splitText: rejects bytesPerChunk too small for a 2-byte character', t => {
    t.throws(() => splitText('é', { bytesPerChunk: 1 }), {
        message: /too small for a 2-byte UTF-8 character/,
    });
});

test('splitText: ASCII is unaffected by the UTF-8 back-off', t => {
    t.deepEqual(
        splitText('abcdefghij', { bytesPerChunk: 3 }).map(c => c.bytes.length),
        [3, 3, 3, 1]
    );
});
