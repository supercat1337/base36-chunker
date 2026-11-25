// @ts-check

/**
 * Layout widths of the metadata header. Fixed at 3/3/2 so the wire format
 * stays stable across configs; only `sessionLength` and `checksum` are
 * caller-configurable.
 * @internal
 */
const LAYOUT = Object.freeze({
    indexLength: 3,
    totalLength: 3,
    countLength: 2,
});

/**
 * Capacities implied by {@link LAYOUT}: the largest value each fixed-width
 * field can hold. Computed once so `resolveConfig` and `ensureConfig` cannot
 * disagree about them.
 * @internal
 */
const CAPACITY = Object.freeze({
    maxIndex: 36 ** LAYOUT.indexLength - 1,
    maxTotal: 36 ** LAYOUT.totalLength - 1,
    maxByteCount: 36 ** LAYOUT.countLength - 1,
});

/**
 * How many base36 characters each checksum algorithm needs.
 *
 * A 16-bit CRC has 65 536 possible values. Three base36 digits cover only
 * `36³ = 46 656` values — not enough — so CRC16 needs four digits
 * (`36⁴ = 1 679 616`). CRC8 has 256 values and fits in two digits
 * (`36² = 1 296`).
 *
 * @internal
 * @type {Readonly<Record<"none" | "crc8" | "crc16", number>>}
 */
export const CHECKSUM_LENGTHS = Object.freeze({
    none: 0,
    crc8: 2,
    crc16: 4,
});

/**
 * Every field `resolveConfig` understands: the two caller-facing keys plus
 * the derived ones, so a resolved config can be passed back in unchanged.
 * Anything else is a typo and must fail loudly.
 * @internal
 */
const KNOWN_CONFIG_KEYS = Object.freeze([
    'sessionLength',
    'checksum',
    'crcLength',
    'indexLength',
    'totalLength',
    'countLength',
    'metaLength',
    'maxIndex',
    'maxTotal',
    'maxByteCount',
]);

/**
 * Set form of {@link KNOWN_CONFIG_KEYS}. `ensureConfig` runs on every
 * `parseChunk`, so membership must be O(1) — a linear `includes` over ten
 * keys per line would show up in a 46 655-chunk session.
 * @internal
 */
const KNOWN_CONFIG_KEY_SET = new Set(KNOWN_CONFIG_KEYS);

/**
 * Reject unknown config fields.
 *
 * The wire format depends on the config, so a silent fallback to the
 * defaults is data corruption: encoding with `{ sessionLen: 8 }` and
 * decoding with `{ sessionLength: 8 }` would look "successful" while the
 * layouts differ.
 *
 * @internal
 * @param {object} partial
 * @returns {void}
 * @throws {TypeError} If an unexpected field is present.
 */
function assertKnownConfigKeys(partial) {
    for (const key of Object.keys(partial)) {
        if (!KNOWN_CONFIG_KEY_SET.has(key)) {
            throw new TypeError(
                `Unknown config field: ${JSON.stringify(key)} ` +
                    '(expected "sessionLength" and/or "checksum")'
            );
        }
    }
}

/**
 * Resolve a possibly-partial config into a frozen, fully-specified one.
 * All layout widths are filled in; derived values (`crcLength`,
 * `metaLength`, `maxIndex`, `maxTotal`, `maxByteCount`) are computed once.
 *
 * @public
 * @param {import("./types.js").ChunkConfig} [partial]
 * @returns {Readonly<import("./types.js").ResolvedConfig>}
 * @throws {TypeError} If `partial` is not an object or has an unknown field.
 * @throws {RangeError} If a field is out of range.
 */
export function resolveConfig(partial = {}) {
    if (partial === null || typeof partial !== 'object') {
        throw new TypeError('config must be an object');
    }
    assertKnownConfigKeys(partial);

    const raw = /** @type {{ sessionLength?: unknown, checksum?: unknown }} */ (partial);

    const sessionLengthValue = raw.sessionLength === undefined ? 6 : raw.sessionLength;
    if (
        typeof sessionLengthValue !== 'number' ||
        !Number.isInteger(sessionLengthValue) ||
        sessionLengthValue < 4 ||
        sessionLengthValue > 8
    ) {
        throw new RangeError(
            `sessionLength must be an integer in [4, 8], got ${JSON.stringify(sessionLengthValue)}`
        );
    }
    // The range check above is not a type guard: TypeScript cannot narrow
    // `number` to `4 | 5 | 6 | 7 | 8` from `< 4 || > 8`, and the object
    // literal below must satisfy `ResolvedConfig`. The cast records what the
    // runtime check has already proven.
    const sessionLength = /** @type {4 | 5 | 6 | 7 | 8} */ (sessionLengthValue);

    const checksum = raw.checksum === undefined ? 'crc16' : raw.checksum;
    if (checksum !== 'none' && checksum !== 'crc8' && checksum !== 'crc16') {
        throw new RangeError(
            `checksum must be "none", "crc8", or "crc16", got ${JSON.stringify(checksum)}`
        );
    }

    const crcLength = CHECKSUM_LENGTHS[checksum];

    const metaLength =
        sessionLength + LAYOUT.indexLength + LAYOUT.totalLength + LAYOUT.countLength + crcLength;

    return Object.freeze({
        sessionLength,
        checksum,
        crcLength,
        indexLength: LAYOUT.indexLength,
        totalLength: LAYOUT.totalLength,
        countLength: LAYOUT.countLength,
        metaLength,
        maxIndex: CAPACITY.maxIndex,
        maxTotal: CAPACITY.maxTotal,
        maxByteCount: CAPACITY.maxByteCount,
    });
}

/**
 * Default configuration. Frozen: mutating it would silently poison every
 * `resolveConfig()` call in the process.
 *
 * @public
 * @type {Readonly<import('./types.js').ResolvedConfig>}
 */
export const DEFAULT_CONFIG = Object.freeze(resolveConfig());

/**
 * Normalize a `ChunkConfig` or `ResolvedConfig` into a `ResolvedConfig`.
 *
 * A genuinely resolved object is returned as-is (no allocation). Anything
 * else — a partial config, or an object whose derived fields contradict its
 * own widths (for example `{ ...DEFAULT_CONFIG, sessionLength: 8 }`, where
 * `metaLength` is still 18) — goes through {@link resolveConfig}.
 *
 * Unknown fields are rejected **before** the consistency check, so a typo
 * cannot hide behind a resolved-looking object:
 * `{ ...DEFAULT_CONFIG, sessionLenght: 8 }` passes every width check below
 * and would otherwise silently encode with the default 6-char layout.
 *
 * This is what makes the low-level API (`parseChunk`, `formatChunk`,
 * `chunksFromLines`) safe to call with a partial config, matching the
 * high-level API.
 *
 * @internal
 * @param {import("./types.js").ChunkConfig | import("./types.js").ResolvedConfig | null | undefined} config
 * @returns {Readonly<import("./types.js").ResolvedConfig>}
 * @throws {TypeError | RangeError}
 */
export function ensureConfig(config) {
    if (config === undefined || config === null) {
        return DEFAULT_CONFIG;
    }
    if (typeof config !== 'object') {
        throw new TypeError('config must be an object');
    }

    assertKnownConfigKeys(config);

    const c = /** @type {import("./types.js").ResolvedConfig} */ (config);
    const consistent =
        Number.isInteger(c.sessionLength) &&
        c.sessionLength >= 4 &&
        c.sessionLength <= 8 &&
        (c.checksum === 'none' || c.checksum === 'crc8' || c.checksum === 'crc16') &&
        c.crcLength === CHECKSUM_LENGTHS[c.checksum] &&
        c.indexLength === LAYOUT.indexLength &&
        c.totalLength === LAYOUT.totalLength &&
        c.countLength === LAYOUT.countLength &&
        c.metaLength ===
            c.sessionLength + c.indexLength + c.totalLength + c.countLength + c.crcLength &&
        c.maxIndex === CAPACITY.maxIndex &&
        c.maxTotal === CAPACITY.maxTotal &&
        c.maxByteCount === CAPACITY.maxByteCount;

    return consistent ? c : resolveConfig(/** @type {import("./types.js").ChunkConfig} */ (config));
}

/** Derived keys that only a resolved config carries. @internal */
const RESOLVED_ONLY_KEYS = Object.freeze([
    'crcLength',
    'indexLength',
    'totalLength',
    'countLength',
    'metaLength',
    'maxIndex',
    'maxTotal',
    'maxByteCount',
]);

/**
 * Resolve the config carried by an options object.
 *
 * Two shapes are accepted, because both are documented and both were
 * previously reachable — one officially, one by the README's wording:
 *
 * - `{ config: {...} }`      — `ConfigOptions` (`analyzeLines`, `decodeText`);
 * - `{ sessionLength: 8 }`   — a bare `ChunkConfig` in the options slot.
 *
 * Before this helper, the second shape silently fell back to
 * `DEFAULT_CONFIG`: every line from an 8-char session landed in
 * `malformed` with no error. Unknown option keys now raise instead of
 * being ignored.
 *
 * @internal
 * @param {unknown} options
 * @param {readonly string[]} [extraKeys] Non-config keys the caller allows
 *                                        in `options` (for example `getLine`).
 * @returns {Readonly<import("./types.js").ResolvedConfig>}
 * @throws {TypeError | RangeError}
 */
export function ensureOptionsConfig(options, extraKeys = []) {
    if (options === undefined || options === null) {
        return DEFAULT_CONFIG;
    }
    if (typeof options !== 'object') {
        throw new TypeError('options must be an object');
    }

    const opts = /** @type {Record<string, unknown>} */ (options);

    // 1. Documented shape: { config: ChunkConfig | ResolvedConfig }.
    //    `config: undefined` means "not supplied" — it falls through to the
    //    bare-field path instead of being rejected as an unknown option.
    if (opts.config !== undefined) {
        if ('sessionLength' in opts || 'checksum' in opts) {
            throw new TypeError(
                'Pass the wire format either as "config" or as bare ' +
                    '"sessionLength"/"checksum" fields, not both'
            );
        }
        return ensureConfig(/** @type {any} */ (opts.config));
    }

    // 2. README shape: the config itself, resolved or partial. A `config`
    //    key holding `undefined` is dropped first, so `ensureConfig` does not
    //    report it as an unknown field.
    if (RESOLVED_ONLY_KEYS.some(key => key in opts)) {
        /** @type {Record<string, unknown>} */
        const rest = { ...opts };
        delete rest.config;
        return ensureConfig(/** @type {any} */ (rest));
    }

    // 3. Bare ChunkConfig fields, plus whatever the caller allows (getLine).
    for (const key of Object.keys(opts)) {
        if (
            key !== 'config' &&
            key !== 'sessionLength' &&
            key !== 'checksum' &&
            !extraKeys.includes(key)
        ) {
            throw new TypeError(`Unknown option: ${JSON.stringify(key)}`);
        }
    }

    /** @type {import("./types.js").ChunkConfig} */
    const picked = {};
    let hasField = false;

    if ('sessionLength' in opts) {
        picked.sessionLength = /** @type {any} */ (opts.sessionLength);
        hasField = true;
    }
    if ('checksum' in opts) {
        picked.checksum = /** @type {any} */ (opts.checksum);
        hasField = true;
    }

    return hasField ? resolveConfig(picked) : DEFAULT_CONFIG;
}
