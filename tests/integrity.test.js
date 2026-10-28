// @ts-check

import test from 'ava';
import { createCodec } from '../src/codec.js';

test('createCodec: default codec roundtrips', t => {
    const codec = createCodec();
    t.is(codec.decodeText(codec.encodeText('hello')), 'hello');
});

test('createCodec: unchecked at maxLen 63 fits 30 bytes', t => {
    const codec = createCodec({ sessionLength: 8, checksum: 'none' });
    t.is(codec.splitText('x'.repeat(30), { maxLen: 63 }).length, 1);
});

test('createCodec: crc16 at maxLen 63 fits 29 bytes', t => {
    const codec = createCodec({ sessionLength: 6, checksum: 'crc16' });
    t.is(codec.splitText('x'.repeat(29), { maxLen: 63 }).length, 1);
});

test('createCodec: detects single-char payload substitution', t => {
    const codec = createCodec();
    const lines = codec.encodeText('hello world, this is a test');
    const [head] = lines;
    const metaLen = codec.metaLen;
    const tampered =
        head.slice(0, metaLen + 3) +
        (head[metaLen + 3] === 'a' ? 'b' : 'a') +
        head.slice(metaLen + 4);
    t.throws(() => codec.decodeText([tampered]), { message: /Checksum mismatch/ });
});

test('createCodec: v1 data still decodable via legacy codec', t => {
    const v1 = createCodec({ sessionLength: 8, checksum: 'none' });
    const lines = v1.encodeText('legacy');
    t.is(v1.decodeText(lines), 'legacy');
});

test('createCodec: v1 lines rejected by default codec', t => {
    const v1 = createCodec({ sessionLength: 8, checksum: 'none' });
    const lines = v1.encodeText('legacy');
    const v2 = createCodec();
    t.throws(() => v2.decodeText(lines));
});

test('createCodec: 29-byte payload fits in 63-char line', t => {
    const codec = createCodec();
    const lines = codec.encodeText('x'.repeat(29), { bytesPerChunk: 29 });
    t.is(lines.length, 1);
    t.true(lines[0].length <= 63);
});
