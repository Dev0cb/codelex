import { createHash } from 'node:crypto';

import fc from 'fast-check';
import { canonicalJson } from '@codelex/game-engine/canonical';
import { describe, expect, it } from 'vitest';

import { corpusDigest, escapeText, subsetOf } from './digest.js';

describe('corpus digest (ADR-0016 §D3.1)', () => {
  it('maps JSON values into the JCS subset as documented', () => {
    expect(subsetOf({ a: [true, false, null, 7, 'x~§'], 'k\n': '' })).toEqual({
      a: ['b:1', 'b:0', 'n:', 7, 's:x~007e~00a7'],
      'k~000a': 's:',
    });
  });

  it('is sha256(JCS(subset)) with the engine serialiser (oracle: node:crypto)', () => {
    const files = { 'b.json': { x: true }, 'a.json': [1, 'é'] };
    const text = canonicalJson(subsetOf(files));
    expect(text).toBe('{"a.json":[1,"s:~00e9"],"b.json":{"x":"b:1"}}');
    expect(corpusDigest(files)).toBe(createHash('sha256').update(text).digest('hex'));
  });

  it('is injective on strings: escapes never collide (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.string({ unit: 'binary' }), (a, b) => {
        fc.pre(a !== b);
        expect(escapeText(a)).not.toBe(escapeText(b));
      }),
      { seed: 16, numRuns: 500 },
    );
  });

  it('keeps a "__proto__" key as data', () => {
    const value: unknown = JSON.parse('{"__proto__":{"z":1}}');
    expect(canonicalJson(subsetOf(value))).toBe('{"__proto__":{"z":1}}');
  });

  it('rejects values outside JSON integers (a fraction needs a decision, not an encoding)', () => {
    expect(() => subsetOf(1.5)).toThrow(RangeError);
    expect(() => subsetOf(-0)).toThrow(RangeError);
    expect(() => subsetOf(undefined)).toThrow(TypeError);
  });
});
