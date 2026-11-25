// src/base36.js
var ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
var LETTERS = "abcdefghijklmnopqrstuvwxyz";
var RADIX = 36n;
var LOG2_BASE36 = Math.log2(36);
var CHAR_VALUE = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();
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
    return "";
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
  return chars.join("");
}
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
function bytesToBase36(bytes) {
  if (bytes.length === 0) {
    return "";
  }
  let acc = 0n;
  for (let i = 0; i < bytes.length; i += 1) {
    acc = acc << 8n | BigInt(bytes[i]);
  }
  let out = "";
  while (acc > 0n) {
    out = ALPHABET[Number(acc % RADIX)] + out;
    acc /= RADIX;
  }
  return out;
}
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
function randomChars(alphabet, count) {
  const n = alphabet.length;
  if (n === 0) {
    throw new RangeError("alphabet must not be empty");
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`count must be a non-negative integer, got ${count}`);
  }
  if (count === 0) {
    return [];
  }
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.getRandomValues !== "function") {
    throw new Error(
      "globalThis.crypto.getRandomValues is not available (Node.js >= 19 required)"
    );
  }
  const limit = Math.floor(256 / n) * n;
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
function randomBase36(length, firstCharAlphabet = ALPHABET) {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(`length must be a non-negative integer, got ${length}`);
  }
  if (length === 0) {
    return "";
  }
  const first = randomChars(firstCharAlphabet, 1)[0];
  return first + randomChars(ALPHABET, length - 1).join("");
}

// src/config.js
var LAYOUT = Object.freeze({
  indexLength: 3,
  totalLength: 3,
  countLength: 2
});
var CAPACITY = Object.freeze({
  maxIndex: 36 ** LAYOUT.indexLength - 1,
  maxTotal: 36 ** LAYOUT.totalLength - 1,
  maxByteCount: 36 ** LAYOUT.countLength - 1
});
var CHECKSUM_LENGTHS = Object.freeze({
  none: 0,
  crc8: 2,
  crc16: 4
});
var KNOWN_CONFIG_KEYS = Object.freeze([
  "sessionLength",
  "checksum",
  "crcLength",
  "indexLength",
  "totalLength",
  "countLength",
  "metaLength",
  "maxIndex",
  "maxTotal",
  "maxByteCount"
]);
var KNOWN_CONFIG_KEY_SET = new Set(KNOWN_CONFIG_KEYS);
function assertKnownConfigKeys(partial) {
  for (const key of Object.keys(partial)) {
    if (!KNOWN_CONFIG_KEY_SET.has(key)) {
      throw new TypeError(
        `Unknown config field: ${JSON.stringify(key)} (expected "sessionLength" and/or "checksum")`
      );
    }
  }
}
function resolveConfig(partial = {}) {
  if (partial === null || typeof partial !== "object") {
    throw new TypeError("config must be an object");
  }
  assertKnownConfigKeys(partial);
  const raw = (
    /** @type {{ sessionLength?: unknown, checksum?: unknown }} */
    partial
  );
  const sessionLengthValue = raw.sessionLength === void 0 ? 6 : raw.sessionLength;
  if (typeof sessionLengthValue !== "number" || !Number.isInteger(sessionLengthValue) || sessionLengthValue < 4 || sessionLengthValue > 8) {
    throw new RangeError(
      `sessionLength must be an integer in [4, 8], got ${JSON.stringify(sessionLengthValue)}`
    );
  }
  const sessionLength = (
    /** @type {4 | 5 | 6 | 7 | 8} */
    sessionLengthValue
  );
  const checksum = raw.checksum === void 0 ? "crc16" : raw.checksum;
  if (checksum !== "none" && checksum !== "crc8" && checksum !== "crc16") {
    throw new RangeError(
      `checksum must be "none", "crc8", or "crc16", got ${JSON.stringify(checksum)}`
    );
  }
  const crcLength = CHECKSUM_LENGTHS[checksum];
  const metaLength = sessionLength + LAYOUT.indexLength + LAYOUT.totalLength + LAYOUT.countLength + crcLength;
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
    maxByteCount: CAPACITY.maxByteCount
  });
}
var DEFAULT_CONFIG = Object.freeze(resolveConfig());
function ensureConfig(config) {
  if (config === void 0 || config === null) {
    return DEFAULT_CONFIG;
  }
  if (typeof config !== "object") {
    throw new TypeError("config must be an object");
  }
  assertKnownConfigKeys(config);
  const c = (
    /** @type {import("./types.js").ResolvedConfig} */
    config
  );
  const consistent = Number.isInteger(c.sessionLength) && c.sessionLength >= 4 && c.sessionLength <= 8 && (c.checksum === "none" || c.checksum === "crc8" || c.checksum === "crc16") && c.crcLength === CHECKSUM_LENGTHS[c.checksum] && c.indexLength === LAYOUT.indexLength && c.totalLength === LAYOUT.totalLength && c.countLength === LAYOUT.countLength && c.metaLength === c.sessionLength + c.indexLength + c.totalLength + c.countLength + c.crcLength && c.maxIndex === CAPACITY.maxIndex && c.maxTotal === CAPACITY.maxTotal && c.maxByteCount === CAPACITY.maxByteCount;
  return consistent ? c : resolveConfig(
    /** @type {import("./types.js").ChunkConfig} */
    config
  );
}
var RESOLVED_ONLY_KEYS = Object.freeze([
  "crcLength",
  "indexLength",
  "totalLength",
  "countLength",
  "metaLength",
  "maxIndex",
  "maxTotal",
  "maxByteCount"
]);
function ensureOptionsConfig(options, extraKeys = []) {
  if (options === void 0 || options === null) {
    return DEFAULT_CONFIG;
  }
  if (typeof options !== "object") {
    throw new TypeError("options must be an object");
  }
  const opts = (
    /** @type {Record<string, unknown>} */
    options
  );
  if (opts.config !== void 0) {
    if ("sessionLength" in opts || "checksum" in opts) {
      throw new TypeError(
        'Pass the wire format either as "config" or as bare "sessionLength"/"checksum" fields, not both'
      );
    }
    return ensureConfig(
      /** @type {any} */
      opts.config
    );
  }
  if (RESOLVED_ONLY_KEYS.some((key) => key in opts)) {
    const rest = { ...opts };
    delete rest.config;
    return ensureConfig(
      /** @type {any} */
      rest
    );
  }
  for (const key of Object.keys(opts)) {
    if (key !== "config" && key !== "sessionLength" && key !== "checksum" && !extraKeys.includes(key)) {
      throw new TypeError(`Unknown option: ${JSON.stringify(key)}`);
    }
  }
  const picked = {};
  let hasField = false;
  if ("sessionLength" in opts) {
    picked.sessionLength = /** @type {any} */
    opts.sessionLength;
    hasField = true;
  }
  if ("checksum" in opts) {
    picked.checksum = /** @type {any} */
    opts.checksum;
    hasField = true;
  }
  return hasField ? resolveConfig(picked) : DEFAULT_CONFIG;
}

// src/crc.js
var CRC16_TABLE = (() => {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i << 8;
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 32768 ? crc << 1 ^ 4129 : crc << 1;
    }
    table[i] = crc & 65535;
  }
  return table;
})();
var CRC8_TABLE = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 1 ? crc >>> 1 ^ 140 : crc >>> 1;
    }
    table[i] = crc;
  }
  return table;
})();
function crc16(bytes) {
  let crc = 65535;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc << 8 ^ CRC16_TABLE[(crc >> 8 ^ bytes[i]) & 255]) & 65535;
  }
  return crc;
}
function crc8(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC8_TABLE[crc ^ bytes[i]];
  }
  return crc;
}
function computeChecksum(bytes, algorithm) {
  if (algorithm === "crc16") {
    return crc16(bytes);
  }
  if (algorithm === "crc8") {
    return crc8(bytes);
  }
  throw new Error(`Unknown checksum algorithm: ${algorithm}`);
}

// src/chunk.js
var SESSION_PREFIX_RE = /^[a-z][0-9a-z]*$/;
var FIRST_CHAR_RE = /^[a-z]/;
var BASE36_RE = /^[0-9a-z]+$/;
function maxPayloadChars(config) {
  return Math.ceil(config.maxByteCount * 8 / LOG2_BASE36);
}
function validateSessionId(sessionId, config) {
  const cfg = ensureConfig(config);
  if (typeof sessionId !== "string" || sessionId.length !== cfg.sessionLength) {
    throw new RangeError(`sessionId must be a ${cfg.sessionLength}-character string`);
  }
  if (!BASE36_RE.test(sessionId)) {
    throw new RangeError("sessionId must contain only base36 characters");
  }
  if (!FIRST_CHAR_RE.test(sessionId)) {
    throw new RangeError("sessionId must start with a lowercase letter (a-z)");
  }
}
function parseHeader(line, config) {
  const cfg = ensureConfig(config);
  if (typeof line !== "string") {
    throw new TypeError("line must be a string");
  }
  if (line.length < cfg.metaLength) {
    throw new Error(`Line is shorter than the metadata header (${cfg.metaLength})`);
  }
  const maxLen = cfg.metaLength + maxPayloadChars(cfg);
  if (line.length > maxLen) {
    throw new Error(
      `Line is too long (${line.length} chars); a valid chunk is at most ${maxLen} chars (${cfg.maxByteCount} payload bytes)`
    );
  }
  if (!BASE36_RE.test(line)) {
    throw new Error("Line contains non-base36 characters");
  }
  if (!FIRST_CHAR_RE.test(line)) {
    throw new Error("Line must start with a lowercase letter (a-z)");
  }
  let pos = 0;
  const session = line.slice(pos, pos += cfg.sessionLength);
  const index = decodeNumber(line.slice(pos, pos += cfg.indexLength));
  const total = decodeNumber(line.slice(pos, pos += cfg.totalLength));
  const byteCount = decodeNumber(line.slice(pos, pos += cfg.countLength));
  const checksumValue = cfg.crcLength > 0 ? decodeNumber(line.slice(pos, pos += cfg.crcLength)) : 0;
  if (total < 1) {
    throw new Error(`Invalid total (${total}); must be >= 1`);
  }
  if (index >= total) {
    throw new Error(`Chunk index (${index}) is out of range [0, ${total})`);
  }
  return { session, index, total, byteCount, checksumValue };
}
function parseChunk(line, config) {
  const cfg = ensureConfig(config);
  const { session, index, total, byteCount, checksumValue } = parseHeader(line, cfg);
  const payload = line.slice(cfg.metaLength);
  const bytes = base36ToBytes(payload, byteCount);
  if (bytesToBase36(bytes) !== payload) {
    throw new Error(
      `Non-canonical payload: ${JSON.stringify(payload)} is not the shortest base36 encoding of ${byteCount} byte(s)`
    );
  }
  if (cfg.checksum !== "none") {
    const actual = computeChecksum(bytes, cfg.checksum);
    if (actual !== checksumValue) {
      throw new Error(`Checksum mismatch: expected ${checksumValue}, got ${actual}`);
    }
  }
  return { session, index, total, bytes };
}
function formatChunk(chunk, config) {
  const cfg = ensureConfig(config);
  if (!chunk || typeof chunk !== "object") {
    throw new TypeError("chunk must be an object");
  }
  const { session, index, total, bytes } = chunk;
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("chunk.bytes must be a Uint8Array");
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
  const checksumValue = cfg.checksum !== "none" ? computeChecksum(bytes, cfg.checksum) : 0;
  const header = session + encodeNumber(index, cfg.indexLength) + encodeNumber(total, cfg.totalLength) + encodeNumber(bytes.length, cfg.countLength) + (cfg.crcLength > 0 ? encodeNumber(checksumValue, cfg.crcLength) : "");
  return header + bytesToBase36(bytes);
}

// src/decode.js
var UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
function validateChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new TypeError(
      "Expected a non-empty array of chunks: an empty payload is one zero-byte chunk, so zero chunks never represent a valid session"
    );
  }
  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i];
    if (!c || typeof c !== "object") {
      throw new TypeError(`Chunk ${i} is not an object`);
    }
    if (!(c.bytes instanceof Uint8Array)) {
      throw new TypeError(`Chunk ${i}.bytes is not a Uint8Array`);
    }
    if (typeof c.session !== "string" || !SESSION_PREFIX_RE.test(c.session)) {
      throw new TypeError(
        `Chunk ${i}.session is not a valid base36 session id (a-z followed by [0-9a-z])`
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
  const seen = /* @__PURE__ */ new Set();
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
function joinChunks(chunks) {
  return UTF8_DECODER.decode(joinBytes(chunks));
}
function chunksFromLines(lines, config) {
  if (!Array.isArray(lines)) {
    throw new TypeError("Expected an array of lines");
  }
  if (lines.length === 0) {
    throw new TypeError(
      "Expected a non-empty array of lines: an empty payload encodes to one zero-byte chunk, so zero lines never represent a valid encoding"
    );
  }
  const cfg = ensureConfig(config);
  return lines.map((line) => parseChunk(line, cfg));
}
function decodeText(lines, options) {
  return joinChunks(chunksFromLines(lines, ensureOptionsConfig(options)));
}

// src/encode.js
var ENCODE_OPTION_KEYS = Object.freeze(["config", "maxLen", "bytesPerChunk", "sessionId"]);
function encodeOptions(options) {
  if (options === void 0 || options === null) {
    return {};
  }
  if (typeof options !== "object") {
    throw new TypeError("options must be an object");
  }
  const opts = (
    /** @type {Record<string, unknown>} */
    options
  );
  for (const key of Object.keys(opts)) {
    if (!ENCODE_OPTION_KEYS.includes(key)) {
      throw new TypeError(
        `Unknown option: ${JSON.stringify(key)} (expected "maxLen", "bytesPerChunk", "sessionId" and/or "config")`
      );
    }
  }
  return (
    /** @type {import("./types.js").EncodeOptions} */
    opts
  );
}
function generateSessionId(config) {
  const cfg = ensureConfig(config);
  return randomBase36(cfg.sessionLength, LETTERS);
}
function resolveSessionId(sessionId, config) {
  if (sessionId === void 0) {
    return generateSessionId(config);
  }
  validateSessionId(sessionId, config);
  return sessionId;
}
function resolveBytesPerChunk({ maxLen = 63, bytesPerChunk } = {}, config) {
  if (bytesPerChunk !== void 0) {
    if (!Number.isInteger(bytesPerChunk) || bytesPerChunk < 1) {
      throw new RangeError("bytesPerChunk must be a positive integer");
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
  const n = Math.floor(payloadChars * LOG2_BASE36 / 8);
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
function utf8CharLength(lead) {
  if (lead < 128) {
    return 1;
  }
  if ((lead & 224) === 192) {
    return 2;
  }
  if ((lead & 240) === 224) {
    return 3;
  }
  if ((lead & 248) === 240) {
    return 4;
  }
  return 1;
}
function assertWellFormed(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 55296 || code > 57343) {
      continue;
    }
    if (code <= 56319) {
      const next = text.charCodeAt(i + 1);
      if (next >= 56320 && next <= 57343) {
        i += 1;
        continue;
      }
    }
    const escaped = `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
    throw new TypeError(
      `text contains an unpaired surrogate at index ${i} (${escaped}); it cannot be encoded losslessly as UTF-8`
    );
  }
}
function splitUtf8Safe(bytes, bytesPerChunk, maxChunks) {
  if (bytes.length === 0) {
    return [new Uint8Array(0)];
  }
  const out = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + bytesPerChunk, bytes.length);
    while (end > start && end < bytes.length && (bytes[end] & 192) === 128) {
      end -= 1;
    }
    if (end === start) {
      const charLen = utf8CharLength(bytes[start]);
      throw new RangeError(
        `bytesPerChunk (${bytesPerChunk}) is too small for a ${charLen}-byte UTF-8 character at byte ${start}; use at least ${charLen}`
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
function splitText(text, options) {
  if (typeof text !== "string") {
    throw new TypeError("text must be a string");
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
    bytes
  }));
}
function encodeText(text, options) {
  const opts = encodeOptions(options);
  const config = ensureConfig(opts.config);
  return splitText(text, { ...opts, config }).map((c) => formatChunk(c, config));
}

// src/analyze.js
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
function compareSessionIds(a, b) {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
function mode(values) {
  if (values.length === 0) {
    return null;
  }
  const counts = /* @__PURE__ */ new Map();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let bestCount = 0;
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
function summarize(entries, errors) {
  const chunks = entries.map((e) => e.chunk);
  const expectedTotal = mode(chunks.map((c) => c.total));
  const indexCount = /* @__PURE__ */ new Map();
  for (const c of chunks) {
    indexCount.set(c.index, (indexCount.get(c.index) ?? 0) + 1);
  }
  const present = [...indexCount.keys()].sort((a, b) => a - b);
  const duplicates = [...indexCount.entries()].filter(([, count]) => count > 1).map(([idx]) => idx).sort((a, b) => a - b);
  const missing = [];
  if (expectedTotal !== null) {
    for (let idx = 0; idx < expectedTotal; idx += 1) {
      if (!indexCount.has(idx)) {
        missing.push(idx);
      }
    }
  }
  const totalMismatch = expectedTotal === null || chunks.some((c) => c.total !== expectedTotal);
  const complete = errors.length === 0 && !totalMismatch && missing.length === 0 && duplicates.length === 0 && chunks.length === expectedTotal;
  const sorted = [...entries].sort((a, b) => a.chunk.index - b.chunk.index);
  return {
    complete,
    expectedTotal,
    totalMismatch,
    chunks: sorted.map((e) => e.chunk),
    items: sorted.map((e) => e.item),
    present,
    missing,
    duplicates,
    errors: [...errors].sort((a, b) => a.line - b.line)
  };
}
function analyzeLines(lines, options) {
  if (!Array.isArray(lines)) {
    throw new TypeError("Expected an array of lines");
  }
  const config = ensureOptionsConfig(options);
  const malformed = [];
  const buckets = /* @__PURE__ */ new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (typeof line !== "string" || line.length < config.sessionLength) {
      malformed.push({ line: i, reason: "line is too short or not a string" });
      continue;
    }
    const sessionId = line.slice(0, config.sessionLength);
    if (!SESSION_PREFIX_RE.test(sessionId)) {
      malformed.push({ line: i, reason: "invalid session prefix" });
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
  const sessions = [];
  for (const bucket of buckets.values()) {
    const entries = bucket.chunks.map((chunk) => ({ chunk, item: void 0 }));
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
      errors: s.errors
    });
  }
  sessions.sort((a, b) => compareSessionIds(a.sessionId, b.sessionId));
  malformed.sort((a, b) => a.line - b.line);
  const ok = malformed.length === 0 && sessions.every((s) => s.complete);
  return { ok, sessions, malformed };
}
function completeSessions(report) {
  return report.sessions.filter((s) => s.complete);
}
function incompleteSessions(report) {
  return report.sessions.filter((s) => !s.complete);
}
function analyzeItems(items, options) {
  if (!Array.isArray(items)) {
    throw new TypeError("Expected an array of items");
  }
  const getLine = options?.getLine;
  if (typeof getLine !== "function") {
    throw new TypeError("getLine must be a function");
  }
  const config = ensureOptionsConfig(options, ["getLine"]);
  const malformed = [];
  const buckets = /* @__PURE__ */ new Map();
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    let line;
    try {
      line = getLine(item, i);
    } catch (err) {
      malformed.push({
        item,
        line: i,
        reason: `getLine threw: ${errorMessage(err)}`
      });
      continue;
    }
    if (typeof line !== "string" || line.length < config.sessionLength) {
      malformed.push({
        item,
        line: i,
        reason: "line is too short or not a string"
      });
      continue;
    }
    const sessionId = line.slice(0, config.sessionLength);
    if (!SESSION_PREFIX_RE.test(sessionId)) {
      malformed.push({ item, line: i, reason: "invalid session prefix" });
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
      errors: s.errors
    });
  }
  sessions.sort((a, b) => compareSessionIds(a.sessionId, b.sessionId));
  malformed.sort((a, b) => a.line - b.line);
  const ok = malformed.length === 0 && sessions.every((s) => s.complete);
  return { ok, sessions, malformed };
}

// src/codec.js
function createCodec(config = {}) {
  const resolved = resolveConfig(config);
  const frozen = resolved;
  return {
    config: frozen,
    metaLength: frozen.metaLength,
    encodeText: (text, options = {}) => encodeText(text, { ...options, config: resolved }),
    decodeText: (lines) => decodeText(lines, { config: resolved }),
    splitText: (text, options = {}) => splitText(text, { ...options, config: resolved }),
    joinBytes,
    joinChunks,
    parseChunk: (line) => parseChunk(line, resolved),
    formatChunk: (chunk) => formatChunk(chunk, resolved),
    chunksFromLines: (lines) => chunksFromLines(lines, resolved),
    analyzeLines: (lines) => analyzeLines(lines, { config: resolved }),
    analyzeItems: (items, options) => analyzeItems(items, { ...options, config: resolved }),
    completeSessions,
    incompleteSessions,
    generateSessionId: () => generateSessionId(resolved)
  };
}
export {
  ALPHABET,
  DEFAULT_CONFIG,
  LETTERS,
  analyzeItems,
  analyzeLines,
  chunksFromLines,
  completeSessions,
  createCodec,
  decodeText,
  encodeText,
  formatChunk,
  generateSessionId,
  incompleteSessions,
  joinBytes,
  joinChunks,
  parseChunk,
  resolveConfig,
  splitText
};
