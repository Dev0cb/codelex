import { createHash } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canonicalize } from '@codelex/lexicon/canonical';
import golden from '../../test/golden/jcs.json' with { type: 'json' };
import { JCS_MAX_DEPTH, canonicalJson, hash16 } from './jcs.js';
import { asciiBytes, sha256Hex } from './sha256.js';

/**
 * Independent RFC 8785 reference (ADR-0013 §D3 differential test): the lexicon's full JCS
 * (`packages/lexicon/scripts/canonical.mjs`, build-time only, never imported by engine code).
 * On the engine subset both must produce identical text.
 */
function reference(value: unknown): string {
  return canonicalize(value);
}

const printableChar = fc.integer({ min: 0x20, max: 0x7e }).map((c) => String.fromCharCode(c));
const asciiString = fc.string({ unit: printableChar, maxLength: 12 });
const keyString = fc.oneof(
  asciiString,
  fc.constantFrom('', '0', '1', '2', '10', '__proto__', 'constructor', 'toString'),
);
const safeInteger = fc
  .oneof(
    fc.integer({ min: -1000, max: 1000 }),
    fc.integer(),
    fc.maxSafeInteger(),
    fc.constantFrom(Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0),
  )
  .map((n) => (n === 0 ? 0 : n)); // normalise -0, which is outside the subset

const { jcsValue } = fc.letrec<{ jcsValue: unknown }>((tie) => ({
  jcsValue: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    safeInteger,
    asciiString,
    fc.array(tie('jcsValue'), { maxLength: 5 }),
    fc.dictionary(keyString, tie('jcsValue'), { maxKeys: 5 }),
  ),
}));

/** Tiny seeded LCG for the test only: `below(n)` is in [0, n). */
function lcg(seed: number): (n: number) => number {
  let s = seed >>> 0;
  return (n) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % n;
  };
}

/** Rebuilds `value` with every object's keys inserted in a seeded random order (same content). */
function permuteKeys(value: unknown, below: (n: number) => number): unknown {
  if (Array.isArray(value)) return value.map((v) => permuteKeys(v, below));
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    for (let i = entries.length - 1; i > 0; i--) {
      const j = below(i + 1);
      const tmp = entries[i]!;
      entries[i] = entries[j]!;
      entries[j] = tmp;
    }
    return Object.fromEntries(entries.map(([k, v]) => [k, permuteKeys(v, below)]));
  }
  return value;
}

function deepFreeze(value: unknown): unknown {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function nest(depth: number): unknown {
  let value: unknown = 0;
  for (let i = 0; i < depth; i++) value = i % 2 === 0 ? [value] : { k: value };
  return value;
}

describe('jcs golden vectors (ADR-0013 §D3, Appendix A.3)', () => {
  it('has the file format of ADR-0013 Appendix A', () => {
    expect(golden.format).toBe(1);
    expect(golden.algorithm).toBe('jcs-subset-1');
    expect(golden.cases.length).toBeGreaterThan(0);
    expect(golden.rejections.length).toBeGreaterThan(0);
  });

  it('transcribes Appendix A.3 exactly', () => {
    const a3 = golden.cases.find((c) => c.name === 'adr-0013-a3');
    expect(a3).toEqual({
      name: 'adr-0013-a3',
      input: '{"z":{"k":-7},"b":0,"a":[3,"?AE"]}',
      jcs: '{"a":[3,"?AE"],"b":0,"z":{"k":-7}}',
      sha256: '29cb9747b6a7224168208f209044e3d24573275df767bf9d09003cf5ef3ef7cb',
      hash16: '29cb9747b6a72241',
    });
  });

  for (const c of golden.cases) {
    it(`canonicalises and hashes "${c.name}"`, () => {
      const value: unknown = JSON.parse(c.input);
      const text = canonicalJson(value);
      expect(text).toBe(c.jcs);
      expect(sha256Hex(asciiBytes(text))).toBe(c.sha256);
      expect(hash16(value)).toBe(c.hash16);
      expect(c.sha256.startsWith(c.hash16)).toBe(true);
    });
  }

  for (const r of golden.rejections) {
    it(`rejects "${r.name}" with ${r.error}`, () => {
      const value: unknown = JSON.parse(r.input);
      const expected = r.error === 'TypeError' ? TypeError : RangeError;
      expect(() => canonicalJson(value)).toThrow(expected);
      expect(() => hash16(value)).toThrow(expected);
    });
  }
});

describe('canonicalJson accepts exactly the ADR-0013 §D3 subset', () => {
  it('accepts null-prototype objects and frozen values', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare['b'] = 1;
    bare['a'] = Object.freeze(['x']);
    expect(canonicalJson(Object.freeze(bare))).toBe('{"a":["x"],"b":1}');
  });

  it('treats "__proto__" as an ordinary own key', () => {
    const value: unknown = JSON.parse('{"__proto__":{"z":1},"a":2}');
    expect(canonicalJson(value)).toBe('{"__proto__":{"z":1},"a":2}');
  });

  it(`accepts nesting up to JCS_MAX_DEPTH = ${String(JCS_MAX_DEPTH)} (ADR-0013 §D4.8)`, () => {
    expect(JCS_MAX_DEPTH).toBe(64);
    expect(canonicalJson(nest(JCS_MAX_DEPTH))).toBe(reference(nest(JCS_MAX_DEPTH)));
    expect(() => canonicalJson(nest(JCS_MAX_DEPTH + 1))).toThrow(RangeError);
  });

  it('rejects cycles (through the depth bound) instead of overflowing the stack', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(RangeError);
    const loop: unknown[] = [];
    loop.push(loop);
    expect(() => canonicalJson(loop)).toThrow(RangeError);
  });

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['undefined member', { a: undefined }],
    ['undefined element', [1, undefined]],
    ['function', () => 0],
    ['symbol', Symbol('s')],
    ['bigint', BigInt(1)],
    ['boolean', true],
    ['null', null],
    [
      'object inheriting from a null-prototype object',
      Object.create(Object.create(null) as object),
    ],
    ['Map', new Map([['a', 1]])],
    ['Set', new Set([1])],
    ['RegExp', /a/],
    ['boxed string', Object('a')],
    ['boxed number', Object(1)],
    ['Uint8Array', new Uint8Array(2)],
    [
      'class instance',
      new (class Point {
        readonly x = 1;
      })(),
    ],
    ['Array subclass', new (class Tiles extends Array<number> {})()],
    ['array with an extra property', Object.assign([1], { extra: 2 })],
    ['symbol key', { [Symbol('s')]: 1 }],
    ['non-enumerable property', Object.defineProperty({}, 'hidden', { value: 1 })],
    ['symbol key on an array', Object.assign([1], { [Symbol('s')]: 2 })],
  ])('rejects %s with TypeError', (_name, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it('rejects accessor properties without running the getter (objects and array indices)', () => {
    let calls = 0;
    const getter = { get: () => ++calls, enumerable: true };
    const record = Object.defineProperty({ a: 1 }, 'g', getter);
    const items = Object.defineProperty([0, 1], 1, getter);
    const setterOnly = Object.defineProperty({}, 's', { set: () => undefined, enumerable: true });
    expect(() => canonicalJson(record)).toThrow(TypeError);
    expect(() => canonicalJson(record)).toThrow('accessor property (getter/setter) at $.g');
    expect(() => canonicalJson(items)).toThrow('accessor property (getter/setter) at $[1]');
    expect(() => canonicalJson(setterOnly)).toThrow(TypeError);
    expect(() => hash16({ nested: [record] })).toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it('rejects a hole even when an extra property balances the own-key count', () => {
    expect(() => canonicalJson(Object.assign([1, , 3], { x: 1 }))).toThrow(
      'sparse array (hole) at $[1]',
    );
  });

  it('rejects sparse arrays with TypeError', () => {
    expect(() => canonicalJson([1, , 3])).toThrow(TypeError);
    expect(() => canonicalJson(new Array(2))).toThrow(TypeError);
  });

  it.each<[string, unknown]>([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['-0', -0],
    ['fraction', 0.1],
    ['unsafe integer', 2 ** 53],
    ['non-ASCII', 'é'],
    ['lone surrogate', '\ud800'],
    ['non-ASCII key', { é: 1 }],
  ])('rejects %s with RangeError', (_name, value) => {
    expect(() => canonicalJson(value)).toThrow(RangeError);
  });

  it('locates the offending value in the error message', () => {
    expect(() => canonicalJson({ a: [0, { b: 1.5 }] })).toThrow('$.a[1].b');
    expect(() => canonicalJson({ 'x y': true })).toThrow('$["x y"]');
    expect(() => canonicalJson({ 'a"b\\c': [null] })).toThrow('$["a\\"b\\\\c"][0]');
    expect(() => canonicalJson(['ok', 'café'])).toThrow('$[1]');
    expect(() => canonicalJson({ ké: 1 })).toThrow('0xe9');
  });
});

describe('canonicalJson properties', () => {
  it('equals the key-sorted JSON.stringify reference on the subset (differential)', () => {
    fc.assert(
      fc.property(jcsValue, (value) => {
        expect(canonicalJson(value)).toBe(reference(value));
      }),
      { numRuns: 1000, seed: 0x00c0de1e },
    );
  });

  it('is independent of key insertion order', () => {
    fc.assert(
      fc.property(jcsValue, fc.integer(), (value, seed) => {
        expect(canonicalJson(permuteKeys(value, lcg(seed)))).toBe(canonicalJson(value));
      }),
      { numRuns: 300, seed: 0x00c0de1e },
    );
  });

  it('round-trips through JSON.parse and is idempotent', () => {
    fc.assert(
      fc.property(jcsValue, (value) => {
        const text = canonicalJson(value);
        const parsed: unknown = JSON.parse(text);
        // fc.dictionary may build null-prototype objects; JSON.parse never does, so compare as content.
        expect(parsed).toEqual(value);
        expect(reference(parsed)).toBe(reference(value));
        expect(canonicalJson(parsed)).toBe(text);
      }),
      { numRuns: 300, seed: 0x00c0de1e },
    );
  });

  it('never mutates its input (deeply frozen input, unchanged content)', () => {
    fc.assert(
      fc.property(jcsValue, (value) => {
        const before = reference(value);
        const frozen = deepFreeze(value);
        expect(canonicalJson(frozen)).toBe(before);
        hash16(frozen);
        expect(reference(frozen)).toBe(before);
      }),
      { numRuns: 200, seed: 0x00c0de1e },
    );
  });
});

describe('hash16', () => {
  it('is the first 16 lowercase hex of SHA-256 over the JCS text (node:crypto reference)', () => {
    fc.assert(
      fc.property(jcsValue, (value) => {
        const digest = createHash('sha256').update(reference(value), 'utf8').digest('hex');
        expect(hash16(value)).toBe(digest.slice(0, 16));
        expect(hash16(value)).toMatch(/^[0-9a-f]{16}$/);
      }),
      { numRuns: 300, seed: 0x00c0de1e },
    );
  });
});
