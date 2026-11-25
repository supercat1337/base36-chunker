// @ts-check

import { ensureOptionsConfig } from './config.js';
import { parseChunk, SESSION_PREFIX_RE } from './chunk.js';

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
export function errorMessage(err) {
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
export function compareSessionIds(a, b) {
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
export function analyzeLines(lines, options) {
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
export function completeSessions(report) {
    return report.sessions.filter(s => s.complete);
}

/**
 * Filter the report down to incomplete sessions.
 *
 * @public
 * @param {import("./types.js").AnalysisResult} report
 * @returns {import("./types.js").SessionAnalysis[]}
 */
export function incompleteSessions(report) {
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
export function analyzeItems(items, options) {
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
