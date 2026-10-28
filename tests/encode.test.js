// @ts-check

import test from 'ava';

import { DEFAULT_CONFIG, resolveConfig } from '../src/config.js';
import { encodeText, generateSessionId, splitText } from '../src/encode.js';

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
        message: /must be greater than META_LEN/,
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

