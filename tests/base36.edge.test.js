// @ts-check

import test from 'ava';

import { base36ToBytes, decodeNumber, encodeNumber, randomBase36, randomChars } from '../src/base36.js';

// ── encodeNumber ────────────────────────────────────────────────────────────

test('encodeNumber: rejects negative values', t => {
    t.throws(() => encodeNumber(-1, 3), { instanceOf: RangeError });
});

test('encodeNumber: rejects non-integer values', t => {
    t.throws(() => encodeNumber(1.5, 3), { instanceOf: RangeError });
});

test('encodeNumber: rejects NaN', t => {
    t.throws(() => encodeNumber(NaN, 3), { instanceOf: RangeError });
});

test('encodeNumber: width 0 accepts only 0', t => {
    t.is(encodeNumber(0, 0), '');
    t.throws(() => encodeNumber(1, 0), { instanceOf: RangeError });
});

test('encodeNumber: rejects negative width', t => {
    t.throws(() => encodeNumber(0, -1), { instanceOf: RangeError });
});

test('encodeNumber: rejects non-integer width', t => {
    t.throws(() => encodeNumber(0, 1.5), { instanceOf: RangeError });
});

// ── decodeNumber ────────────────────────────────────────────────────────────

test('decodeNumber: rejects non-ASCII characters', t => {
    t.throws(() => decodeNumber('é'), { message: /Invalid base36/ });
});

test('decodeNumber: empty string is 0', t => {
    t.is(decodeNumber(''), 0);
});

// ── base36ToBytes ───────────────────────────────────────────────────────────

test('base36ToBytes: rejects ASCII non-base36 characters', t => {
    t.throws(() => base36ToBytes('!', 1), { message: /Invalid base36/ });
});

test('base36ToBytes: rejects non-ASCII characters', t => {
    t.throws(() => base36ToBytes('é', 1), { message: /Invalid base36/ });
});

test('base36ToBytes: rejects negative expectedLength', t => {
    t.throws(() => base36ToBytes('', -1), { instanceOf: RangeError });
});

test('base36ToBytes: rejects non-integer expectedLength', t => {
    t.throws(() => base36ToBytes('', 1.5), { instanceOf: RangeError });
});

// ── randomBase36 ────────────────────────────────────────────────────────────

test('randomBase36: rejects empty first-char alphabet', t => {
    t.throws(() => randomBase36(1, ''), { message: /alphabet must not be empty/ });
});

test('randomBase36: rejects negative length', t => {
    t.throws(() => randomBase36(-1), { instanceOf: RangeError });
});

test('randomBase36: rejects non-integer length', t => {
    t.throws(() => randomBase36(1.5), { instanceOf: RangeError });
});

// ── randomChars ────────────────────────────────────────────────────────────

test('randomChars: rejects empty alphabet', t => {
    t.throws(() => randomChars('', 1), { message: /alphabet must not be empty/ });
});

test('randomChars: rejects negative count', t => {
    t.throws(() => randomChars('abc', -1), { instanceOf: RangeError });
});

test('randomChars: rejects non-integer count', t => {
    t.throws(() => randomChars('abc', 1.5), { instanceOf: RangeError });
});

test('randomChars: zero count yields empty array', t => {
    t.deepEqual(randomChars('abc', 0), []);
});

test('randomChars: draws only from the given alphabet', t => {
    t.true(randomChars('ab', 64).every(c => c === 'a' || c === 'b'));
});
