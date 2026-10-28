// @ts-check

import test from 'ava';

import { DEFAULT_CONFIG, resolveConfig } from '../src/config.js';

test('resolveConfig: defaults to session 6 + crc16', t => {
    const c = resolveConfig();
    t.is(c.sessionLength, 6);
    t.is(c.checksum, 'crc16');
    t.is(c.metaLength, 18);
});

test('resolveConfig: rejects sessionLength below 4', t => {
    t.throws(() => resolveConfig({ sessionLength: /** @type {any} */ (3) }), {
        instanceOf: RangeError,
    });
});

test('resolveConfig: rejects sessionLength above 8', t => {
    t.throws(() => resolveConfig({ sessionLength: /** @type {any} */ (9) }), {
        instanceOf: RangeError,
    });
});

test('resolveConfig: rejects unknown checksum', t => {
    t.throws(() => resolveConfig({ checksum: /** @type {any} */ ('md5') }), {
        instanceOf: RangeError,
    });
});

test('resolveConfig: metaLength accounts for checksum', t => {
    t.is(resolveConfig({ checksum: 'none' }).metaLength, 14);
    t.is(resolveConfig({ checksum: 'crc8' }).metaLength, 16);
    t.is(resolveConfig({ checksum: 'crc16' }).metaLength, 18);
});

test('DEFAULT_CONFIG is frozen', t => {
    t.true(Object.isFrozen(DEFAULT_CONFIG));
});

test('resolveConfig: max values match base36 capacities', t => {
    const c = resolveConfig();
    t.is(c.maxIndex, 46655);      // 36³ − 1
    t.is(c.maxTotal, 46655);
    t.is(c.maxByteCount, 1295);   // 36² − 1
});