// @ts-check

import test from 'ava';

import { chunksFromLines, decodeText, joinBytes, joinChunks } from '../src/decode.js';
import { encodeText } from '../src/encode.js';
import { formatChunk } from '../src/chunk.js';

test('joinChunks: rejects empty array', t => {
    t.throws(() => joinChunks([]), { instanceOf: TypeError });
});

test('joinChunks: rejects non-array', t => {
    t.throws(() => joinChunks(/** @type {any} */ ('nope')), { instanceOf: TypeError });
});

test('joinChunks: rejects null chunk', t => {
    t.throws(() => joinChunks(/** @type {any} */ ([null])), { message: /is not an object/ });
});

test('joinChunks: rejects chunk whose bytes are not Uint8Array', t => {
    t.throws(
        () =>
            joinChunks(/** @type {any} */ ([{ session: 'abcd12', index: 0, total: 1, bytes: [] }])),
        { message: /bytes is not a Uint8Array/ }
    );
});

test('joinChunks: rejects total mismatch', t => {
    const a = { session: 'abcd12', index: 0, total: 2, bytes: new Uint8Array([1]) };
    const b = { session: 'abcd12', index: 1, total: 3, bytes: new Uint8Array([2]) };
    t.throws(() => joinChunks([a, b]), { message: /Total chunks mismatch/ });
});

test('joinChunks: rejects gap in indices', t => {
    const a = { session: 'abcd12', index: 0, total: 2, bytes: new Uint8Array([1]) };
    const b = { session: 'abcd12', index: 2, total: 2, bytes: new Uint8Array([2]) };
    t.throws(() => joinChunks([a, b]), { message: /Missing chunk with index 1/ });
});

test('chunksFromLines: rejects empty array', t => {
    t.throws(() => chunksFromLines([]), { instanceOf: TypeError });
});

test('chunksFromLines: rejects non-array', t => {
    t.throws(() => chunksFromLines(/** @type {any} */ ('nope')), { instanceOf: TypeError });
});

test('decodeText: rejects empty input', t => {
    t.throws(() => decodeText([]), { instanceOf: TypeError });
});

test('decodeText: empty-text roundtrip', t => {
    t.is(decodeText(encodeText('')), '');
});

test('joinChunks: rejects duplicate index with a distinct message', t => {
    const a = { session: 'abcd12', index: 0, total: 2, bytes: new Uint8Array([1]) };
    const b = { session: 'abcd12', index: 0, total: 2, bytes: new Uint8Array([2]) };
    t.throws(() => joinChunks([a, b]), { message: /Duplicate chunk index 0/ });
});

test('joinChunks: rejects negative index', t => {
    const c = { session: 'abcd12', index: -1, total: 1, bytes: new Uint8Array([1]) };
    t.throws(() => joinChunks([c]), { message: /index must be a non-negative integer/ });
});

test('joinChunks: rejects non-integer index', t => {
    const c = { session: 'abcd12', index: 0.5, total: 1, bytes: new Uint8Array([1]) };
    t.throws(() => joinChunks([c]), { message: /index must be a non-negative integer/ });
});

test('joinChunks: rejects total < 1', t => {
    const c = { session: 'abcd12', index: 0, total: 0, bytes: new Uint8Array([1]) };
    t.throws(() => joinChunks([c]), { message: /total must be a positive integer/ });
});

test('decodeText: null options falls back to defaults', t => {
    t.is(decodeText(encodeText('hi'), /** @type {any} */ (null)), 'hi');
});

test('joinChunks: rejects invalid UTF-8', t => {
    const c = { session: 'abcd12', index: 0, total: 1, bytes: new Uint8Array([0xff]) };
    t.throws(() => joinChunks([c]), { instanceOf: TypeError });
});

test('joinChunks: rejects lone continuation byte', t => {
    const c = { session: 'abcd12', index: 0, total: 1, bytes: new Uint8Array([0x80]) };
    t.throws(() => joinChunks([c]), { instanceOf: TypeError });
});

test('joinChunks: accepts valid multi-byte UTF-8', t => {
    const c = {
        session: 'abcd12',
        index: 0,
        total: 1,
        bytes: new TextEncoder().encode('😀'),
    };
    t.is(joinChunks([c]), '😀');
});

// ── joinBytes ──────────────────────────────────────────────────────────────

test('joinBytes: returns raw concatenated bytes', t => {
    const chunks = chunksFromLines(encodeText('hello', { sessionId: 'abcd12' }));
    t.deepEqual(joinBytes(chunks), new TextEncoder().encode('hello'));
});

test('joinBytes: preserves invalid UTF-8 (0xFF)', t => {
    const bytes = new Uint8Array([0xff, 0x00, 0x80]);
    const line = formatChunk({ session: 'abcd12', index: 0, total: 1, bytes });
    t.deepEqual(joinBytes(chunksFromLines([line])), bytes);
});

test('joinBytes: empty payload', t => {
    const line = formatChunk({
        session: 'abcd12',
        index: 0,
        total: 1,
        bytes: new Uint8Array(0),
    });
    t.is(joinBytes(chunksFromLines([line])).length, 0);
});

test('joinBytes: roundtrips a multi-chunk binary blob', t => {
    const payload = Uint8Array.from({ length: 100 }, (_, i) => i);
    const per = 29;
    const total = Math.ceil(payload.length / per);
    const chunks = Array.from({ length: total }, (_, i) => ({
        session: 'abcd12',
        index: i,
        total,
        bytes: payload.slice(i * per, (i + 1) * per),
    }));
    t.deepEqual(joinBytes(chunks), payload);
});

test('joinBytes: validates the session like joinChunks', t => {
    const a = { session: 'abcd12', index: 0, total: 2, bytes: new Uint8Array([1]) };
    const b = { session: 'abcd12', index: 1, total: 3, bytes: new Uint8Array([2]) };
    t.throws(() => joinBytes([a, b]), { message: /Total chunks mismatch/ });
});

test('joinBytes: rejects empty array', t => {
    t.throws(() => joinBytes([]), { instanceOf: TypeError });
});

test('joinChunks: still decodes text after the refactor', t => {
    const chunks = chunksFromLines(encodeText('Привет 😀', { sessionId: 'abcd12' }));
    t.is(joinChunks(chunks), 'Привет 😀');
});
