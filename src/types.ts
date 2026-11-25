/**
 * Logical chunk of a payload. Carries everything needed to serialize it to
 * a base36 line (via {@link formatChunk}) or to reassemble the original
 * text (via {@link joinChunks}).
 *
 * @public
 */
export interface Chunk {
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
export interface ChunkConfig {
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
 * Fully-resolved configuration with derived fields pre-computed. Produced
 * by {@link resolveConfig}; {@link DEFAULT_CONFIG} is the package default.
 *
 * @public
 */
export interface ResolvedConfig {
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
 * Options for {@link splitText} and {@link encodeText}.
 *
 * If `bytesPerChunk` is set, it takes precedence over `maxLen`. Otherwise
 * the chunk size is derived from `maxLen − config.metaLength` and rounded
 * down so the base36 payload never exceeds the character budget. With the
 * defaults (`metaLength = 18`), `maxLen = 63` yields 29 bytes per chunk.
 *
 * @public
 */
export interface EncodeOptions {
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
export type ConfigOptions =
    | { config?: ChunkConfig | ResolvedConfig }
    | ChunkConfig
    | ResolvedConfig;

/**
 * A single problem detected in an array of encoded lines. Used both for
 * line-level issues (`report.malformed`) and per-chunk payload decode
 * failures (`SessionAnalysis.errors`).
 *
 * @public
 */
export interface ChunkIssue {
    /** 0-based index of the offending line in the input array. */
    line: number;
    /** Human-readable description of what is wrong with the line. */
    reason: string;
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
export interface SessionAnalysis {
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
 * Non-throwing report produced by {@link analyzeLines}.
 *
 * @public
 */
export interface AnalysisResult {
    /** `true` if every session is complete and no line is malformed. */
    ok: boolean;
    /** Per-session analyses, sorted by `sessionId`. */
    sessions: SessionAnalysis[];
    /** Lines whose session id could not be recovered at all, sorted by `line`. */
    malformed: ChunkIssue[];
}

/**
 * Self-consistent bundle returned by {@link createCodec}. Every method on
 * the returned object uses the same resolved config, so encode/decode
 * mismatches are impossible by construction.
 *
 * @public
 */
export interface Codec {
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
    // keyof (A | B) === 'getLine'  →  Omit<…> === { getLine: (item: T, index: number) => string }
    analyzeItems: <T>(
        items: T[],
        options: Omit<AnalyzeItemsOptions<T>, 'config' | 'sessionLength' | 'checksum'>
    ) => ItemizedAnalysisResult<T>;
    /** Filter the report down to complete sessions. */
    completeSessions: (report: AnalysisResult) => SessionAnalysis[];
    /** Filter the report down to incomplete sessions. */
    incompleteSessions: (report: AnalysisResult) => SessionAnalysis[];
    /** Generate a fresh base36 session id of `config.sessionLength` characters. */
    generateSessionId: () => string;
}

/**
 * Issue attached to a specific source item.
 * @public
 */
export interface ItemizedChunkIssue<T> extends ChunkIssue {
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
export interface ItemizedSessionAnalysis<T> extends SessionAnalysis {
    /** Source items parallel to `chunks`. */
    items: T[];
    /** Per-chunk decode failures, each tagged with its source item. */
    errors: ItemizedChunkIssue<T>[];
}

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
export interface ItemizedAnalysisResult<T> extends AnalysisResult {
    /** Per-session analyses with source items attached. */
    sessions: ItemizedSessionAnalysis<T>[];

    /** Lines whose session id could not be recovered, each tagged with its source item. */
    malformed: ItemizedChunkIssue<T>[];
}

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
export type AnalyzeItemsOptions<T> =
    | {
          /** Extract the base36 line from an item. */
          getLine: (item: T, index: number) => string;
          /** Wire-format override; must match the encoder. */
          config?: ChunkConfig | ResolvedConfig;
          /** Mutually exclusive with `config` — enforced by `ensureOptionsConfig`. */
          sessionLength?: never;
          /** Mutually exclusive with `config` — enforced by `ensureOptionsConfig`. */
          checksum?: never;
      }
    | {
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
 * Accumulator for one session during a single `analyzeLines` pass. Not part
 * of the public API — stripped from the emitted `.d.ts` by `stripInternal`.
 *
 * @internal
 */
export interface Bucket {
    sessionId: string;
    chunks: Chunk[];
    errors: ChunkIssue[];
}

/**
 * Accumulator for one session during a single `analyzeItems` pass. Entries
 * pair a parsed chunk with the source item that produced it, so that
 * `session.items[j]` stays parallel to `session.chunks[j]`.
 *
 * Not part of the public API — stripped from the emitted `.d.ts` by
 * `stripInternal`.
 *
 * @internal
 * @template T
 */
export interface ItemBucket<T> {
    sessionId: string;
    entries: { chunk: Chunk; item: T }[];
    errors: ItemizedChunkIssue<T>[];
}

/**
 * Parsed metadata header of an encoded line. Produced by `parseHeader` and
 * consumed by `parseChunk`. Not part of the public API — stripped from the
 * emitted `.d.ts` by `stripInternal`.
 *
 * @internal
 */
export interface ChunkHeader {
    session: string;
    index: number;
    total: number;
    byteCount: number;
    checksumValue: number;
}

/**
 * Internal summary produced by the shared `summarize()` helper in
 * `analyze.js`. Not part of the public API — stripped from the emitted
 * `.d.ts` by `stripInternal`.
 *
 * @internal
 * @template T
 * @template {ChunkIssue} E
 */
export interface SessionSummary<T, E extends ChunkIssue = ChunkIssue> {
    complete: boolean;
    expectedTotal: number | null;
    totalMismatch: boolean;
    chunks: Chunk[];
    items: T[];
    present: number[];
    missing: number[];
    duplicates: number[];
    errors: E[];
}
