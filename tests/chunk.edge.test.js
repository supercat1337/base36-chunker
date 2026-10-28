// @ts-check

import test from 'ava';

import { formatChunk, parseChunk } from '../src/chunk.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const { maxIndex, maxTotal, maxByteCount } = DEFAULT_CONFIG;

// ── validateSessionId (via formatChunk) ──────────────────────────────────────

test('formatChunk: rejects non-string session', t => {
    t.throws(
        () => formatChunk(/** @type {any} */ ({ session: 123, index: 0, total: 1, bytes: new Uint8Array() })),
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
        () => formatChunk(/** @type {any} */ ({ session: 'abcd12', index: 0, total: 1, bytes: [] })),
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