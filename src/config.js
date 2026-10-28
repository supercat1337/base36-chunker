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
 * How many base36 characters each checksum algorithm needs.
 *
 * `crc16` is 16 bits, and `36² = 1296 < 65536 ≤ 36³ = 46656` — so CRC16
 * needs **3** base36 characters, not 3 as in base36. Wait, we need to
 * cover 65535, and 36³ = 46656 < 65536 → not enough; need 36⁴ = 1679616.
 * So crc16 requires 4 base36 characters.
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
 * Resolve a possibly-partial config into a frozen, fully-specified one.
 * All layout widths are filled in; derived values (`crcLength`,
 * `metaLength`, `maxIndex`, `maxTotal`, `maxByteCount`) are computed once.
 *
 * @public
 * @param {import("./types.js").ChunkConfig} [partial]
 * @returns {import("./types.js").ResolvedConfig}
 * @throws {RangeError} If `sessionLength` or `checksum` are out of range.
 */
export function resolveConfig(partial = {}) {
    const sessionLength = partial.sessionLength ?? 6;
    if (!Number.isInteger(sessionLength) || sessionLength < 4 || sessionLength > 8) {
        throw new RangeError(`sessionLength must be an integer in [4, 8], got ${sessionLength}`);
    }

    const checksum = partial.checksum ?? 'crc16';
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
        maxIndex: 36 ** LAYOUT.indexLength - 1,
        maxTotal: 36 ** LAYOUT.totalLength - 1,
        maxByteCount: 36 ** LAYOUT.countLength - 1,
    });
}

/**
 * Default configuration: 6-char session, CRC16, 18-char header.
 * @public
 */
export const DEFAULT_CONFIG = resolveConfig();
