// @ts-check

import { LETTERS, LOG2_BASE36, randomBase36 } from './base36.js';
import { ensureConfig } from './config.js';
import { formatChunk, validateSessionId } from './chunk.js';

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
export function generateSessionId(config) {
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
export function utf8CharLength(lead) {
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
export function splitText(text, options) {
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
export function encodeText(text, options) {
    const opts = encodeOptions(options);
    const config = ensureConfig(opts.config);
    return splitText(text, { ...opts, config }).map(c => formatChunk(c, config));
}
