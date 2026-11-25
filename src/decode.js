// @ts-check

import { ensureConfig, ensureOptionsConfig } from './config.js';
import { parseChunk, SESSION_PREFIX_RE } from './chunk.js';

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
export function joinBytes(chunks) {
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
export function joinChunks(chunks) {
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
export function chunksFromLines(lines, config) {
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
export function decodeText(lines, options) {
    return joinChunks(chunksFromLines(lines, ensureOptionsConfig(options)));
}
