// @ts-check

import { base36ToBytes, bytesToBase36, decodeNumber, encodeNumber } from './base36.js';
import { DEFAULT_CONFIG } from './config.js';
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
 * Validate a session id against the resolved config.
 *
 * A valid session id must be exactly `config.sessionLength` base36
 * characters long and start with a lowercase letter — this guarantees that
 * the encoded line never begins with a digit.
 *
 * @internal
 * @param {string} sessionId
 * @param {import("./types.js").ResolvedConfig} [config]
 * @returns {void}
 * @throws {RangeError} If the length, the alphabet, or the first character
 *                      are wrong.
 */
export function validateSessionId(sessionId, config = DEFAULT_CONFIG) {
    if (typeof sessionId !== 'string' || sessionId.length !== config.sessionLength) {
        throw new RangeError(`sessionId must be a ${config.sessionLength}-character string`);
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
 * @internal
 * @param {string} line
 * @param {import("./types.js").ResolvedConfig} [config]
 * @returns {import('./types.js').ChunkHeader}
 */
export function parseHeader(line, config = DEFAULT_CONFIG) {
    if (typeof line !== 'string') {
        throw new TypeError('line must be a string');
    }
    if (line.length < config.metaLength) {
        throw new Error(`Line is shorter than the metadata header (${config.metaLength})`);
    }
    if (!BASE36_RE.test(line)) {
        throw new Error('Line contains non-base36 characters');
    }
    if (!FIRST_CHAR_RE.test(line)) {
        throw new Error('Line must start with a lowercase letter (a-z)');
    }

    let pos = 0;
    const session = line.slice(pos, (pos += config.sessionLength));
    const index = decodeNumber(line.slice(pos, (pos += config.indexLength)));
    const total = decodeNumber(line.slice(pos, (pos += config.totalLength)));
    const byteCount = decodeNumber(line.slice(pos, (pos += config.countLength)));
    const checksumValue =
        config.crcLength > 0 ? decodeNumber(line.slice(pos, (pos += config.crcLength))) : 0;

    if (total < 1) {
        throw new Error(`Invalid total (${total}); must be >= 1`);
    }
    if (index >= total) {
        throw new Error(`Chunk index (${index}) is out of range [0, ${total})`);
    }
    return { session, index, total, byteCount, checksumValue };
}

/**
 * Parse one encoded line into a chunk. Validates the checksum according to
 * `config.checksum` and throws on mismatch.
 *
 * @public
 * @param {string} line
 * @param {import("./types.js").ResolvedConfig} [config]
 * @returns {import("./types.js").Chunk}
 * @throws {TypeError | Error}
 */
export function parseChunk(line, config = DEFAULT_CONFIG) {
    const { session, index, total, byteCount, checksumValue } = parseHeader(line, config);
    const bytes = base36ToBytes(line.slice(config.metaLength), byteCount);

    if (config.checksum !== 'none') {
        const actual = computeChecksum(bytes, config.checksum);
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
 * @param {import("./types.js").ResolvedConfig} [config]
 * @returns {string}
 * @throws {TypeError | RangeError}
 */
export function formatChunk(chunk, config = DEFAULT_CONFIG) {
    if (!chunk || typeof chunk !== 'object') {
        throw new TypeError('chunk must be an object');
    }
    const { session, index, total, bytes } = chunk;
    if (!(bytes instanceof Uint8Array)) {
        throw new TypeError('chunk.bytes must be a Uint8Array');
    }
    validateSessionId(session, config);

    if (!Number.isInteger(index) || index < 0 || index > config.maxIndex) {
        throw new RangeError(`index must be in [0, ${config.maxIndex}], got ${index}`);
    }
    if (!Number.isInteger(total) || total < 1 || total > config.maxTotal) {
        throw new RangeError(`total must be in [1, ${config.maxTotal}], got ${total}`);
    }
    if (index >= total) {
        throw new RangeError(`index (${index}) must be less than total (${total})`);
    }
    if (bytes.length > config.maxByteCount) {
        throw new RangeError(
            `bytes.length (${bytes.length}) exceeds the ${config.maxByteCount}-byte limit`
        );
    }

    const checksumValue = config.checksum !== 'none' ? computeChecksum(bytes, config.checksum) : 0;

    const header =
        session +
        encodeNumber(index, config.indexLength) +
        encodeNumber(total, config.totalLength) +
        encodeNumber(bytes.length, config.countLength) +
        (config.crcLength > 0 ? encodeNumber(checksumValue, config.crcLength) : '');

    return header + bytesToBase36(bytes);
}
