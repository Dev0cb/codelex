import { createHash } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import golden from '../../test/golden/sha256.json' with { type: 'json' };
import { asciiBytes, sha256, sha256Hex, toHex } from './sha256.js';

/** Reference digest from Node's OpenSSL binding (test-only: the engine itself never uses node:crypto). */
function nodeSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('sha256 golden vectors (ADR-0013 §D3, FIPS 180-4 / NIST CAVP)', () => {
  it('has the file format of ADR-0013 Appendix A', () => {
    expect(golden.format).toBe(1);
    expect(golden.algorithm).toBe('sha-256');
    expect(golden.cases.map((c) => c.name)).toEqual([
      'empty',
      'abc',
      '448-bit',
      '896-bit',
      'one million a',
    ]);
  });

  for (const c of golden.cases) {
    it(`hashes "${c.name}"`, () => {
      const bytes = asciiBytes(c.input.repeat(c.count));
      expect(sha256Hex(bytes)).toBe(c.digest);
      expect(toHex(sha256(bytes))).toBe(c.digest);
    });
  }
});

describe('sha256', () => {
  it('returns a fresh 32-byte digest and never mutates its input', () => {
    const input = asciiBytes('abc');
    const copy = Uint8Array.from(input);
    const digest = sha256(input);
    expect(digest).toBeInstanceOf(Uint8Array);
    expect(digest.length).toBe(32);
    expect(input).toEqual(copy);
    expect(sha256(input)).not.toBe(digest);
  });

  it('agrees with node:crypto around every padding boundary (0..200 bytes)', () => {
    for (let len = 0; len <= 200; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 31 + len) & 0xff;
      expect(sha256Hex(bytes), `length ${String(len)}`).toBe(nodeSha256(bytes));
    }
  });

  it('agrees with node:crypto on arbitrary byte strings (differential property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1100 }), (bytes) => {
        expect(sha256Hex(bytes)).toBe(nodeSha256(bytes));
      }),
      { numRuns: 300 },
    );
  });
});

describe('asciiBytes', () => {
  it('encodes ASCII one byte per code unit (UTF-8 of an ASCII string)', () => {
    expect(Array.from(asciiBytes('A:z~\u0000\u007f'))).toEqual([65, 58, 122, 126, 0, 127]);
  });

  it('round-trips with Buffer for every ASCII string', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.integer({ min: 0, max: 127 }).map((c) => String.fromCharCode(c)) }),
        (s) => {
          expect(Buffer.from(asciiBytes(s))).toEqual(Buffer.from(s, 'ascii'));
        },
      ),
    );
  });

  it('throws on any non-ASCII code unit (engine strings are ASCII, ADR-0013 §D4.5)', () => {
    expect(() => asciiBytes('café')).toThrow(RangeError);
    expect(() => asciiBytes('\u{1F600}')).toThrow(RangeError);
  });
});

describe('toHex', () => {
  it('writes lowercase, zero-padded hex', () => {
    expect(toHex(Uint8Array.of(0, 1, 15, 16, 171, 255))).toBe('00010f10abff');
    expect(toHex(new Uint8Array(0))).toBe('');
  });
});
