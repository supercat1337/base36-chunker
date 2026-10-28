// @ts-check

import test from 'ava';

import {
    ALPHABET,
    LETTERS,
    base36ToBytes,
    bytesToBase36,
    decodeNumber,
    encodeNumber,
    randomBase36,
} from '../src/base36.js';

test('ALPHABET: has 36 unique characters', t => {
    t.is(new Set(ALPHABET).size, 36);
});

test('encodeNumber: zero-pads to the requested width', t => {
    t.is(encodeNumber(0, 3), '000');
});

test('encodeNumber: roundtrips through decodeNumber', t => {
    t.is(decodeNumber(encodeNumber(12345, 3)), 12345);
});

test('encodeNumber: rejects values that do not fit', t => {
    t.throws(() => encodeNumber(36 ** 3, 3), { instanceOf: RangeError });
});

test('decodeNumber: rejects invalid characters', t => {
    t.throws(() => decodeNumber('a!b'), { message: /Invalid base36/ });
});

test('bytesToBase36: empty array yields empty string', t => {
    t.is(bytesToBase36(new Uint8Array()), '');
});

test('base36ToBytes: restores leading zero bytes', t => {
    const restored = base36ToBytes(bytesToBase36(new Uint8Array([0, 0, 42])), 3);
    t.deepEqual(restored, new Uint8Array([0, 0, 42]));
});

test('base36ToBytes: empty string yields N zero bytes', t => {
    // Contract: an all-zero chunk encodes to ""; the caller restores it
    // by passing the byte count from the metadata.
    t.deepEqual(base36ToBytes('', 3), new Uint8Array([0, 0, 0]));
});

test('base36ToBytes: rejects byte-count mismatch (too few bytes)', t => {
    // "100" = 3844 → two bytes (0x0F 0x04), but we ask for one.
    t.throws(() => base36ToBytes('100', 1), { message: /Byte count mismatch/ });
});

test('randomBase36: has requested length', t => {
    t.is(randomBase36(8).length, 8);
});

test('randomBase36: emits base36-only characters', t => {
    t.true(/^[0-9a-z]+$/.test(randomBase36(64)));
});

test('randomBase36: letter-first when given LETTERS', t => {
    const samples = Array.from({ length: 200 }, () => randomBase36(6, LETTERS));
    t.true(samples.every(s => /^[a-z]/.test(s)));
});

test('randomBase36: zero length yields empty string', t => {
    t.is(randomBase36(0), '');
});
