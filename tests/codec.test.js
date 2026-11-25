// @ts-check

import test from 'ava';

import { createCodec } from '../src/codec.js';
import { DEFAULT_CONFIG } from '../src/config.js';

// ── Factory shape ────────────────────────────────────────────────────────────

test('createCodec: no args uses DEFAULT_CONFIG', t => {
    const codec = createCodec();
    t.deepEqual(codec.config, DEFAULT_CONFIG);
});

test('createCodec: exposes metaLength matching config', t => {
    const codec = createCodec();
    t.is(codec.metaLength, codec.config.metaLength);
});

test('createCodec: resolves partial config', t => {
    const codec = createCodec({ sessionLength: 8 });
    t.is(codec.config.sessionLength, 8);
});

test('createCodec: partial config keeps default checksum', t => {
    const codec = createCodec({ sessionLength: 8 });
    t.is(codec.config.checksum, 'crc16');
});

test('createCodec: resolved config is frozen', t => {
    const codec = createCodec();
    t.true(Object.isFrozen(codec.config));
});

// ── encodeText ───────────────────────────────────────────────────────────────

test('codec.encodeText: produces base36-only lines', t => {
    const codec = createCodec();
    const lines = codec.encodeText('Привет, мир!');
    t.true(lines.every(line => /^[0-9a-z]+$/.test(line)));
});

test('codec.encodeText: respects maxLen', t => {
    const codec = createCodec();
    const lines = codec.encodeText('x'.repeat(500), { maxLen: 40 });
    t.true(lines.every(line => line.length <= 40));
});

test('codec.encodeText: accepts explicit sessionId', t => {
    const codec = createCodec();
    const lines = codec.encodeText('hi', { sessionId: 'aaaaaa' });
    t.is(lines[0].slice(0, 6), 'aaaaaa');
});

// ── decodeText ───────────────────────────────────────────────────────────────

test('codec.decodeText: roundtrips ASCII', t => {
    const codec = createCodec();
    t.is(codec.decodeText(codec.encodeText('Hello, World!')), 'Hello, World!');
});

test('codec.decodeText: roundtrips Cyrillic', t => {
    const codec = createCodec();
    t.is(codec.decodeText(codec.encodeText('Привет, мир!')), 'Привет, мир!');
});

test('codec.decodeText: roundtrips multi-chunk', t => {
    const codec = createCodec();
    const text = 'Lorem ipsum dolor sit amet. '.repeat(50);
    t.is(codec.decodeText(codec.encodeText(text, { maxLen: 40 })), text);
});

// ── splitText / joinChunks ───────────────────────────────────────────────────

test('codec.splitText: session length matches config', t => {
    const codec = createCodec({ sessionLength: 8 });
    const chunks = codec.splitText('hello');
    t.is(chunks[0].session.length, 8);
});

test('codec.joinChunks: reassembles splitText output', t => {
    const codec = createCodec();
    const text = 'roundtrip check '.repeat(10);
    t.is(codec.joinChunks(codec.splitText(text, { maxLen: 40 })), text);
});

// ── parseChunk / formatChunk ─────────────────────────────────────────────────

test('codec.parseChunk: parses a line into a Chunk', t => {
    const codec = createCodec();
    const line = codec.encodeText('x')[0];
    t.is(codec.parseChunk(line).session.length, 6);
});

test('codec.formatChunk: serializes a Chunk into a line', t => {
    const codec = createCodec();
    const chunk = codec.splitText('x')[0];
    t.regex(codec.formatChunk(chunk), /^[a-z][0-9a-z]*$/);
});

test('codec.parseChunk / formatChunk: roundtrip', t => {
    const codec = createCodec();
    const original = codec.splitText('payload')[0];
    const parsed = codec.parseChunk(codec.formatChunk(original));
    t.deepEqual(parsed, original);
});

// ── chunksFromLines ──────────────────────────────────────────────────────────

test('codec.chunksFromLines: parses every line', t => {
    const codec = createCodec();
    const lines = codec.encodeText('x'.repeat(200), { maxLen: 40 });
    t.is(codec.chunksFromLines(lines).length, lines.length);
});

// ── analyzeLines / filters ───────────────────────────────────────────────────

test('codec.analyzeLines: reports ok on valid input', t => {
    const codec = createCodec();
    const lines = codec.encodeText('hello');
    t.true(codec.analyzeLines(lines).ok);
});

test('codec.completeSessions: returns complete sessions', t => {
    const codec = createCodec();
    const lines = codec.encodeText('hello');
    t.is(codec.completeSessions(codec.analyzeLines(lines)).length, 1);
});

test('codec.incompleteSessions: returns no incomplete sessions on valid input', t => {
    const codec = createCodec();
    const lines = codec.encodeText('hello');
    t.is(codec.incompleteSessions(codec.analyzeLines(lines)).length, 0);
});

test('codec.incompleteSessions: returns incomplete sessions on partial input', t => {
    const codec = createCodec();
    const lines = codec.encodeText('x'.repeat(200), { maxLen: 40 });
    t.is(codec.incompleteSessions(codec.analyzeLines(lines.slice(0, -1))).length, 1);
});

// ── generateSessionId ────────────────────────────────────────────────────────

test('codec.generateSessionId: matches configured sessionLength', t => {
    const codec = createCodec({ sessionLength: 8 });
    t.regex(codec.generateSessionId(), /^[a-z][0-9a-z]{7}$/);
});

// ── Config-mismatch isolation ────────────────────────────────────────────────

test('codec: different sessionLength configs are incompatible', t => {
    const a = createCodec({ sessionLength: 6 });
    const b = createCodec({ sessionLength: 8 });
    const lines = a.encodeText('hello');
    t.throws(() => b.decodeText(lines));
});

test('codec: crc16 codec cannot read crc8 lines', t => {
    const a = createCodec({ checksum: 'crc8' });
    const b = createCodec({ checksum: 'crc16' });
    const lines = a.encodeText('hello');
    t.throws(() => b.decodeText(lines));
});

test('codec: crc16 codec cannot read unchecked lines', t => {
    const a = createCodec({ checksum: 'none' });
    const b = createCodec({ checksum: 'crc16' });
    const lines = a.encodeText('hello');
    t.throws(() => b.decodeText(lines));
});

test('codec: config does not leak between instances', t => {
    const a = createCodec({ sessionLength: 6 });
    const b = createCodec({ sessionLength: 8 });
    t.not(a.config.sessionLength, b.config.sessionLength);
});

test('codec.analyzeItems: keeps items parallel to chunks', t => {
    const codec = createCodec();
    const lines = codec.encodeText('hello');
    const rows = lines.map((chunk, id) => ({ id, chunk }));
    const report = codec.analyzeItems(rows, { getLine: r => r.chunk });
    t.true(report.sessions[0].complete);
    t.deepEqual(
        report.sessions[0].items.map(r => r.id),
        [0]
    );
});

// ── crc8 round-trip ─────────────────────────────────────────────────────────

test('codec: crc8 metaLength is 16', t => {
    const codec = createCodec({ checksum: 'crc8' });
    t.is(codec.metaLength, 16);
});

test('codec: crc8 roundtrips ASCII', t => {
    const codec = createCodec({ checksum: 'crc8' });
    t.is(codec.decodeText(codec.encodeText('Hello, World!')), 'Hello, World!');
});

test('codec: crc8 roundtrips Cyrillic', t => {
    const codec = createCodec({ checksum: 'crc8' });
    t.is(codec.decodeText(codec.encodeText('Привет, мир!')), 'Привет, мир!');
});

test('codec: crc8 roundtrips multi-chunk', t => {
    const codec = createCodec({ checksum: 'crc8' });
    const text = 'Lorem ipsum dolor sit amet. '.repeat(50);
    t.is(codec.decodeText(codec.encodeText(text, { maxLen: 40 })), text);
});

test('codec: crc8 at maxLen 63 fits 30 bytes', t => {
    const codec = createCodec({ sessionLength: 6, checksum: 'crc8' });
    t.is(codec.splitText('x'.repeat(30), { maxLen: 63 }).length, 1);
});

test('codec: crc8 detects single-char payload substitution', t => {
    const codec = createCodec({ checksum: 'crc8' });
    const [head] = codec.encodeText('hello world, this is a test');
    const metaLength = codec.metaLength;
    const tampered =
        head.slice(0, metaLength + 3) +
        (head[metaLength + 3] === 'a' ? 'b' : 'a') +
        head.slice(metaLength + 4);
    t.throws(() => codec.decodeText([tampered]), { message: /Checksum mismatch/ });
});

test('codec: crc8 lines are rejected by crc16 codec', t => {
    const a = createCodec({ checksum: 'crc8' });
    const b = createCodec({ checksum: 'crc16' });
    t.throws(() => b.decodeText(a.encodeText('hello')));
});

test('codec.joinBytes: returns raw bytes', t => {
    const codec = createCodec();
    const bytes = new Uint8Array([0xff, 0x00]);
    const line = codec.formatChunk({ session: 'abcd12', index: 0, total: 1, bytes });
    t.deepEqual(codec.joinBytes(codec.chunksFromLines([line])), bytes);
});

test('codec.joinBytes: roundtrips multi-chunk binary', t => {
    const codec = createCodec();
    const payload = Uint8Array.from({ length: 200 }, (_, i) => (i * 7) & 0xff);
    const per = 29;
    const total = Math.ceil(payload.length / per);
    const chunks = Array.from({ length: total }, (_, i) => ({
        session: 'abcd12',
        index: i,
        total,
        bytes: payload.slice(i * per, (i + 1) * per),
    }));
    t.deepEqual(codec.joinBytes(chunks), payload);
});

test('DEFAULT_CONFIG is frozen', t => {
    t.throws(
        () => {
            /** @type {any} */ (DEFAULT_CONFIG).sessionLength = 8;
        },
        { instanceOf: TypeError }
    );
});

test('createCodec: config is frozen and stays in sync with metaLength', t => {
    const codec = createCodec({ checksum: 'crc8' });
    t.true(Object.isFrozen(codec.config));
    t.is(codec.metaLength, codec.config.metaLength);
    t.throws(
        () => {
            /** @type {any} */ (codec.config).checksum = 'crc16';
        },
        { instanceOf: TypeError }
    );
});

test('createCodec: caller object is not frozen in place', t => {
    const partial = { checksum: /** @type {const} */ ('crc8') };
    const codec = createCodec(partial);
    t.false(Object.isFrozen(partial));
    t.true(Object.isFrozen(codec.config));
});
