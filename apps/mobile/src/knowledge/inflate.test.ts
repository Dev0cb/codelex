import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { decodeBase64, InflateError, inflateRaw } from './inflate';

const deflate = (bytes: Uint8Array, level: number): Uint8Array =>
  new Uint8Array(deflateRawSync(bytes, { level }));
/** Byte equality without Jest's per-element diff (slow on large arrays). */
const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

describe('inflateRaw (RFC 1951)', () => {
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
