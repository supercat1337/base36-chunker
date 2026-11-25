/**
 * Split any text into base36-only lines (`a-z0-9`, never starting with a
 * digit) with embedded metadata, transport them safely, and reassemble the
 * original on the other side — with a structured integrity report that
 * never throws.
 *
 * @remarks
 * Every output line contains only `[0-9a-z]`, starts with a lowercase
 * letter, carries its own session id, chunk index, total count, and a CRC
 * checksum. Lines can be sent through narrow channels (SMS, QR, LoRa, URL
 * parameters), arrive out of order, or get duplicated — and the receiver
 * can still tell exactly what is complete and what is missing.
 *
 * The package exposes three top-level flows:
 *
 * - {@link encodeText} / {@link splitText} — text → base36 lines / chunks.
 * - {@link decodeText} / {@link joinChunks} — lines / chunks → text
 *   (throwing).
 * - {@link analyzeLines} — lines → {@link AnalysisResult}
 *   (non-throwing integrity report).
 *
 * The wire format is controlled by {@link ChunkConfig}. Defaults are
 * `{ sessionLength: 6, checksum: "crc16" }` — an 18-char header that
 * still fits 29 bytes of payload per line at `maxLen = 63`.
 *
 * @packageDocumentation
 */

/**
 * Base36 alphabet: digits followed by lowercase letters. Every string
 * produced by this package consists only of these 36 characters, so output
 * is safe for transports that restrict payloads to `[0-9a-z]` and for
 * case-insensitive channels.
 * @public
 */
export declare const ALPHABET: "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Non-throwing report produced by {@link analyzeLines}.
 *
 * @public
 */
export declare interface AnalysisResult {
    /** `true` if every session is complete and no line is malformed. */
    ok: boolean;
    /** Per-session analyses, sorted by `sessionId`. */
    sessions: SessionAnalysis[];
    /** Lines whose session id could not be recovered at all, sorted by `line`. */
    malformed: ChunkIssue[];
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
export declare function analyzeItems<T>(items: T[], options: AnalyzeItemsOptions<T>): ItemizedAnalysisResult<T>;

/**
 * Options for {@link analyzeItems}.
 *
 * `getLine` is required — there is no sensible default, so a TypeScript
 * caller cannot write a call that is guaranteed to throw. The wire format
 * comes from `config`, or from the bare `sessionLength` / `checksum` fields
 * as a shorthand; the two forms are mutually exclusive and unknown keys
 * raise a `TypeError`.
 *
 * @public
 */
export declare type AnalyzeItemsOptions<T> = {
    /** Extract the base36 line from an item. */
    getLine: (item: T, index: number) => string;
    /** Wire-format override; must match the encoder. */
    config?: ChunkConfig | ResolvedConfig;
    /** Mutually exclusive with `config` — enforced by `ensureOptionsConfig`. */
    sessionLength?: never;
    /** Mutually exclusive with `config` — enforced by `ensureOptionsConfig`. */
    checksum?: never;
} | {
    /** Extract the base36 line from an item. */
    getLine: (item: T, index: number) => string;
    /** Mutually exclusive with the bare fields — enforced by `ensureOptionsConfig`. */
    config?: never;
    /** Shorthand for `config.sessionLength`. */
    sessionLength?: 4 | 5 | 6 | 7 | 8;
    /** Shorthand for `config.checksum`. */
    checksum?: 'none' | 'crc8' | 'crc16';
};

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
export declare function analyzeLines(lines: string[], options?: ConfigOptions): AnalysisResult;

/**
 * Logical chunk of a payload. Carries everything needed to serialize it to
 * a base36 line (via {@link formatChunk}) or to reassemble the original
 * text (via {@link joinChunks}).
 *
 * @public
 */
export declare interface Chunk {
    /**
     * Base36 session id, identical across all chunks of one payload. Length
     * equals `config.sessionLength` (6 characters by default). Always starts
     * with a lowercase letter (`a-z`), so encoded lines never begin with a
     * digit.
     */
    session: string;
    /**
     * 0-based chunk index. Always strictly less than {@link Chunk.total}.
     */
    index: number;
    /**
     * Total number of chunks in the payload. Same value across all chunks of
     * one session.
     */
    total: number;
    /**
     * Payload bytes for this chunk (UTF-8 for text). The number of bytes is
     * `bytes.length`; it is written into the count field of the encoded line.
     *
     * Leading zero bytes are preserved by the header, not by the payload:
     * `formatChunk` writes only the significant base36 digits, and
     * `parseChunk` restores exactly `bytes.length` bytes using `count`.
     */
    bytes: Uint8Array;
}

/**
 * Partial configuration for the wire format. Omitted fields inherit
 * defaults — `sessionLength: 6`, `checksum: "crc16"`.
 *
 * @public
 */
export declare interface ChunkConfig {
    /**
     * Base36 session id length. The first character is always a lowercase
     * letter (`a-z`); the remaining characters are drawn from the full
     * base36 alphabet.
     *
     * The id space is `26 × 36^(sessionLength − 1)`. The figures below are
     * **birthday thresholds** — the number of concurrent sessions at which
     * the probability of at least one collision reaches ~50%. They are not
     * "safe" limits: keep the live session count an order of magnitude below
     * the threshold for a low collision risk.
     *
     * - `6` → ~47 K sessions (1.57 × 10⁹ ids)
     * - `7` → ~280 K sessions (5.66 × 10¹⁰ ids)
     * - `8` → ~1.7 M sessions (2.04 × 10¹² ids)
     *
     * A collision is not silent data loss: two payloads that share a session
     * id surface in `analyzeLines` as one session with duplicate indices
     * and/or a total mismatch, so `complete` stays `false` instead of two
     * documents being concatenated.
     *
     * @defaultValue 6
     */
    sessionLength?: 4 | 5 | 6 | 7 | 8;
    /**
     * Checksum algorithm applied to each chunk's **payload bytes**.
     *
     * - `"none"`  — no checksum (0 header chars)
     * - `"crc8"`  — CRC-8/MAXIM (2 header chars)
     * - `"crc16"` — CRC-16/CCITT (4 header chars; a 16-bit value does not
     *   fit into 3 base36 digits, since `36³ = 46 656 < 65 536`)
     *
     * The checksum covers the payload and nothing else. `index`, `total`,
     * and `count` are validated structurally instead: `total` must be ≥ 1
     * and agree across the session, `index` must be `< total`, and the
     * payload must occupy exactly `count` bytes in canonical form. A
     * corrupted header field therefore appears as a structural
     * inconsistency (duplicate or missing index, total mismatch) rather
     * than as a checksum failure.
     *
     * @defaultValue "crc16"
     */
    checksum?: 'none' | 'crc8' | 'crc16';
}

/**
 * A single problem detected in an array of encoded lines. Used both for
 * line-level issues (`report.malformed`) and per-chunk payload decode
 * failures (`SessionAnalysis.errors`).
 *
 * @public
 */
export declare interface ChunkIssue {
    /** 0-based index of the offending line in the input array. */
    line: number;
    /** Human-readable description of what is wrong with the line. */
    reason: string;
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
export declare function chunksFromLines(lines: string[], config?: ChunkConfig | ResolvedConfig): Chunk[];

/**
 * Self-consistent bundle returned by {@link createCodec}. Every method on
 * the returned object uses the same resolved config, so encode/decode
 * mismatches are impossible by construction.
 *
 * @public
 */
export declare interface Codec {
    /** Resolved config shared by all methods. */
    config: Readonly<ResolvedConfig>;
    /** Shortcut for `config.metaLength`. */
    metaLength: number;
    /** Split text into base36-only lines. */
    encodeText: (text: string, options?: Omit<EncodeOptions, 'config'>) => string[];
    /** Reassemble text from base36-only lines. Throws on any inconsistency. */
    decodeText: (lines: string[]) => string;
    /** Split text into {@link Chunk} structures. */
    splitText: (text: string, options?: Omit<EncodeOptions, 'config'>) => Chunk[];
    /** Concatenate payload bytes of a complete session — no UTF-8 decoding. */
    joinBytes: (chunks: Chunk[]) => Uint8Array;
    /** Reassemble text from {@link Chunk} structures. */
    joinChunks: (chunks: Chunk[]) => string;
    /** Parse a single line into a {@link Chunk}. */
    parseChunk: (line: string) => Chunk;
    /** Serialize a {@link Chunk} into a base36 line. */
    formatChunk: (chunk: Chunk) => string;
    /** Parse lines into chunks (throws on the first malformed line). */
    chunksFromLines: (lines: string[]) => Chunk[];
    /** Non-throwing integrity analysis. */
    analyzeLines: (lines: string[]) => AnalysisResult;
    /** Non-throwing integrity analysis over arbitrary items; `config` is
     *  supplied by the codec, so it cannot diverge from encode/decode. */
    analyzeItems: <T>(items: T[], options: Omit<AnalyzeItemsOptions<T>, 'config' | 'sessionLength' | 'checksum'>) => ItemizedAnalysisResult<T>;
    /** Filter the report down to complete sessions. */
    completeSessions: (report: AnalysisResult) => SessionAnalysis[];
    /** Filter the report down to incomplete sessions. */
    incompleteSessions: (report: AnalysisResult) => SessionAnalysis[];
    /** Generate a fresh base36 session id of `config.sessionLength` characters. */
    generateSessionId: () => string;
}

/**
 * Filter the report down to complete sessions.
 *
 * @public
 * @param {import("./types.js").AnalysisResult} report
 * @returns {import("./types.js").SessionAnalysis[]}
 */
export declare function completeSessions(report: AnalysisResult): SessionAnalysis[];

/**
 * Options for {@link analyzeLines} and {@link decodeText}.
 *
 * All three shapes resolve to the same wire format:
 *
 * - `{ config: { sessionLength: 8 } }` — explicit nested override;
 * - `{ config: resolvedConfig }`        — a config from {@link resolveConfig};
 * - `{ sessionLength: 8 }`, or a resolved config passed directly — the
 *   config in the options slot itself.
 *
 * `{ config: … }` and the bare fields are mutually exclusive; passing both
 * is a `TypeError`. Unknown keys raise as well: a misspelled option would
 * otherwise fall back to `DEFAULT_CONFIG` and silently make every line of a
 * different layout look `malformed`.
 *
 * @public
 */
export declare type ConfigOptions = {
    config?: ChunkConfig | ResolvedConfig;
} | ChunkConfig | ResolvedConfig;

/**
 * Create a self-consistent codec: every method on the returned object uses
 * the same resolved config for encoding and decoding, so mismatched-config
 * bugs are impossible by construction.
 *
 * @public
 * @param {import("./types.js").ChunkConfig} [config]
 * @returns {import("./types.js").Codec}
 */
export declare function createCodec(config?: ChunkConfig): Codec;

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
export declare function decodeText(lines: string[], options?: ConfigOptions): string;

/**
 * Default configuration. Frozen: mutating it would silently poison every
 * `resolveConfig()` call in the process.
 *
 * @public
 * @type {Readonly<import('./types.js').ResolvedConfig>}
 */
export declare const DEFAULT_CONFIG: Readonly<ResolvedConfig>;

/**
 * Options for {@link splitText} and {@link encodeText}.
 *
 * If `bytesPerChunk` is set, it takes precedence over `maxLen`. Otherwise
 * the chunk size is derived from `maxLen − config.metaLength` and rounded
 * down so the base36 payload never exceeds the character budget. With the
 * defaults (`metaLength = 18`), `maxLen = 63` yields 29 bytes per chunk.
 *
 * @public
 */
export declare interface EncodeOptions {
    /**
     * Maximum encoded line length in base36 characters (metadata included).
     * @defaultValue 63
     */
    maxLen?: number;
    /**
     * Explicit chunk size in bytes. Overrides `maxLen` when both are set.
     */
    bytesPerChunk?: number;
    /**
     * Fixed session id. Its length must equal `config.sessionLength`, it
     * must contain only base36 characters, and it must start with a
     * lowercase letter.
     */
    sessionId?: string;
    /**
     * Override the default wire format. Omitted fields inherit defaults.
     * A `ResolvedConfig` from {@link resolveConfig} is accepted as well and
     * used unchanged (re-resolved only if it is internally inconsistent).
     */
    config?: ChunkConfig | ResolvedConfig;
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
export declare function encodeText(text: string, options?: EncodeOptions): string[];

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
export declare function formatChunk(chunk: Chunk, config?: ChunkConfig | ResolvedConfig): string;

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
export declare function generateSessionId(config?: ChunkConfig | ResolvedConfig): string;

/**
 * Filter the report down to incomplete sessions.
 *
 * @public
 * @param {import("./types.js").AnalysisResult} report
 * @returns {import("./types.js").SessionAnalysis[]}
 */
export declare function incompleteSessions(report: AnalysisResult): SessionAnalysis[];

/**
 * Non-throwing report produced by {@link analyzeItems}. Same shape as
 * {@link AnalysisResult}, but every chunk, malformed entry, and decode
 * error carries the source item that produced it.
 *
 * `sessions[i].items[j]` is the source object that produced
 * `sessions[i].chunks[j]` — same order, same length.
 *
 * @public
 */
export declare interface ItemizedAnalysisResult<T> extends AnalysisResult {
    /** Per-session analyses with source items attached. */
    sessions: ItemizedSessionAnalysis<T>[];
    /** Lines whose session id could not be recovered, each tagged with its source item. */
    malformed: ItemizedChunkIssue<T>[];
}

/**
 * Issue attached to a specific source item.
 * @public
 */
export declare interface ItemizedChunkIssue<T> extends ChunkIssue {
    /** The original item that produced this line. */
    item: T;
}

/**
 * Per-session analysis with a parallel `items` array.
 *
 * `sessions[i].items[j]` is the source item that produced
 * `sessions[i].chunks[j]` — same order, same length.
 *
 * @public
 */
export declare interface ItemizedSessionAnalysis<T> extends SessionAnalysis {
    /** Source items parallel to `chunks`. */
    items: T[];
    /** Per-chunk decode failures, each tagged with its source item. */
    errors: ItemizedChunkIssue<T>[];
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
export declare function joinBytes(chunks: Chunk[]): Uint8Array;

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
export declare function joinChunks(chunks: Chunk[]): string;

/**
 * Lowercase letters only: `a-z`. Used as the first-character source for
 * session ids, so that encoded lines never begin with a digit.
 * @public
 */
export declare const LETTERS: "abcdefghijklmnopqrstuvwxyz";

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
export declare function parseChunk(line: string, config?: ChunkConfig | ResolvedConfig): Chunk;

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
export declare function resolveConfig(partial?: ChunkConfig): Readonly<ResolvedConfig>;

/**
 * Fully-resolved configuration with derived fields pre-computed. Produced
 * by {@link resolveConfig}; {@link DEFAULT_CONFIG} is the package default.
 *
 * @public
 */
export declare interface ResolvedConfig {
    /** Resolved session id length. */
    sessionLength: 4 | 5 | 6 | 7 | 8;
    /** Resolved checksum algorithm. */
    checksum: 'none' | 'crc8' | 'crc16';
    /** Base36 characters reserved for the CRC field (`0`, `2`, or `4`). */
    crcLength: number;
    /** Base36 characters reserved for the chunk index (fixed at `3`). */
    indexLength: 3;
    /** Base36 characters reserved for the total count (fixed at `3`). */
    totalLength: 3;
    /** Base36 characters reserved for the byte count (fixed at `2`). */
    countLength: 2;
    /**
     * Total header length in base36 chars:
     * `sessionLength + 3 + 3 + 2 + crcLength`. With defaults this is `18`.
     */
    metaLength: number;
    /** Highest supported chunk index (`36³ − 1 = 46 655`). */
    maxIndex: number;
    /** Highest supported total count (`36³ − 1 = 46 655`). */
    maxTotal: number;
    /** Highest supported per-chunk payload (`36² − 1 = 1 295` bytes). */
    maxByteCount: number;
}

/**
 * Analysis of one session found in an array of encoded lines.
 *
 * `complete: true` means every index in `[0, expectedTotal)` is present
 * exactly once, all chunks agree on `total`, and no line in this session
 * failed to decode. `chunks` is populated even when incomplete, so partial
 * payloads can be persisted.
 *
 * @public
 */
export declare interface SessionAnalysis {
    /** Session id read from the header prefix (6 chars by default). */
    sessionId: string;
    /** `true` when the session is intact and fully recoverable. */
    complete: boolean;
    /** Best-guess chunk count, or `null` if chunks disagree or none parsed. */
    expectedTotal: number | null;
    /**
     * `true` if chunks disagree on `total`, or if no chunk could be parsed
     * (so `expectedTotal` is `null`).
     */
    totalMismatch: boolean;
    /** Successfully decoded chunks, sorted by `index`. */
    chunks: Chunk[];
    /** Indices that appear at least once, sorted. */
    present: number[];
    /** Indices in `[0, expectedTotal)` that never appeared. */
    missing: number[];
    /** Indices that appear more than once. */
    duplicates: number[];
    /**
     * Lines whose session was recovered but whose payload failed to parse,
     *  sorted by `line`.
     */
    errors: ChunkIssue[];
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
export declare function splitText(text: string, options?: EncodeOptions): Chunk[];

export { }
