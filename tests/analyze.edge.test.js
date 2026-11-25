// @ts-check

import test from 'ava';

import {
    analyzeItems,
    analyzeLines,
    completeSessions,
    incompleteSessions,
} from '../src/analyze.js';
import { formatChunk } from '../src/chunk.js';
import { encodeText } from '../src/encode.js';

test('analyzeLines: rejects non-array input', t => {
    t.throws(() => analyzeLines(/** @type {any} */ ('nope')), { instanceOf: TypeError });
});

test('analyzeLines: uses majority total when chunks disagree', t => {
    // mode([2, 2, 3]) → 2
    /** @type {(index: number, total: number) => string} */
    const mk = (index, total) =>
        formatChunk({
            session: 'abcd12',
            index,
            total,
            bytes: new Uint8Array([index]),
        });
    const lines = [mk(0, 2), mk(1, 2), mk(2, 3)];
    const s = analyzeLines(lines).sessions[0];
    t.is(s.expectedTotal, 2);
    t.true(s.totalMismatch);
    t.false(s.complete);
});

test('analyzeLines: empty bucket (all lines failed) still yields a session', t => {
    // 18-char header: session(6) + index(3) + total(3) + count(2) + crc16(4)
    const head = 'abcd12' + '000' + '001' + '05' + '0000';
    const lines = [head + '!!!', head + '???', head + '###'];
    const s = analyzeLines(lines).sessions[0];
    t.is(s.sessionId, 'abcd12');
    t.is(s.chunks.length, 0);
    t.is(s.expectedTotal, null);
    t.true(s.totalMismatch);
    t.false(s.complete);
    t.is(s.errors.length, 3);
});

test('analyzeLines: ok=false when any session is incomplete', t => {
    const lines = encodeText('x'.repeat(200), {
        maxLen: 40,
        sessionId: 'aaaaaa',
    });
    const report = analyzeLines(lines.slice(0, -1));
    t.false(report.ok);
});

test('completeSessions / incompleteSessions: mixed input', t => {
    const a = encodeText('first', { sessionId: 'aaaaaa' });
    const b = encodeText('x'.repeat(200), { maxLen: 40, sessionId: 'bbbbbb' });
    const report = analyzeLines([...a, ...b.slice(0, -1)]);
    t.deepEqual(
        completeSessions(report).map(s => s.sessionId),
        ['aaaaaa']
    );
    t.deepEqual(
        incompleteSessions(report).map(s => s.sessionId),
        ['bbbbbb']
    );
});

test('analyzeLines: reports present/missing/duplicates together', t => {
    /** @type {(idx: number) => string} */
    const mk = idx =>
        formatChunk({
            session: 'abcd12',
            index: idx,
            total: 3,
            bytes: new Uint8Array([idx]),
        });
    const s = analyzeLines([mk(0), mk(0), mk(2)]).sessions[0];
    t.deepEqual(s.present, [0, 2]);
    t.deepEqual(s.missing, [1]);
    t.deepEqual(s.duplicates, [0]);
    t.false(s.complete);
});

test('analyzeLines: digit-leading session is malformed, not thrown', t => {
    const line = '1aaaaa' + '000' + '001' + '00' + '0000';
    const report = analyzeLines([line]);
    t.is(report.malformed.length, 1);
});

test('analyzeItems: digit-leading session goes to malformed with .item', t => {
    const line = '1aaaaa' + '000' + '001' + '00' + '0000';
    const report = analyzeItems([{ id: 7, chunk: line }], { getLine: r => r.chunk });
    t.is(report.malformed.length, 1);
    t.is(report.malformed[0].item.id, 7);
});

test('analyzeLines: invalid config raises RangeError', t => {
    t.throws(() => analyzeLines([], { config: { sessionLength: /** @type {any} */ (3) } }), {
        instanceOf: RangeError,
    });
});

test('analyzeLines: null options falls back to defaults', t => {
    const lines = encodeText('hello', { sessionId: 'abcd12' });
    t.true(analyzeLines(lines, /** @type {any} */ (null)).ok);
});

test('analyzeLines: errors are sorted by line', t => {
    const good = encodeText('hello', { sessionId: 'abcd12' })[0];
    const bad = good.slice(0, 10) + '!' + good.slice(11);
    const report = analyzeLines([bad, good, bad]);
    t.deepEqual(
        report.sessions[0].errors.map(e => e.line),
        [0, 2]
    );
});

test('analyzeItems: explicit undefined options raises TypeError', t => {
    // `options` is required by the type; this covers the JS-caller path.
    t.throws(() => analyzeItems([], /** @type {any} */ (undefined)), {
        message: /getLine must be a function/,
    });
});

test('analyzeItems: null options raises TypeError', t => {
    t.throws(() => analyzeItems([], /** @type {any} */ (null)), {
        message: /getLine must be a function/,
    });
});
