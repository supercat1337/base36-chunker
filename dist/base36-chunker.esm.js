// @ts-check

/**
 * Base36 alphabet: digits followed by lowercase letters. Every string
 * produced by this package consists only of these 36 characters, so output
 * is safe for transports that restrict payloads to `[0-9a-z]` and for
 * case-insensitive channels.
 * @public
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Lowercase letters only: `a-z`. Used as the first-character source for
 * session ids, so that encoded lines never begin with a digit.
 * @public
 */
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** Radix used by all base36 conversions. @internal */
const RADIX = 36n;

/** log2(36) — converts base36 character capacity into byte capacity. @internal */
const LOG2_BASE36 = Math.log2(36);

/**
 * Reverse lookup: ASCII code -> base36 digit, or -1 for invalid bytes.
 * Built once at module load.
 * @internal
 * @type {Int8Array}
 */
const CHAR_VALUE = (() => {
    const table = new Int8Array(128).fill(-1);
    for (let i = 0; i < ALPHABET.length; i += 1) {
        table[ALPHABET.charCodeAt(i)] = i;
    }
    return table;
})();

/**
 * Encode a non-negative integer into a fixed-width base36 string.
 * Zero-padded on the left. `encodeNumber(0, 0)` returns `''`.
 *
 * @internal
 * @param {number} value  Non-negative safe integer.
 * @param {number} width  Exact output length in characters.
 * @returns {string}
 * @throws {RangeError} If `value` or `width` are not non-negative integers,
 *                      or `value` does not fit into `width` base36 digits.
 */
function encodeNumber(value, width) {
    if (!Number.isInteger(value) || value < 0) {
        throw new RangeError(`Expected non-negative integer, got ${value}`);
    }
    if (!Number.isInteger(width) || width < 0) {
        throw new RangeError(`Width must be a non-negative integer, got ${width}`);
    }
    if (width === 0) {
        if (value !== 0) {
            throw new RangeError(`Value ${value} does not fit into 0 base36 characters`);
        }
        return '';
    }

    let acc = value;
    const chars = new Array(width);
    for (let i = width - 1; i >= 0; i -= 1) {
        chars[i] = ALPHABET[acc % 36];
        acc = Math.floor(acc / 36);
    }
    if (acc > 0) {
        throw new RangeError(`Value ${value} does not fit into ${width} base36 characters`);
    }
    return chars.join('');
}

/**
 * Decode a base36 string into a non-negative integer. An empty string
 * decodes to `0`.
 *
 * @internal
 * @param {string} str
 * @returns {number}
 * @throws {Error} If `str` contains characters outside the base36 alphabet.
 */
function decodeNumber(str) {
    let acc = 0;
    for (let i = 0; i < str.length; i += 1) {
        const code = str.charCodeAt(i);
        const value = code < 128 ? CHAR_VALUE[code] : -1;
        if (value < 0) {
            throw new Error(`Invalid base36 character: ${JSON.stringify(str[i])}`);
        }
        acc = acc * 36 + value;
    }
    return acc;
}

/**
 * Encode a byte array as a base36 string using a big-endian bigint.
 *
 * Leading zero bytes are *not* preserved — the caller must know the original
 * byte count and restore the zeros after decoding. An empty array encodes
 * to an empty string.
 *
 * @internal
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase36(bytes) {
    if (bytes.length === 0) {
        return '';
    }
    let acc = 0n;
    for (let i = 0; i < bytes.length; i += 1) {
        acc = (acc << 8n) | BigInt(bytes[i]);
    }
    let out = '';
    while (acc > 0n) {
        out = ALPHABET[Number(acc % RADIX)] + out;
        acc /= RADIX;
    }
    return out;
}

/**
 * Decode a base36 string into exactly `expectedLength` bytes.
 *
 * Leading zero bytes dropped during encoding are restored automatically.
 *
 * @internal
 * @param {string} str
 * @param {number} expectedLength  Number of bytes to restore.
 * @returns {Uint8Array}
 * @throws {RangeError} If `expectedLength` is not a non-negative integer.
 * @throws {Error} On invalid characters or byte-count mismatch.
 */
function base36ToBytes(str, expectedLength) {
    if (!Number.isInteger(expectedLength) || expectedLength < 0) {
        throw new RangeError(
            `expectedLength must be a non-negative integer, got ${expectedLength}`
        );
    }

    let acc = 0n;
    for (let i = 0; i < str.length; i += 1) {
        const code = str.charCodeAt(i);
        const value = code < 128 ? CHAR_VALUE[code] : -1;
        if (value < 0) {
            throw new Error(`Invalid base36 character: ${JSON.stringify(str[i])}`);
        }
        acc = acc * RADIX + BigInt(value);
    }
    /** @type {number[]} */
    const bytes = [];
    while (acc > 0n) {
        bytes.unshift(Number(acc & 0xffn));
        acc >>= 8n;
    }
    while (bytes.length < expectedLength) {
        bytes.unshift(0);
    }
    if (bytes.length !== expectedLength) {
        throw new Error(`Byte count mismatch: expected ${expectedLength}, got ${bytes.length}`);
    }
    return Uint8Array.from(bytes);
}

/**
 * Draw `count` uniformly random characters from `alphabet`.
 *
 * Uses `crypto.getRandomValues` with rejection sampling: bytes at or above
 * `floor(256 / n) * n` are discarded, so every character is drawn with
 * probability `1 / n` (no modulo bias).
 *
 * Exported for tests only — not part of the public API.
 *
 * @internal
 * @param {string} alphabet
 * @param {number} count
 * @returns {string[]}
 * @throws {RangeError} If `alphabet` is empty or `count` is not a
 *                      non-negative integer.
 * @throws {Error} If `globalThis.crypto.getRandomValues` is unavailable.
 */
function randomChars(alphabet, count) {
    const n = alphabet.length;
    if (n === 0) {
        throw new RangeError('alphabet must not be empty');
    }
    if (!Number.isInteger(count) || count < 0) {
        throw new RangeError(`count must be a non-negative integer, got ${count}`);
    }
    if (count === 0) {
        return [];
    }

    const crypto = globalThis.crypto;
    if (!crypto || typeof crypto.getRandomValues !== 'function') {
        throw new Error(
            'globalThis.crypto.getRandomValues is not available (Node.js >= 19 required)'
        );
    }

    const limit = Math.floor(256 / n) * n;
    /** @type {string[]} */
    const out = [];
    const batch = new Uint8Array(Math.max(16, count * 2));
    while (out.length < count) {
        crypto.getRandomValues(batch);
        for (let i = 0; i < batch.length && out.length < count; i += 1) {
            if (batch[i] < limit) {
                out.push(alphabet[batch[i] % n]);
            }
        }
    }
    return out;
}

/**
 * Generate a cryptographically random string of `length` characters.
 *
 * Without a `firstCharAlphabet` argument, every character comes from the
 * base36 alphabet. When `firstCharAlphabet` is provided, the first
 * character is drawn from it instead — this is used to make session ids
 * start with a lowercase letter, so encoded lines never begin with a digit.
 *
 * @internal
 * @param {number} length
 * @param {string} [firstCharAlphabet]
 * @returns {string}
 * @throws {RangeError} If `length` is not a non-negative integer.
 */
function randomBase36(length, firstCharAlphabet = ALPHABET) {
    if (!Number.isInteger(length) || length < 0) {
        throw new RangeError(`length must be a non-negative integer, got ${length}`);
    }
    if (length === 0) {
        return '';
    }
    const first = randomChars(firstCharAlphabet, 1)[0];
    return first + randomChars(ALPHABET, length - 1).join('');
}

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
const CHECKSUM_LENGTHS = Object.freeze({
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
function resolveConfig(partial = {}) {
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
const DEFAULT_CONFIG = Object.freeze(resolveConfig());

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
function ensureConfig(config) {
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
function ensureOptionsConfig(options, extraKeys = []) {
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

// @ts-check

/**
 * CRC16-CCITT (poly 0x1021, init 0xFFFF). Standard for short messages —
 * detects all single/double-bit errors, all odd-bit errors, and bursts up
 * to 16 bits.
 * @internal
 */
const CRC16_TABLE = (() => {
    const table = new Uint16Array(256);
    for (let i = 0; i < 256; i += 1) {
        let crc = i << 8;
        for (let j = 0; j < 8; j += 1) {
            crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
        }
        table[i] = crc & 0xffff;
    }
    return table;
})();

/**
 * CRC-8/MAXIM-DOW table (reflected).
 *
 * Parameters: poly=0x31, init=0x00, refin=true, refout=true, xorout=0x00.
 * The reflected polynomial is 0x8C (0x31 with bits reversed), so the LFSR
 * shifts right and XORs with 0x8C on the low bit. `check` for
 * "123456789" is 0xA1.
 *
 * @internal
 */
const CRC8_TABLE = (() => {
    const table = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) {
        let crc = i;
        for (let j = 0; j < 8; j += 1) {
            crc = crc & 1 ? (crc >>> 1) ^ 0x8c : crc >>> 1;
        }
        table[i] = crc;
    }
    return table;
})();

/**
 * Compute CRC16-CCITT of `bytes`.
 * @internal
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function crc16(bytes) {
    let crc = 0xffff;
    for (let i = 0; i < bytes.length; i += 1) {
        crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ bytes[i]) & 0xff]) & 0xffff;
    }
    return crc;
}

/**
 * Compute CRC-8/MAXIM-DOW of `bytes`.
 * @internal
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function crc8(bytes) {
    let crc = 0;
    for (let i = 0; i < bytes.length; i += 1) {
        crc = CRC8_TABLE[crc ^ bytes[i]];
    }
    return crc;
}

/**
 * Dispatch by algorithm name.
 * @internal
 * @param {Uint8Array} bytes
 * @param {"crc8" | "crc16"} algorithm
 * @returns {number}
 */
function computeChecksum(bytes, algorithm) {
    if (algorithm === 'crc16') {return crc16(bytes);}
    if (algorithm === 'crc8') {return crc8(bytes);}
    throw new Error(`Unknown checksum algorithm: ${algorithm}`);
}

// @ts-check


/**
 * A session id must start with a lowercase letter and consist only of
 * base36 characters. Applied to the session prefix extracted from a line.
 * @internal
 */
const SESSION_PREFIX_RE = /^[a-z][0-9a-z]*$/;

/**
 * A base36 string must start with a lowercase letter (used for the first
 * character of a line). @internal
 */
const FIRST_CHAR_RE = /^[a-z]/;

/**
 * A base36 string must contain only `[0-9a-z]` characters.
 * @internal
 */
const BASE36_RE = /^[0-9a-z]+$/;

/**
 * Widest payload a valid chunk can produce, in base36 characters.
 *
 * At the default layout: `ceil(1295 * 8 / log2 36) = 2004`. Every payload
 * is a big-endian integer below `2^10360`, so no canonical line can be
 * longer than `metaLength + 2004`.
 *
 * @internal
 * @param {import("./types.js").ResolvedConfig} config
 * @returns {number}
 */
function maxPayloadChars(config) {
    return Math.ceil((config.maxByteCount * 8) / LOG2_BASE36);
}

/**
 * Validate a session id against the resolved config.
 *
 * A valid session id must be exactly `config.sessionLength` base36
 * characters long and start with a lowercase letter — this guarantees that
 * the encoded line never begins with a digit.
 *
 * @internal
 * @param {string} sessionId
 * @param {import("./types.js").ChunkConfig | import("./types.js").ResolvedConfig} [config]
 * @returns {void}
 * @throws {RangeError} If the length, the alphabet, or the first character
 *                      are wrong.
 */
function validateSessionId(sessionId, config) {
    const cfg = ensureConfig(config);
    if (typeof sessionId !== 'string' || sessionId.length !== cfg.sessionLength) {
        throw new RangeError(`sessionId must be a ${cfg.sessionLength}-character string`);
    }
    if (!BASE36_RE.test(sessionId)) {
        throw new RangeError('sessionId must contain only base36 characters');
    }
    if (!FIRST_CHAR_RE.test(sessionId)) {
        throw new RangeError('sessionId must start with a lowercase letter (a-z)');
    }
}

/**
 * Parse only the metadata header of a line.
 *
 * The length ceiling is checked before any character is decoded: an
 * oversized input line is rejected in O(1) instead of dragging the bigint
 * payload decoder through a quadratic loop.
 *
 * @internal
 * @internal
 * @param {string} line
 * @param {import("./types.js").ChunkConfig | import("./types.js").ResolvedConfig} [config]
 * @returns {import('./types.js').ChunkHeader}
 */
function parseHeader(line, config) {
    const cfg = ensureConfig(config);

    if (typeof line !== 'string') {
        throw new TypeError('line must be a string');
    }
    if (line.length < cfg.metaLength) {
        throw new Error(`Line is shorter than the metadata header (${cfg.metaLength})`);
    }

    const maxLen = cfg.metaLength + maxPayloadChars(cfg);
    if (line.length > maxLen) {
        throw new Error(
            `Line is too long (${line.length} chars); a valid chunk is at most ${maxLen} chars ` +
                `(${cfg.maxByteCount} payload bytes)`
        );
    }
    if (!BASE36_RE.test(line)) {
        throw new Error('Line contains non-base36 characters');
    }
    if (!FIRST_CHAR_RE.test(line)) {
        throw new Error('Line must start with a lowercase letter (a-z)');
    }

    let pos = 0;
    const session = line.slice(pos, (pos += cfg.sessionLength));
    const index = decodeNumber(line.slice(pos, (pos += cfg.indexLength)));
    const total = decodeNumber(line.slice(pos, (pos += cfg.totalLength)));
    const byteCount = decodeNumber(line.slice(pos, (pos += cfg.countLength)));
    const checksumValue =
        cfg.crcLength > 0 ? decodeNumber(line.slice(pos, (pos += cfg.crcLength))) : 0;

    if (total < 1) {
        throw new Error(`Invalid total (${total}); must be >= 1`);
    }
    if (index >= total) {
        throw new Error(`Chunk index (${index}) is out of range [0, ${total})`);
    }

    return { session, index, total, byteCount, checksumValue };
}

/**
 * Parse one encoded line into a chunk. Validates the payload encoding and,
 * when configured, the checksum.
 *
 * Two independent guards apply to the payload:
 *
 * 1. **Canonical form.** `bytesToBase36` drops leading zero bytes, so a
 *    canonical payload is the shortest base36 form of its value. Accepting
 *    `'000a'` and `'a'` as the same chunk would break deduplication,
 *    idempotent re-sends, and any signature computed over the line.
 * 2. **Checksum.** `crc8`/`crc16` cover the payload bytes — and only them.
 *    `index`, `total`, and `count` are protected structurally (they must be
 *    self-consistent) but not by the CRC.
 *
 * @public
 * @param {string} line
 * @param {import("./types.js").ChunkConfig | import("./types.js").ResolvedConfig} [config]
 * @returns {import("./types.js").Chunk}
 * @throws {TypeError | Error}
 */
function parseChunk(line, config) {
    const cfg = ensureConfig(config);
    const { session, index, total, byteCount, checksumValue } = parseHeader(line, cfg);

    const payload = line.slice(cfg.metaLength);
    const bytes = base36ToBytes(payload, byteCount);

    if (bytesToBase36(bytes) !== payload) {
        throw new Error(
            `Non-canonical payload: ${JSON.stringify(payload)} is not the shortest base36 ` +
                `encoding of ${byteCount} byte(s)`
        );
    }

    if (cfg.checksum !== 'none') {
        const actual = computeChecksum(bytes, cfg.checksum);
        if (actual !== checksumValue) {
            throw new Error(`Checksum mismatch: expected ${checksumValue}, got ${actual}`);
        }
    }

    return { session, index, total, bytes };
}

/**
 * Serialize a chunk into a single base36 line, appending the checksum
 * required by `config.checksum`.
 *
 * @public
 * @param {import("./types.js").Chunk} chunk
 * @param {import("./types.js").ChunkConfig | import("./types.js").ResolvedConfig} [config]
 * @returns {string}
 * @throws {TypeError | RangeError}
 */
function formatChunk(chunk, config) {
    const cfg = ensureConfig(config);

    if (!chunk || typeof chunk !== 'object') {
        throw new TypeError('chunk must be an object');
    }
    const { session, index, total, bytes } = chunk;
    if (!(bytes instanceof Uint8Array)) {
        throw new TypeError('chunk.bytes must be a Uint8Array');
    }
    validateSessionId(session, cfg);

    if (!Number.isInteger(index) || index < 0 || index > cfg.maxIndex) {
        throw new RangeError(`index must be in [0, ${cfg.maxIndex}], got ${index}`);
    }
    if (!Number.isInteger(total) || total < 1 || total > cfg.maxTotal) {
        throw new RangeError(`total must be in [1, ${cfg.maxTotal}], got ${total}`);
    }
    if (index >= total) {
        throw new RangeError(`index (${index}) must be less than total (${total})`);
    }
    if (bytes.length > cfg.maxByteCount) {
        throw new RangeError(
            `bytes.length (${bytes.length}) exceeds the ${cfg.maxByteCount}-byte limit`
        );
    }

    const checksumValue = cfg.checksum !== 'none' ? computeChecksum(bytes, cfg.checksum) : 0;

    const header =
        session +
        encodeNumber(index, cfg.indexLength) +
        encodeNumber(total, cfg.totalLength) +
        encodeNumber(bytes.length, cfg.countLength) +
        (cfg.crcLength > 0 ? encodeNumber(checksumValue, cfg.crcLength) : '');

    return header + bytesToBase36(bytes);
}

// @ts-check


/**
 * Shared decoder. `fatal: true` makes invalid UTF-8 throw instead of
 * silently producing U+FFFD, so `joinChunks` never returns a corrupted
 * string.
 * @internal
 */
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Validate that `chunks` form one complete session and return them sorted
 * by index. Shared by {@link joinBytes} and {@link joinChunks} so the
 * session rules live in exactly one place.
 *
 * Both structure and format are checked here: `session` must look like a
 * session id (`a-z` followed by base36), not merely be equal across chunks.
 * The expected *length* depends on the config, which `joinBytes` /
 * `joinChunks` do not take — so this check is config-independent.
 *
 * @internal
 * @param {import("./types.js").Chunk[]} chunks
 * @returns {import("./types.js").Chunk[]} Sorted copy.
 * @throws {TypeError} If the input is not a non-empty array of chunks.
 * @throws {Error} If the chunks do not form one complete session.
 */
function validateChunks(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
        throw new TypeError(
            'Expected a non-empty array of chunks: an empty payload is one zero-byte ' +
                'chunk, so zero chunks never represent a valid session'
        );
    }

    for (let i = 0; i < chunks.length; i += 1) {
        const c = chunks[i];
        if (!c || typeof c !== 'object') {
            throw new TypeError(`Chunk ${i} is not an object`);
        }
        if (!(c.bytes instanceof Uint8Array)) {
            throw new TypeError(`Chunk ${i}.bytes is not a Uint8Array`);
        }
        if (typeof c.session !== 'string' || !SESSION_PREFIX_RE.test(c.session)) {
            throw new TypeError(
                `Chunk ${i}.session is not a valid base36 session id ` +
                    '(a-z followed by [0-9a-z])'
            );
        }
        if (!Number.isInteger(c.index) || c.index < 0) {
            throw new TypeError(`Chunk ${i}.index must be a non-negative integer`);
        }
        if (!Number.isInteger(c.total) || c.total < 1) {
            throw new TypeError(`Chunk ${i}.total must be a positive integer`);
        }
    }

    const { session, total } = chunks[0];
    for (let i = 0; i < chunks.length; i += 1) {
        const c = chunks[i];
        if (c.session !== session) {
            throw new Error(`Session id mismatch at chunk ${i}`);
        }
        if (c.total !== total) {
            throw new Error(`Total chunks mismatch at chunk ${i}`);
        }
    }
    if (chunks.length !== total) {
        throw new Error(`Expected ${total} chunks, received ${chunks.length}`);
    }

    const sorted = [...chunks].sort((a, b) => a.index - b.index);

    /** @type {Set<number>} */
    const seen = new Set();
    for (const c of sorted) {
        if (seen.has(c.index)) {
            throw new Error(`Duplicate chunk index ${c.index}`);
        }
        seen.add(c.index);
    }
    for (let i = 0; i < sorted.length; i += 1) {
        if (sorted[i].index !== i) {
            throw new Error(`Missing chunk with index ${i}`);
        }
    }

    return sorted;
}

/**
 * Concatenate the payload bytes of a complete session.
 *
 * Performs the same session validation as {@link joinChunks} but returns
 * raw bytes — no UTF-8 decoding, so arbitrary binary payloads (ciphertext,
 * compressed blobs, protobuf, images) survive intact.
 *
 * @public
 * @param {import("./types.js").Chunk[]} chunks
 * @returns {Uint8Array}
 * @throws {TypeError} If the input is not a non-empty array of chunks.
 * @throws {Error} If the chunks do not form one complete session.
 */
function joinBytes(chunks) {
    const sorted = validateChunks(chunks);

    let totalLen = 0;
    for (const c of sorted) {
        totalLen += c.bytes.length;
    }

    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of sorted) {
        out.set(c.bytes, offset);
        offset += c.bytes.length;
    }
    return out;
}

/**
 * Reassemble the original text from an unordered array of chunks.
 *
 * Validates the session exactly like {@link joinBytes}, then decodes the
 * concatenated bytes as **strict** UTF-8: invalid bytes throw instead of
 * silently producing U+FFFD. For binary payloads use {@link joinBytes}.
 *
 * @public
 * @param {import("./types.js").Chunk[]} chunks
 * @returns {string}
 * @throws {TypeError} If the input is not a non-empty array of chunks, or
 *                     the concatenated bytes are not valid UTF-8.
 * @throws {Error} If the chunks do not form one complete session.
 */
function joinChunks(chunks) {
    return UTF8_DECODER.decode(joinBytes(chunks));
}

/**
 * Parse lines into chunks. Throws on the first malformed line.
 *
 * An empty array is **not** a valid encoding: `splitText('')` yields one
 * zero-byte chunk, so zero lines mean "nothing arrived", not "empty text".
 *
 * @public
 * @param {string[]} lines
 * @param {import("./types.js").ChunkConfig | import("./types.js").ResolvedConfig} [config]
 * @returns {import("./types.js").Chunk[]}
 * @throws {TypeError} If `lines` is not a non-empty array.
 */
function chunksFromLines(lines, config) {
    if (!Array.isArray(lines)) {
        throw new TypeError('Expected an array of lines');
    }
    if (lines.length === 0) {
        throw new TypeError(
            'Expected a non-empty array of lines: an empty payload encodes to one ' +
                'zero-byte chunk, so zero lines never represent a valid encoding'
        );
    }
    const cfg = ensureConfig(config);
    return lines.map(line => parseChunk(line, cfg));
}

/**
 * Decode encoded lines back to the original text.
 *
 * @public
 * @param {string[]} lines
 * @param {import("./types.js").ConfigOptions} [options]
 *        Either `{ config: {...} }` or a config passed directly.
 * @returns {string}
 * @throws {TypeError | RangeError} On argument or config errors.
 */
function decodeText(lines, options) {
    return joinChunks(chunksFromLines(lines, ensureOptionsConfig(options)));
}

// @ts-check


/** Keys `EncodeOptions` understands. Anything else is a typo. @internal */
const ENCODE_OPTION_KEYS = Object.freeze(['config', 'maxLen', 'bytesPerChunk', 'sessionId']);

/**
 * Reject malformed or misspelled `EncodeOptions`.
 *
 * A typo such as `{ maxlen: 40 }` must not silently fall back to `63`: the
 * line length is part of the contract with the transport.
 *
 * @internal
 * @param {unknown} options
 * @returns {import("./types.js").EncodeOptions}
 * @throws {TypeError} If `options` is not an object or has an unknown key.
 */
function encodeOptions(options) {
    if (options === undefined || options === null) {
        return {};
    }
    if (typeof options !== 'object') {
        throw new TypeError('options must be an object');
    }
    const opts = /** @type {Record<string, unknown>} */ (options);
    for (const key of Object.keys(opts)) {
        if (!ENCODE_OPTION_KEYS.includes(key)) {
            throw new TypeError(
                `Unknown option: ${JSON.stringify(key)} ` +
                    '(expected "maxLen", "bytesPerChunk", "sessionId" and/or "config")'
            );
        }
    }
    return /** @type {import("./types.js").EncodeOptions} */ (opts);
}

/**
 * Generate a fresh base36 session id of `config.sessionLength` characters.
 *
 * The first character is always a lowercase letter (`a-z`), so encoded
 * lines never start with a digit. Every remaining character is drawn from
 * the full base36 alphabet.
 *
 * @public
 * @param {import("./types.js").ChunkConfig | import("./types.js").ResolvedConfig} [config]
 * @returns {string}
 * @throws {RangeError} If `config` fields are out of range.
 */
function generateSessionId(config) {
    const cfg = ensureConfig(config);
    return randomBase36(cfg.sessionLength, LETTERS);
}

/**
 * Validate or generate the session id for a payload.
 *
 * @internal
 * @param {string | undefined} sessionId
 * @param {import("./types.js").ResolvedConfig} config
 * @returns {string}
 * @throws {RangeError} If `sessionId` is supplied but does not match
 *                      `config.sessionLength` or the base36 alphabet.
 */
function resolveSessionId(sessionId, config) {
    if (sessionId === undefined) {
        return generateSessionId(config);
    }
    validateSessionId(sessionId, config);
    return sessionId;
}

/**
 * Resolve the chunk size in bytes.
 *
 * `bytesPerChunk` takes precedence over `maxLen`. When it is used, the
 * resulting line length is **not** bounded by `maxLen` — the caller is
 * responsible for keeping `bytesPerChunk` small enough for their transport.
 *
 * @internal
 * @param {import("./types.js").EncodeOptions} options
 * @param {import("./types.js").ResolvedConfig} config
 * @returns {number}
 * @throws {RangeError} If `maxLen`/`bytesPerChunk` are out of range.
 */
function resolveBytesPerChunk({ maxLen = 63, bytesPerChunk } = {}, config) {
    if (bytesPerChunk !== undefined) {
        if (!Number.isInteger(bytesPerChunk) || bytesPerChunk < 1) {
            throw new RangeError('bytesPerChunk must be a positive integer');
        }
        if (bytesPerChunk > config.maxByteCount) {
            throw new RangeError(
                `bytesPerChunk (${bytesPerChunk}) exceeds the ${config.maxByteCount}-byte limit`
            );
        }
        return bytesPerChunk;
    }
    if (!Number.isInteger(maxLen)) {
        throw new RangeError(`maxLen must be an integer, got ${JSON.stringify(maxLen)}`);
    }
    if (maxLen <= config.metaLength) {
        throw new RangeError(
            `maxLen (${maxLen}) must be greater than metaLength (${config.metaLength})`
        );
    }
    const payloadChars = maxLen - config.metaLength;
    const n = Math.floor((payloadChars * LOG2_BASE36) / 8);
    if (n < 1) {
        throw new RangeError(`maxLen (${maxLen}) is too small for any payload`);
    }
    if (n > config.maxByteCount) {
        throw new RangeError(
            `maxLen (${maxLen}) is too large: ${n} bytes/chunk exceeds ${config.maxByteCount}`
        );
    }
    return n;
}

/**
 * Length in bytes of the UTF-8 character whose lead byte is `lead`.
 *
 * Exported for tests only — not part of the public API.
 *
 * @internal
 * @param {number} lead
 * @returns {1 | 2 | 3 | 4}
 */
function utf8CharLength(lead) {
    if (lead < 0x80) {
        return 1;
    }
    if ((lead & 0xe0) === 0xc0) {
        return 2;
    }
    if ((lead & 0xf0) === 0xe0) {
        return 3;
    }
    if ((lead & 0xf8) === 0xf0) {
        return 4;
    }
    return 1; // invalid lead byte; treat as a single byte
}

/**
 * Reject unpaired surrogates.
 *
 * `TextEncoder` replaces them with U+FFFD and says nothing. That contradicts
 * the package's promise — `decodeText(encodeText(text)) === text` — so the
 * encoder refuses such input instead of quietly losing it.
 *
 * @internal
 * @param {string} text
 * @returns {void}
 * @throws {TypeError} If `text` contains an unpaired surrogate.
 */
function assertWellFormed(text) {
    for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        if (code < 0xd800 || code > 0xdfff) {
            continue;
        }
        if (code <= 0xdbff) {
            const next = text.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                i += 1; // proper surrogate pair
                continue;
            }
        }
        const escaped = `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
        throw new TypeError(
            `text contains an unpaired surrogate at index ${i} (${escaped}); ` +
                'it cannot be encoded losslessly as UTF-8'
        );
    }
}

/**
 * Split UTF-8 bytes into chunks that never break a character.
 *
 * A chunk boundary is only allowed at a byte that is **not** a UTF-8
 * continuation byte (`0b10xxxxxx`), so every chunk's bytes decode to valid
 * UTF-8 on their own. `bytesPerChunk` is a hard upper bound: if a single
 * character does not fit, a `RangeError` is thrown.
 *
 * The last chunk may be shorter than `bytesPerChunk`; chunks in the middle
 * may be shorter too, when the boundary would have split a character.
 *
 * @internal
 * @param {Uint8Array} bytes
 * @param {number} bytesPerChunk
 * @param {number} maxChunks
 * @returns {Uint8Array[]}
 * @throws {RangeError} If a character does not fit into `bytesPerChunk`
 *                      bytes, or the text needs more than `maxChunks` chunks.
 */
function splitUtf8Safe(bytes, bytesPerChunk, maxChunks) {
    if (bytes.length === 0) {
        return [new Uint8Array(0)];
    }

    /** @type {Uint8Array[]} */
    const out = [];
    let start = 0;

    while (start < bytes.length) {
        let end = Math.min(start + bytesPerChunk, bytes.length);

        // Back off to a character boundary: `bytes[end]` must not be a
        // continuation byte, unless we are at the very end.
        while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
            end -= 1;
        }

        if (end === start) {
            const charLen = utf8CharLength(bytes[start]);
            throw new RangeError(
                `bytesPerChunk (${bytesPerChunk}) is too small for a ${charLen}-byte ` +
                    `UTF-8 character at byte ${start}; use at least ${charLen}`
            );
        }

        out.push(bytes.slice(start, end));
        if (out.length > maxChunks) {
            throw new RangeError(
                `Text too large: ${out.length} chunks exceed the ${maxChunks} limit`
            );
        }
        start = end;
    }

    return out;
}

/**
 * Split plain text into an array of chunk structures.
 *
 * Chunks never break a UTF-8 character: each chunk's `bytes` decodes to
 * valid UTF-8 on its own, so a partial session can be displayed without
 * replacement characters.
 *
 * @public
 * @param {string} text
 * @param {import("./types.js").EncodeOptions} [options]
 * @returns {import("./types.js").Chunk[]}
 * @throws {TypeError} If `text` is not a string, contains an unpaired
 *                     surrogate, or `options` has an unknown key.
 * @throws {RangeError} If `maxLen`/`bytesPerChunk` are out of range or a
 *                      character does not fit.
 */
function splitText(text, options) {
    if (typeof text !== 'string') {
        throw new TypeError('text must be a string');
    }
    const opts = encodeOptions(options);
    const config = ensureConfig(opts.config);
    const bytesPerChunk = resolveBytesPerChunk(opts, config);
    const session = resolveSessionId(opts.sessionId, config);

    assertWellFormed(text);

    const allBytes = new TextEncoder().encode(text);
    const parts = splitUtf8Safe(allBytes, bytesPerChunk, config.maxTotal);

    return parts.map((bytes, index) => ({
        session,
        index,
        total: parts.length,
        bytes,
    }));
}

/**
 * Split text into an array of base36-only lines.
 * Convenience wrapper around `splitText(...).map(c => formatChunk(c, config))`.
 *
 * @public
 * @param {string} text
 * @param {import("./types.js").EncodeOptions} [options]
 * @returns {string[]}
 * @throws {TypeError | RangeError}
 */
function encodeText(text, options) {
    const opts = encodeOptions(options);
    const config = ensureConfig(opts.config);
    return splitText(text, { ...opts, config }).map(c => formatChunk(c, config));
}

// @ts-check


/**
 * Human-readable message for an arbitrary thrown value.
 *
 * `parseChunk` only throws `Error` instances, but a user-supplied
 * `getLine` may throw anything — including strings and numbers.
 *
 * @internal
 * @param {unknown} err
 * @returns {string}
 */
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Deterministic, locale-independent comparator for base36 session ids.
 *
 * `localeCompare` is locale-dependent and slower; session ids are pure
 * ASCII (`[0-9a-z]`), so a plain code-unit comparison is correct.
 *
 * @internal
 * @param {string} a
 * @param {string} b
 * @returns {number} `-1`, `0`, or `1`.
 */
function compareSessionIds(a, b) {
    if (a < b) {
        return -1;
    }
    if (a > b) {
        return 1;
    }
    return 0;
}

/**
 * Most-frequent value in `values`. Returns `null` for empty input or a tied
 * vote.
 * @internal
 * @param {number[]} values
 * @returns {number | null}
 */
function mode(values) {
    if (values.length === 0) {
        return null;
    }
    /** @type {Map<number, number>} */
    const counts = new Map();
    for (const v of values) {
        counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let bestCount = 0;
    /** @type {number | null} */
    let best = null;
    let tie = false;
    for (const [value, count] of counts) {
        if (count > bestCount) {
            bestCount = count;
            best = value;
            tie = false;
        } else if (count === bestCount) {
            tie = true;
        }
    }
    return tie ? null : best;
}

/**
 * Compute the per-session summary shared by `analyzeLines` and
 * `analyzeItems`. Keeping one implementation is what guarantees that
 * `items[j]` stays parallel to `chunks[j]`.
 *
 * Generic over the error type: `analyzeLines` passes `ChunkIssue[]`,
 * `analyzeItems` passes `ItemizedChunkIssue<T>[]` — both extend
 * `ChunkIssue`, so the body is identical.
 *
 * @internal
 * @template T
 * @template {import('./types.js').ChunkIssue} E
 * @param {{ chunk: import('./types.js').Chunk, item: T }[]} entries
 * @param {E[]} errors
 * @returns {import('./types.js').SessionSummary<T, E>}
 */
function summarize(entries, errors) {
    const chunks = entries.map(e => e.chunk);
    const expectedTotal = mode(chunks.map(c => c.total));

    /** @type {Map<number, number>} */
    const indexCount = new Map();
    for (const c of chunks) {
        indexCount.set(c.index, (indexCount.get(c.index) ?? 0) + 1);
    }

    const present = [...indexCount.keys()].sort((a, b) => a - b);
    const duplicates = [...indexCount.entries()]
        .filter(([, count]) => count > 1)
        .map(([idx]) => idx)
        .sort((a, b) => a - b);

    /** @type {number[]} */
    const missing = [];
    if (expectedTotal !== null) {
        for (let idx = 0; idx < expectedTotal; idx += 1) {
            if (!indexCount.has(idx)) {
                missing.push(idx);
            }
        }
    }

    const totalMismatch = expectedTotal === null || chunks.some(c => c.total !== expectedTotal);

    const complete =
        errors.length === 0 &&
        !totalMismatch &&
        missing.length === 0 &&
        duplicates.length === 0 &&
        chunks.length === expectedTotal;

    // Sort entries once — `chunks` and `items` come out in lockstep.
    const sorted = [...entries].sort((a, b) => a.chunk.index - b.chunk.index);

    return {
        complete,
        expectedTotal,
        totalMismatch,
        chunks: sorted.map(e => e.chunk),
        items: sorted.map(e => e.item),
        present,
        missing,
        duplicates,
        errors: [...errors].sort((a, b) => a.line - b.line),
    };
}

/**
 * Analyze an array of encoded lines, grouping by session and reporting
 * completeness per session.
 *
 * Never throws on malformed input: bad lines, missing chunks, duplicates,
 * total mismatches, and checksum failures are surfaced in the returned
 * report. Only a non-array `lines` argument — or an invalid `options` /
 * `config` — raises.
 *
 * @public
 * @param {string[]} lines
 * @param {import("./types.js").ConfigOptions} [options]
 *        Either `{ config: {...} }`, or a config passed directly. Both forms
 *        resolve to the same wire format; an unknown option key is a
 *        `TypeError` rather than a silent fallback to the defaults.
 * @returns {import("./types.js").AnalysisResult}
 * @throws {TypeError} If `lines` is not an array, `options` is not an object,
 *                     or an option/config field is unknown.
 * @throws {RangeError} If `config` fields are out of range.
 */
function analyzeLines(lines, options) {
    if (!Array.isArray(lines)) {
        throw new TypeError('Expected an array of lines');
    }
    const config = ensureOptionsConfig(options);

    /** @type {import("./types.js").ChunkIssue[]} */
    const malformed = [];
    /** @type {Map<string, import('./types.js').Bucket>} */
    const buckets = new Map();

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];

        if (typeof line !== 'string' || line.length < config.sessionLength) {
            malformed.push({ line: i, reason: 'line is too short or not a string' });
            continue;
        }

        const sessionId = line.slice(0, config.sessionLength);
        if (!SESSION_PREFIX_RE.test(sessionId)) {
            malformed.push({ line: i, reason: 'invalid session prefix' });
            continue;
        }

        let bucket = buckets.get(sessionId);
        if (!bucket) {
            bucket = { sessionId, chunks: [], errors: [] };
            buckets.set(sessionId, bucket);
        }

        try {
            bucket.chunks.push(parseChunk(line, config));
        } catch (err) {
            bucket.errors.push({ line: i, reason: errorMessage(err) });
        }
    }

    /** @type {import("./types.js").SessionAnalysis[]} */
    const sessions = [];

    for (const bucket of buckets.values()) {
        const entries = bucket.chunks.map(chunk => ({ chunk, item: undefined }));
        const s = summarize(entries, bucket.errors);
        sessions.push({
            sessionId: bucket.sessionId,
            complete: s.complete,
            expectedTotal: s.expectedTotal,
            totalMismatch: s.totalMismatch,
            chunks: s.chunks,
            present: s.present,
            missing: s.missing,
            duplicates: s.duplicates,
            errors: s.errors,
        });
    }

    sessions.sort((a, b) => compareSessionIds(a.sessionId, b.sessionId));
    malformed.sort((a, b) => a.line - b.line);

    const ok = malformed.length === 0 && sessions.every(s => s.complete);
    return { ok, sessions, malformed };
}

/**
 * Filter the report down to complete sessions.
 *
 * @public
 * @param {import("./types.js").AnalysisResult} report
 * @returns {import("./types.js").SessionAnalysis[]}
 */
function completeSessions(report) {
    return report.sessions.filter(s => s.complete);
}

/**
 * Filter the report down to incomplete sessions.
 *
 * @public
 * @param {import("./types.js").AnalysisResult} report
 * @returns {import("./types.js").SessionAnalysis[]}
 */
function incompleteSessions(report) {
    return report.sessions.filter(s => !s.complete);
}

/**
 * Analyze an array of arbitrary items by extracting base36 lines from them
 * and grouping by session id — exactly like {@link analyzeLines}, but keeps
 * the source items attached to the result.
 *
 * For each session, `items` is parallel to `chunks`: `items[i]` is the
 * object that produced `chunks[i]`. `malformed` and `errors` entries carry
 * the offending item as `.item`.
 *
 * Never throws on bad data. Only a non-array `items`, a non-function
 * `getLine`, or an invalid `config` raises.
 *
 * @example
 *   const rows = await db.select("SELECT id, chunk FROM chunks");
 *   const report = analyzeItems(rows, { getLine: (r) => r.chunk });
 *
 *   for (const s of report.sessions) {
 *     if (s.complete) {
 *       saveComplete(s.sessionId, joinChunks(s.chunks));
 *       await db.deleteByIds("chunks", s.items.map((r) => r.id));
 *     }
 *   }
 *
 * @public
 * @template T
 * @param {T[]} items
 * @param {import("./types.js").AnalyzeItemsOptions<T>} options
 * @returns {import("./types.js").ItemizedAnalysisResult<T>}
 * @throws {TypeError} If `items` is not an array, `getLine` is not a
 *                     function, or a config/option field is unknown.
 * @throws {RangeError} If `config` fields are out of range.
 */
function analyzeItems(items, options) {
    if (!Array.isArray(items)) {
        throw new TypeError('Expected an array of items');
    }
    // `options` is required by the type, but JS callers may still pass
    // `undefined` — keep the optional chain so the error message stays
    // useful instead of "Cannot read properties of undefined".
    const getLine = options?.getLine;
    if (typeof getLine !== 'function') {
        throw new TypeError('getLine must be a function');
    }
    const config = ensureOptionsConfig(options, ['getLine']);

    /** @type {import("./types.js").ItemizedChunkIssue<T>[]} */
    const malformed = [];
    /** @type {Map<string, import('./types.js').ItemBucket<T>>} */
    const buckets = new Map();

    for (let i = 0; i < items.length; i += 1) {
        const item = items[i];

        let line;
        try {
            line = getLine(item, i);
        } catch (err) {
            malformed.push({
                item,
                line: i,
                reason: `getLine threw: ${errorMessage(err)}`,
            });
            continue;
        }

        if (typeof line !== 'string' || line.length < config.sessionLength) {
            malformed.push({
                item,
                line: i,
                reason: 'line is too short or not a string',
            });
            continue;
        }

        const sessionId = line.slice(0, config.sessionLength);
        if (!SESSION_PREFIX_RE.test(sessionId)) {
            malformed.push({ item, line: i, reason: 'invalid session prefix' });
            continue;
        }

        let bucket = buckets.get(sessionId);
        if (!bucket) {
            bucket = { sessionId, entries: [], errors: [] };
            buckets.set(sessionId, bucket);
        }

        try {
            const chunk = parseChunk(line, config);
            bucket.entries.push({ chunk, item });
        } catch (err) {
            bucket.errors.push({ item, line: i, reason: errorMessage(err) });
        }
    }

    /** @type {import("./types.js").ItemizedSessionAnalysis<T>[]} */
    const sessions = [];

    for (const bucket of buckets.values()) {
        const s = summarize(bucket.entries, bucket.errors);
        sessions.push({
            sessionId: bucket.sessionId,
            complete: s.complete,
            expectedTotal: s.expectedTotal,
            totalMismatch: s.totalMismatch,
            chunks: s.chunks,
            items: s.items,
            present: s.present,
            missing: s.missing,
            duplicates: s.duplicates,
            errors: s.errors,
        });
    }

    sessions.sort((a, b) => compareSessionIds(a.sessionId, b.sessionId));
    malformed.sort((a, b) => a.line - b.line);

    const ok = malformed.length === 0 && sessions.every(s => s.complete);
    return { ok, sessions, malformed };
}

// @ts-check


/**
 * Create a self-consistent codec: every method on the returned object uses
 * the same resolved config for encoding and decoding, so mismatched-config
 * bugs are impossible by construction.
 *
 * @public
 * @param {import("./types.js").ChunkConfig} [config]
 * @returns {import("./types.js").Codec}
 */
function createCodec(config = {}) {
    const resolved = resolveConfig(config);
    const frozen = resolved;
    return {
        config: frozen,
        metaLength: frozen.metaLength,
        encodeText: (text, options = {}) => encodeText(text, { ...options, config: resolved }),
        decodeText: lines => decodeText(lines, { config: resolved }),
        splitText: (text, options = {}) => splitText(text, { ...options, config: resolved }),
        joinBytes,
        joinChunks,
        parseChunk: line => parseChunk(line, resolved),
        formatChunk: chunk => formatChunk(chunk, resolved),
        chunksFromLines: lines => chunksFromLines(lines, resolved),
        analyzeLines: lines => analyzeLines(lines, { config: resolved }),
        analyzeItems: (items, options) => analyzeItems(items, { ...options, config: resolved }),
        completeSessions,
        incompleteSessions,
        generateSessionId: () => generateSessionId(resolved),
    };
}

export { ALPHABET, DEFAULT_CONFIG, LETTERS, analyzeItems, analyzeLines, chunksFromLines, completeSessions, createCodec, decodeText, encodeText, formatChunk, generateSessionId, incompleteSessions, joinBytes, joinChunks, parseChunk, resolveConfig, splitText };
