// @ts-check

import test from 'ava';

import {
    CHECKSUM_LENGTHS,
    DEFAULT_CONFIG,
    ensureConfig,
    ensureOptionsConfig,
    resolveConfig,
} from '../src/config.js';

// ── resolveConfig ───────────────────────────────────────────────────────────

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

test('resolveConfig: rejects null', t => {
    t.throws(() => resolveConfig(/** @type {any} */ (null)), { instanceOf: TypeError });
});

test('resolveConfig: rejects non-object', t => {
    t.throws(() => resolveConfig(/** @type {any} */ ('crc8')), { instanceOf: TypeError });
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
    t.is(c.maxIndex, 46655); // 36³ − 1
    t.is(c.maxTotal, 46655);
    t.is(c.maxByteCount, 1295); // 36² − 1
});

// ── ensureConfig ────────────────────────────────────────────────────────────

test('ensureConfig: undefined → DEFAULT_CONFIG', t => {
    t.is(ensureConfig(undefined), DEFAULT_CONFIG);
});

test('ensureConfig: null → DEFAULT_CONFIG', t => {
    t.is(ensureConfig(null), DEFAULT_CONFIG);
});

test('ensureConfig: resolved config returned as-is (no allocation)', t => {
    const c = resolveConfig({ sessionLength: 8 });
    t.is(ensureConfig(c), c);
});

test('ensureConfig: partial config is resolved', t => {
    const c = ensureConfig({ sessionLength: 8 });
    t.is(c.sessionLength, 8);
    t.is(c.metaLength, 20);
});

test('ensureConfig: stale spread is re-resolved', t => {
    // metaLength is still 18 here — ensureConfig must notice and recompute.
    const stale = { ...DEFAULT_CONFIG, sessionLength: 8 };
    t.is(stale.metaLength, 18);
    t.is(ensureConfig(stale).metaLength, 20);
});

test('ensureConfig: rejects non-object', t => {
    t.throws(() => ensureConfig(/** @type {any} */ (42)), { instanceOf: TypeError });
});

test('CHECKSUM_LENGTHS: matches the wire format', t => {
    t.is(CHECKSUM_LENGTHS.none, 0);
    t.is(CHECKSUM_LENGTHS.crc8, 2);
    t.is(CHECKSUM_LENGTHS.crc16, 4);
});

test('ensureConfig: unknown field on a resolved-looking object raises', t => {
    const typo = { ...DEFAULT_CONFIG, sessionLenght: 8 };
    t.throws(() => ensureConfig(typo), { instanceOf: TypeError, message: /Unknown config field/ });
});

test('ensureConfig: corrupted maxByteCount is re-resolved', t => {
    const broken = { ...DEFAULT_CONFIG, maxByteCount: 1 };
    t.is(ensureConfig(broken).maxByteCount, 1295);
});

test('ensureOptionsConfig: { config: undefined } falls back to defaults', t => {
    t.is(ensureOptionsConfig({ config: undefined }), DEFAULT_CONFIG);
});

test('ensureOptionsConfig: { config: undefined, sessionLength: 8 } honours the bare field', t => {
    t.is(ensureOptionsConfig({ config: undefined, sessionLength: 8 }).sessionLength, 8);
});
