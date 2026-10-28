// @ts-check

/**
 * Base36 alphabet: digits followed by lowercase letters. Every string
 * produced by this package consists only of these 36 characters, so output
 * is safe for transports that restrict payloads to `[0-9a-z]` and for
 * case-insensitive channels.
 * @public
 */
export const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Lowercase letters only: `a-z`. Used as the first-character source for
 * session ids, so that encoded lines never begin with a digit.
 * @public
 */
export const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

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
 * Zero-padded on the left.
 *
 * @internal
 * @param {number} value  Non-negative safe integer.
 * @param {number} width  Exact output length in characters.
 * @returns {string}
 * @throws {RangeError} If `value` does not fit into `width` base36 digits.
 */
export function encodeNumber(value, width) {
    if (!Number.isInteger(value) || value < 0) {
        throw new RangeError(`Expected non-negative integer, got ${value}`);
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
 * Decode a base36 string into a non-negative integer.
 *
 * @internal
 * @param {string} str
 * @returns {number}
 * @throws {Error} If `str` contains characters outside the base36 alphabet.
 */
export function decodeNumber(str) {
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
export function bytesToBase36(bytes) {
    if (bytes.length === 0) return '';
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
 * @throws {Error} On invalid characters or byte-count mismatch.
 */
export function base36ToBytes(str, expectedLength) {
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
 * @internal
 * @param {string} alphabet
 * @param {number} count
 * @returns {string[]}
 */
function randomChars(alphabet, count) {
    const n = alphabet.length;
    const limit = Math.floor(256 / n) * n;
    /** @type {string[]} */
    const out = [];
    const batch = new Uint8Array(Math.max(16, count * 2));
    while (out.length < count) {
        globalThis.crypto.getRandomValues(batch);
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
 */
export function randomBase36(length, firstCharAlphabet = ALPHABET) {
    if (length === 0) return '';
    const first = randomChars(firstCharAlphabet, 1)[0];
    return first + randomChars(ALPHABET, length - 1).join('');
}

/** Expose log2(36) to the codec module without re-exporting it publicly. */
export { LOG2_BASE36 };
