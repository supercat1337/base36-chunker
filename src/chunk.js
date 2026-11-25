// @ts-check

import { base36ToBytes, bytesToBase36, decodeNumber, encodeNumber, LOG2_BASE36 } from './base36.js';
import { ensureConfig } from './config.js';
import { computeChecksum } from './crc.js';

/**
 * A session id must start with a lowercase letter and consist only of
 * base36 characters. Applied to the session prefix extracted from a line.
 * @internal
 */
export const SESSION_PREFIX_RE = /^[a-z][0-9a-z]*$/;

/**
 * A base36 string must start with a lowercase letter (used for the first
 * character of a line). @internal
 */
export const FIRST_CHAR_RE = /^[a-z]/;

/**
 * A base36 string must contain only `[0-9a-z]` characters.
 * @internal
 */
export const BASE36_RE = /^[0-9a-z]+$/;

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
export function validateSessionId(sessionId, config) {
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
export function parseHeader(line, config) {
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
export function parseChunk(line, config) {
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
export function formatChunk(chunk, config) {
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
