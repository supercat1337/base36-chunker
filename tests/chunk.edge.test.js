// @ts-check

import test from 'ava';

import { formatChunk, parseChunk, validateSessionId } from '../src/chunk.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { chunksFromLines } from '../src/decode.js';

const { maxIndex, maxTotal, maxByteCount } = DEFAULT_CONFIG;

// ── validateSessionId (via formatChunk) ──────────────────────────────────────

test('formatChunk: rejects non-string session', t => {
    t.throws(
        () =>
            formatChunk(
                /** @type {any} */ ({ session: 123, index: 0, total: 1, bytes: new Uint8Array() })
            ),
        { message: /6-character string/ }
    );
});

test('formatChunk: rejects too-short session', t => {
    t.throws(() => formatChunk({ session: 'short', index: 0, total: 1, bytes: new Uint8Array() }), {
        message: /6-character string/,
    });
});

test('formatChunk: rejects non-base36 session', t => {
    t.throws(
        () => formatChunk({ session: '!!!!!!', index: 0, total: 1, bytes: new Uint8Array() }),
        { message: /base36 characters/ }
    );
});

// ── parseHeader (via parseChunk) ─────────────────────────────────────────────

test('parseChunk: rejects non-string input', t => {
    t.throws(() => parseChunk(/** @type {any} */ (123)), { instanceOf: TypeError });
});

test('parseChunk: rejects line shorter than metaLength', t => {
    t.throws(() => parseChunk('short'), { message: /shorter than the metadata header/ });
});

test('parseChunk: rejects non-base36 characters', t => {
    // 17-char header (valid), then '!' in payload
    t.throws(() => parseChunk('aaaaaa' + '000' + '001' + '00' + '000' + '!'), {
        message: /non-base36/,
    });
});

test('parseChunk: rejects total === 0', t => {
    // 18-char header: session(6) + index(3) + total(3) + count(2) + crc(4)
    t.throws(() => parseChunk('aaaaaa' + '000' + '000' + '00' + '0000'), {
        message: /Invalid total \(0\)/,
    });
});

test('parseChunk: rejects index >= total', t => {
    t.throws(() => parseChunk('aaaaaa' + '005' + '003' + '00' + '0000'), {
        message: /out of range/,
    });
});

test('parseChunk: rejects checksum mismatch', t => {
    // valid 18-char header, byteCount=1, payload 'a', crc=0000 (wrong)
    t.throws(() => parseChunk('aaaaaa' + '000' + '001' + '01' + '0000' + 'a'), {
        message: /Checksum mismatch/,
    });
});

// ── formatChunk validation ──────────────────────────────────────────────────

test('formatChunk: rejects non-object chunk', t => {
    t.throws(() => formatChunk(/** @type {any} */ (null)), { message: /must be an object/ });
});

test('formatChunk: rejects bytes that are not a Uint8Array', t => {
    t.throws(
        () =>
            formatChunk(/** @type {any} */ ({ session: 'abcd12', index: 0, total: 1, bytes: [] })),
        { message: /must be a Uint8Array/ }
    );
});

test('formatChunk: rejects negative index', t => {
    t.throws(
        () => formatChunk({ session: 'abcd12', index: -1, total: 1, bytes: new Uint8Array() }),
        { message: /index must be in/ }
    );
});

test('formatChunk: rejects non-integer index', t => {
    t.throws(
        () => formatChunk({ session: 'abcd12', index: 1.5, total: 2, bytes: new Uint8Array() }),
        { message: /index must be in/ }
    );
});

test('formatChunk: rejects index > maxIndex', t => {
    t.throws(
        () =>
            formatChunk({
                session: 'abcd12',
                index: maxIndex + 1,
                total: maxTotal,
                bytes: new Uint8Array(),
            }),
        { message: /index must be in/ }
    );
});

test('formatChunk: rejects total === 0', t => {
    t.throws(
        () => formatChunk({ session: 'abcd12', index: 0, total: 0, bytes: new Uint8Array() }),
        { message: /total must be in/ }
    );
});

test('formatChunk: rejects total > maxTotal', t => {
    t.throws(
        () =>
            formatChunk({
                session: 'abcd12',
                index: 0,
                total: maxTotal + 1,
                bytes: new Uint8Array(),
            }),
        { message: /total must be in/ }
    );
});

test('formatChunk: rejects index >= total', t => {
    t.throws(
        () => formatChunk({ session: 'abcd12', index: 5, total: 3, bytes: new Uint8Array() }),
        { message: /must be less than total/ }
    );
});

test('formatChunk: rejects bytes longer than maxByteCount', t => {
    t.throws(
        () =>
            formatChunk({
                session: 'abcd12',
                index: 0,
                total: 1,
                bytes: new Uint8Array(maxByteCount + 1),
            }),
        { message: /exceeds the \d+-byte limit/ }
    );
});

test('formatChunk: rejects session starting with a digit', t => {
    t.throws(
        () => formatChunk({ session: '1aaaaa', index: 0, total: 1, bytes: new Uint8Array() }),
        { message: /lowercase letter/ }
    );
});

test('parseChunk: rejects line whose session starts with a digit', t => {
    // Valid header shape but the session begins with '1'
    t.throws(() => parseChunk('1aaaaa' + '000' + '001' + '00' + '0000'), {
        message: /lowercase letter/,
    });
});

// ── Config normalization ───────────────────────────────────────────────────

test('formatChunk / parseChunk: accept a partial ChunkConfig', t => {
    const line = formatChunk(
        { session: 'aaaaaaaa', index: 0, total: 1, bytes: new Uint8Array([1]) },
        { sessionLength: 8 }
    );
    t.is(parseChunk(line, { sessionLength: 8 }).session, 'aaaaaaaa');
});

test('formatChunk: re-resolves a stale ResolvedConfig spread', t => {
    const stale = { ...DEFAULT_CONFIG, sessionLength: 8 };
    const line = formatChunk(
        { session: 'aaaaaaaa', index: 0, total: 1, bytes: new Uint8Array([1]) },
        stale
    );
    // metaLength 20 + one payload char for byte 0x01
    t.is(line.length, 21);
});

test('formatChunk: null config falls back to DEFAULT_CONFIG', t => {
    const line = formatChunk(
        { session: 'abcd12', index: 0, total: 1, bytes: new Uint8Array([1]) },
        /** @type {any} */ (null)
    );
    t.is(line.slice(0, 6), 'abcd12');
});

test('parseChunk: rejects non-object config', t => {
    const line = formatChunk({
        session: 'abcd12',
        index: 0,
        total: 1,
        bytes: new Uint8Array([1]),
    });
    t.throws(() => parseChunk(line, /** @type {any} */ (42)), { instanceOf: TypeError });
});

test('validateSessionId: accepts a partial ChunkConfig', t => {
    t.notThrows(() => validateSessionId('aaaaaaaa', { sessionLength: 8 }));
});

test('formatChunk / parseChunk: accept a resolved-config literal', t => {
    const cfg = { ...DEFAULT_CONFIG, sessionLength: 8 };
    const line = formatChunk(
        { session: 'aaaaaaaa', index: 0, total: 1, bytes: new Uint8Array([1]) },
        cfg
    );
    t.is(parseChunk(line, cfg).session, 'aaaaaaaa');
});

test('chunksFromLines: accepts a resolved-config literal', t => {
    const cfg = { ...DEFAULT_CONFIG, sessionLength: 8 };
    const line = formatChunk(
        { session: 'aaaaaaaa', index: 0, total: 1, bytes: new Uint8Array([1]) },
        cfg
    );
    t.is(chunksFromLines([line], cfg).length, 1);
});
