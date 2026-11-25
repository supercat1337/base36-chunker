// @ts-check

import test from 'ava';

import { DEFAULT_CONFIG } from '../src/config.js';
import { encodeText, generateSessionId, splitText, utf8CharLength } from '../src/encode.js';
import { decodeText } from '../src/decode.js';

const { maxByteCount, maxTotal, metaLength } = DEFAULT_CONFIG;

test('splitText: rejects non-string text', t => {
    t.throws(() => splitText(/** @type {any} */ (123)), { instanceOf: TypeError });
});

test('splitText: rejects bytesPerChunk = 0', t => {
    t.throws(() => splitText('x', { bytesPerChunk: 0 }), {
        message: /positive integer/,
    });
});

test('splitText: rejects bytesPerChunk = 1.5', t => {
    t.throws(() => splitText('x', { bytesPerChunk: 1.5 }), {
        message: /positive integer/,
    });
});

test('splitText: rejects bytesPerChunk > maxByteCount', t => {
    t.throws(() => splitText('x', { bytesPerChunk: 1296 }), {
        message: /exceeds the \d+-byte limit/,
    });
});

test('splitText: rejects non-integer maxLen', t => {
    t.throws(() => splitText('x', { maxLen: 1.5 }), {
        message: /maxLen must be an integer/,
    });
});

test('splitText: rejects maxLen <= metaLength', t => {
    t.throws(() => splitText('x', { maxLen: metaLength }), {
        message: /must be greater than metaLength/,
    });
});

test('splitText: rejects maxLen too small for any payload', t => {
    t.throws(() => splitText('x', { maxLen: metaLength + 1 }), {
        message: /too small for any payload/,
    });
});

test('splitText: rejects maxLen too large', t => {
    t.throws(() => splitText('x', { maxLen: 10000 }), {
        message: /too large/,
    });
});

test('encodeText: rejects text that would exceed maxTotal chunks', t => {
    const text = 'a'.repeat(46656); // = maxTotal + 1
    t.throws(() => encodeText(text, { bytesPerChunk: 1 }), {
        message: /chunks exceed/,
    });
});

// ── utf8CharLength ─────────────────────────────────────────────────────────

test('utf8CharLength: ASCII lead → 1', t => {
    t.is(utf8CharLength(0x41), 1);
});

test('utf8CharLength: 2-byte lead → 2', t => {
    t.is(utf8CharLength(0xc3), 2);
});

test('utf8CharLength: 3-byte lead → 3', t => {
    t.is(utf8CharLength(0xe2), 3);
});

test('utf8CharLength: 4-byte lead → 4', t => {
    t.is(utf8CharLength(0xf0), 4);
});

test('utf8CharLength: invalid lead → 1', t => {
    t.is(utf8CharLength(0x80), 1);
});

// ── 3-byte characters ──────────────────────────────────────────────────────

test('splitText: rejects bytesPerChunk too small for a 3-byte character', t => {
    t.throws(() => splitText('€', { bytesPerChunk: 2 }), {
        message: /too small for a 3-byte UTF-8 character/,
    });
});

test('splitText: roundtrips 3-byte characters', t => {
    const text = '€'.repeat(50);
    t.is(decodeText(encodeText(text, { maxLen: 40 })), text);
});

// ── default options ────────────────────────────────────────────────────────

test('splitText: options is optional', t => {
    t.is(splitText('hello').length, 1);
});

test('generateSessionId: accepts a resolved-config literal', t => {
    t.regex(generateSessionId({ ...DEFAULT_CONFIG, sessionLength: 8 }), /^[a-z][0-9a-z]{7}$/);
});