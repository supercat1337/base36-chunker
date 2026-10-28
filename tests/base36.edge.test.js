// @ts-check

import test from 'ava';

import { base36ToBytes, decodeNumber, encodeNumber } from '../src/base36.js';

// encodeNumber: invalid inputs (non-integer / negative)
test('encodeNumber: rejects negative values', t => {
    t.throws(() => encodeNumber(-1, 3), { instanceOf: RangeError });
});

test('encodeNumber: rejects non-integer values', t => {
    t.throws(() => encodeNumber(1.5, 3), { instanceOf: RangeError });
});

test('encodeNumber: rejects NaN', t => {
    t.throws(() => encodeNumber(NaN, 3), { instanceOf: RangeError });
});

// decodeNumber: invalid characters (both ASCII and non-ASCII)
test('decodeNumber: rejects non-ASCII characters', t => {
    t.throws(() => decodeNumber('é'), { message: /Invalid base36/ });
});

// base36ToBytes: invalid characters
test('base36ToBytes: rejects ASCII non-base36 characters', t => {
    t.throws(() => base36ToBytes('!', 1), { message: /Invalid base36/ });
});

test('base36ToBytes: rejects non-ASCII characters', t => {
    t.throws(() => base36ToBytes('é', 1), { message: /Invalid base36/ });
});
