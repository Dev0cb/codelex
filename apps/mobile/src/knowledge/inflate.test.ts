import { deflateRawSync, inflateRawSync } from 'node:zlib';

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { decodeBase64, InflateError, inflateRaw } from './inflate';

const deflate = (bytes: Uint8Array, level: number): Uint8Array =>
  new Uint8Array(deflateRawSync(bytes, { level }));
/** Byte equality without Jest's per-element diff (slow on large arrays). */
const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

/** LSB-first DEFLATE bit writer (tests only). Huffman codes are written MSB first, as RFC 1951 §3.1.1 packs them. */
class BitWriter {
  private readonly bytes: number[] = [];
  private acc = 0;
  private count = 0;

  bits(value: number, n: number): void {
    for (let i = 0; i < n; i += 1) this.bit((value >> i) & 1);
  }

  code(code: number, len: number): void {
    for (let i = len - 1; i >= 0; i -= 1) this.bit((code >> i) & 1);
  }

  /** Pads to the byte boundary (stored blocks). */
  align(): void {
    while (this.count !== 0) this.bit(0);
  }

  byte(value: number): void {
    this.bytes.push(value & 255);
  }

  done(): Uint8Array {
    this.align();
    return new Uint8Array(this.bytes);
  }

  private bit(b: number): void {
    this.acc |= b << this.count;
    this.count += 1;
    if (this.count === 8) {
      this.bytes.push(this.acc);
      this.acc = 0;
      this.count = 0;
    }
  }
}

/** Canonical Huffman codes from code lengths (RFC 1951 §3.2.2). */
function canonicalCodes(lengths: readonly number[]): number[] {
  const counts = new Array<number>(16).fill(0);
  for (const len of lengths) if (len > 0) counts[len] = (counts[len] ?? 0) + 1;
  const next = new Array<number>(17).fill(0);
  let code = 0;
  for (let len = 1; len <= 15; len += 1) {
    code = (code + (counts[len - 1] ?? 0)) << 1;
    next[len] = code;
  }
  return lengths.map((len) => {
    if (len === 0) return 0;
    const c = next[len] ?? 0;
    next[len] = c + 1;
    return c;
  });
}

const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/**
 * A non-final dynamic block whose end-of-block code is 1 bit long while other literal codes reach 15 bits, then a
 * final stored block. Reading EOB with a 15-bit lookahead leaves whole bytes of the stored header in the bit buffer.
 */
function dynamicThenStored(stored: string): Uint8Array {
  const w = new BitWriter();
  w.bits(0, 1); // BFINAL = 0
  w.bits(2, 2); // BTYPE = dynamic
  const litLengths = new Array<number>(257).fill(0);
  litLengths[256] = 1; // EOB: 1 bit
  // 'A'..'N' get lengths 2..15 and 'O' a second 15: with EOB the code is complete (Kraft sum 1).
  for (let i = 0; i < 14; i += 1) litLengths[65 + i] = i + 2;
  litLengths[79] = 15;
  const distLengths = [1]; // a single distance code (unused)
  w.bits(0, 5); // HLIT = 257
  w.bits(0, 5); // HDIST = 1
  w.bits(15, 4); // HCLEN = 19
  // Code-length alphabet: symbols 0..15 at 4 bits each (complete), 16..18 unused.
  const clLengths = Array.from({ length: 19 }, (_, s) => (s < 16 ? 4 : 0));
  for (const s of CODE_LENGTH_ORDER) w.bits(clLengths[s] ?? 0, 3);
  const clCodes = canonicalCodes(clLengths);
  for (const len of [...litLengths, ...distLengths]) w.code(clCodes[len] ?? 0, 4);
  const litCodes = canonicalCodes(litLengths);
  for (const sym of [65, 79, 66]) w.code(litCodes[sym] ?? 0, litLengths[sym] ?? 0); // "AOB"
  w.code(litCodes[256] ?? 0, 1);
  w.bits(1, 1); // BFINAL = 1
  w.bits(0, 2); // BTYPE = stored
  w.align();
  const data = Buffer.from(stored, 'latin1');
  w.byte(data.length);
  w.byte(data.length >> 8);
  w.byte(~data.length);
  w.byte(~data.length >> 8);
  for (const b of data) w.byte(b);
  return w.done();
}

describe('inflateRaw (RFC 1951)', () => {
  it('reads a stored block after a Huffman block that buffered whole bytes ahead (review M1)', () => {
    const stream = dynamicThenStored('Knowledge Card');
    const expected = new Uint8Array(inflateRawSync(stream));
    expect(Buffer.from(expected).toString('latin1')).toBe('AOBKnowledge Card');
    expect(same(inflateRaw(stream), expected)).toBe(true);
    expect(same(inflateRaw(stream, expected.length), expected)).toBe(true);
  });

  it('restores what zlib deflates, at every level (stored, fixed and dynamic blocks)', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 3000 }),
        fc.integer({ min: 0, max: 9 }),
        (bytes, level) => {
          expect(inflateRaw(deflate(bytes, level))).toEqual(bytes);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('restores repetitive text (long matches and distances)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), fc.integer({ min: 1, max: 2000 }), (s, n) => {
        const bytes = new Uint8Array(Buffer.from(s.repeat(n), 'utf8'));
        expect(same(inflateRaw(deflate(bytes, 9)), bytes)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('restores an input spanning several stored blocks (> 64 KiB at level 0)', () => {
    const bytes = new Uint8Array(150_000).map((_, i) => (i * 31) % 251);
    expect(same(inflateRaw(deflate(bytes, 0)), bytes)).toBe(true);
    expect(same(inflateRaw(deflate(bytes, 0), bytes.length), bytes)).toBe(true);
  });

  it('rejects truncated, corrupt and over-long input with a typed error, never hangs', () => {
    const good = deflate(new Uint8Array(Buffer.from('knowledge card '.repeat(200))), 9);
    expect(() => inflateRaw(good.subarray(0, good.length >> 1))).toThrow(InflateError);
    expect(() => inflateRaw(new Uint8Array([0x07]))).toThrow(InflateError); // block type 3
    expect(() => inflateRaw(new Uint8Array([0x01, 0x05, 0x00, 0x00, 0x00]))).toThrow(InflateError); // stored LEN/NLEN mismatch
    expect(() => inflateRaw(new Uint8Array())).toThrow(InflateError);
    expect(() => inflateRaw(good, 10)).toThrow(InflateError);
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 200 }), (noise) => {
        try {
          inflateRaw(noise, 1 << 16);
        } catch (error) {
          expect(error).toBeInstanceOf(InflateError);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('decodeBase64', () => {
  it('decodes what Buffer encodes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 500 }), (bytes) => {
        expect(decodeBase64(Buffer.from(bytes).toString('base64'))).toEqual(bytes);
      }),
    );
  });

  it('rejects characters outside the alphabet and impossible lengths', () => {
    expect(() => decodeBase64('ab$=')).toThrow(InflateError);
    expect(() => decodeBase64('abcde')).toThrow(InflateError);
    expect(() => decodeBase64('a===')).toThrow(InflateError);
  });
});
