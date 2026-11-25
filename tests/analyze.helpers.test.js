// @ts-check

import test from 'ava';

import { compareSessionIds, errorMessage } from '../src/analyze.js';

// ── errorMessage ───────────────────────────────────────────────────────────

test('errorMessage: Error → .message', t => {
    t.is(errorMessage(new Error('boom')), 'boom');
});

test('errorMessage: RangeError → .message', t => {
    t.is(errorMessage(new RangeError('nope')), 'nope');
});

test('errorMessage: string → itself', t => {
    t.is(errorMessage('plain string'), 'plain string');
});

test('errorMessage: number → String()', t => {
    t.is(errorMessage(42), '42');
});

test('errorMessage: null → "null"', t => {
    t.is(errorMessage(null), 'null');
});

// ── compareSessionIds ──────────────────────────────────────────────────────

test('compareSessionIds: a < b → -1', t => {
    t.is(compareSessionIds('aaaaaa', 'bbbbbb'), -1);
});

test('compareSessionIds: a > b → 1', t => {
    t.is(compareSessionIds('bbbbbb', 'aaaaaa'), 1);
});

test('compareSessionIds: a === b → 0', t => {
    t.is(compareSessionIds('aaaaaa', 'aaaaaa'), 0);
});

test('compareSessionIds: sorts base36 correctly', t => {
    const input = ['zzzzzz', '000aaa', 'aaaaaa'];
    t.deepEqual([...input].sort(compareSessionIds), ['000aaa', 'aaaaaa', 'zzzzzz']);
});
