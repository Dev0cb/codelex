import { Buffer } from 'node:buffer';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { formatPath } from './issues.js';
import {
  canonicalOrUndefined,
  isCanonicalisable,
  jcsInteger,
  jcsValue,
  utf8ByteLength,
} from './jcs.js';

describe('JCS subset building blocks (ADR-0013 §D3)', () => {
  it('canonicalises with the engine serialiser and reports values outside the subset', () => {
    expect(canonicalOrUndefined({ z: { k: -7 }, b: 0, a: [3, '?AE'] })).toBe(
      '{"a":[3,"?AE"],"b":0,"z":{"k":-7}}',
    );
    expect(canonicalOrUndefined({ a: true })).toBeUndefined();
    expect(isCanonicalisable([1, 'x'])).toBe(true);
    expect(isCanonicalisable(0.5)).toBe(false);
  });

  it('accepts exactly the safe integers other than -0', () => {
    expect(jcsInteger.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true);
    expect(jcsInteger.safeParse(-Number.MAX_SAFE_INTEGER).success).toBe(true);
    expect(jcsInteger.safeParse(-0).success).toBe(false);
    expect(jcsInteger.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
    expect(jcsInteger.safeParse(Number.NaN).success).toBe(false);
  });

  it('jcsValue agrees with the engine serialiser on JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), (value) => {
        expect(jcsValue.safeParse(value).success).toBe(isCanonicalisable(value));
      }),
      { seed: 20261007, numRuns: 300 },
    );
  });

  it('counts UTF-8 bytes like Node does', () => {
    expect(utf8ByteLength('')).toBe(0);
    expect(utf8ByteLength('aé€\u{1f600}')).toBe(1 + 2 + 3 + 4);
    expect(utf8ByteLength('\ud800')).toBe(3);
    expect(utf8ByteLength('\ud800x')).toBe(4);
    expect(utf8ByteLength('\udc00')).toBe(3);
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 64 }), (text) => {
        expect(utf8ByteLength(text)).toBe(Buffer.byteLength(text, 'utf8'));
      }),
      { seed: 20261007, numRuns: 300 },
    );
  });

  it('formats issue paths', () => {
    expect(formatPath([])).toBe('$');
    expect(formatPath(['suites', 2, 'cases', 0, 'observed'])).toBe('$.suites[2].cases[0].observed');
    expect(formatPath(['timings', 'replays/v1'])).toBe('$.timings["replays/v1"]');
    expect(formatPath(['x', 'a"b\\c'])).toBe('$.x["a\\"b\\\\c"]');
    expect(formatPath([Symbol.for('s')])).toBe('$["Symbol(s)"]');
  });
});
