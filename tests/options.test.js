// @ts-check

import test from 'ava';

import { analyzeItems, analyzeLines } from '../src/analyze.js';
import { parseChunk, formatChunk } from '../src/chunk.js';
import { createCodec } from '../src/codec.js';
import { chunksFromLines, decodeText, joinChunks } from '../src/decode.js';
import { encodeText, splitText } from '../src/encode.js';

// ── Options: both documented shapes ────────────────────────────────────────

test('analyzeLines: bare ChunkConfig in the options slot is honoured', t => {
    const lines = createCodec({ sessionLength: 8 }).encodeText('hello');
    const report = analyzeLines(lines, { sessionLength: 8 });
    t.true(report.ok);
    t.deepEqual(report.malformed, []);
});

test('analyzeLines: ResolvedConfig in the options slot is honoured', t => {
    const codec = createCodec({ sessionLength: 8 });
    const report = analyzeLines(codec.encodeText('hello'), codec.config);
    t.true(report.ok);
});

test('decodeText: bare ChunkConfig in the options slot is honoured', t => {
    const codec = createCodec({ sessionLength: 8, checksum: 'crc8' });
    t.is(decodeText(codec.encodeText('hi'), { sessionLength: 8, checksum: 'crc8' }), 'hi');
});

test('analyzeItems: config and getLine coexist', t => {
    const lines = createCodec({ sessionLength: 8 }).encodeText('hello');
    const rows = lines.map((chunk, id) => ({ id, chunk }));
    const report = analyzeItems(rows, { getLine: r => r.chunk, sessionLength: 8 });
    t.true(report.sessions[0].complete);
});

test('analyzeLines: unknown option is a TypeError, not a silent default', t => {
    t.throws(() => analyzeLines([], { sessionLen: 8 }), {
        instanceOf: TypeError,
        message: /Unknown option/,
    });
});

// ── Empty input semantics ──────────────────────────────────────────────────

test('chunksFromLines / decodeText: empty array explains why it is invalid', t => {
    t.throws(() => decodeText([]), { message: /zero lines never represent a valid encoding/ });
    t.throws(() => chunksFromLines([]), { instanceOf: TypeError });
});

test('encodeText("") still produces exactly one chunk', t => {
    t.is(encodeText('', { sessionId: 'abcd12' }).length, 1);
});

// ── Payload canonicality ───────────────────────────────────────────────────

test('parseChunk: rejects a non-canonical payload', t => {
    // 18-char header, byteCount=1, payload '000a' — decodes to [10], whose
    // canonical form is 'a'.
    const line = 'abcd12' + '000' + '001' + '01' + '0000' + '000a';
    t.throws(() => parseChunk(line), { message: /Non-canonical payload/ });
});

test('parseChunk: leading zero bytes still roundtrip', t => {
    const chunk = { session: 'abcd12', index: 0, total: 1, bytes: new Uint8Array([0, 0, 42]) };
    t.deepEqual(parseChunk(formatChunk(chunk)).bytes, chunk.bytes);
});

test('parseChunk: empty payload is canonical', t => {
    const line = formatChunk({
        session: 'abcd12',
        index: 0,
        total: 1,
        bytes: new Uint8Array(0),
    });
    t.is(parseChunk(line).bytes.length, 0);
});

// ── Oversized line: rejected in O(1) ───────────────────────────────────────

test('parseChunk: rejects a line far longer than any valid chunk', t => {
    const huge = 'a'.repeat(5_000_000);
    const started = Date.now();
    t.throws(() => parseChunk(huge), { message: /too long/ });
    t.true(Date.now() - started < 1000);
});

// ── Surrogates ─────────────────────────────────────────────────────────────

test('splitText: rejects an unpaired surrogate instead of emitting U+FFFD', t => {
    t.throws(() => splitText('a\uD800b'), { message: /unpaired surrogate at index 1/ });
});

test('splitText: accepts a valid surrogate pair', t => {
    t.is(splitText('😀').length, 1);
});

test('encodeText: unknown option is a TypeError', t => {
    t.throws(() => encodeText('x', { maxlen: 40 }), { message: /Unknown option/ });
});

// ── Session format on hand-built chunks ────────────────────────────────────

test('joinChunks: rejects a hand-built chunk with an invalid session id', t => {
    const bad = { session: 'ABCD12', index: 0, total: 1, bytes: new Uint8Array([1]) };
    t.throws(() => joinChunks([bad]), { message: /not a valid base36 session id/ });
});

test('analyzeLines: config and bare fields together is a TypeError', t => {
    t.throws(() => analyzeLines([], { config: { checksum: 'crc8' }, sessionLength: 8 }), {
        instanceOf: TypeError,
        message: /not both/,
    });
});

test('analyzeItems: config and bare fields together is a TypeError', t => {
    // The cast is required: `AnalyzeItemsOptions` marks `config` and the bare
    // fields as mutually exclusive, so an uncast literal is a compile error.
    t.throws(
        () =>
            analyzeItems(
                [],
                /** @type {any} */ ({
                    getLine: () => '',
                    config: { checksum: 'crc8' },
                    sessionLength: 8,
                })
            ),
        { instanceOf: TypeError, message: /not both/ }
    );
});
