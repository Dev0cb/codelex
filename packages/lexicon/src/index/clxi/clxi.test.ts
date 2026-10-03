import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  GLOBAL_PROFILE,
  computeLexiconVersion,
  lexiconContentDocument,
  profileDefinitionHash,
} from '../../../scripts/canonical.mjs';
import { loadLexicon } from '../../../scripts/validate.mjs';
import { relationTypesOf } from '../constants.js';
import { decodeLexiconIndex } from '../decode.js';
import { createReferenceIndex, type ReferenceTermInput } from '../reference.js';
import type {
  CategoryId,
  FormRef,
  LetterCode,
  LexiconIndex,
  LexiconVersion,
  TermRef,
} from '../types.js';
import { buildDawg, buildLexiconIndex, type LexiconBuildInput } from './build.js';
import { crc32 } from './crc32.js';
import { CRC_OFFSET, popcount } from './format.js';

// --- inputs ------------------------------------------------------------------------------------------------

const lex = loadLexicon();
const REAL: LexiconBuildInput = {
  version: computeLexiconVersion(lex),
  profile: {
    id: GLOBAL_PROFILE.id,
    kind: 'global',
    definitionHash: profileDefinitionHash(GLOBAL_PROFILE),
  },
  document: lexiconContentDocument(lex),
  blocklist: [...lex.blocklist],
};

function term(
  id: string,
  form: string,
  extra: Partial<ReferenceTermInput> = {},
): ReferenceTermInput {
  return {
    id,
    playable: true,
    form,
    difficulty: 'advanced',
    categories: ['devops'],
    inflections: [],
    relations: [],
    gameValue: 10,
    knowledgeXp: 20,
    ...extra,
  };
}

const FIXTURE: LexiconBuildInput = {
  version: '0123456789abcdef',
  profile: { id: 'global-ranked', kind: 'global', definitionHash: 'fedcba9876543210' },
  document: {
    terms: [
      term('pod', 'POD', {
        categories: ['devops', 'cloud'],
        inflections: [{ form: 'PODS', kind: 'plural' }],
        relations: [{ type: 'part_of', target: 'kubernetes' }],
      }),
      term('kubernetes', 'KUBERNETES', { difficulty: 'expert', categories: ['cloud', 'devops'] }),
      term('ai', 'AI', {
        difficulty: 'novice',
        categories: ['ai'],
        relations: [{ type: 'uses', target: 'ip' }],
      }),
      term('ip', 'IP', { difficulty: 'novice', categories: ['networking'] }),
      term('container', 'CONTAINER', {
        inflections: [{ form: 'CONTAINERS', kind: 'plural' }],
        relations: [
          { type: 'related_to', target: 'pod' },
          { type: 'runs_on', target: 'kubernetes' },
        ],
      }),
      { id: 'legacy', playable: false, categories: ['devops'], inflections: [], relations: [] },
    ],
  },
};

const OPTIONS = { formatVersion: 1, gaddag: false } as const;

/** The L3 reference index of a build input (the oracle). */
const referenceOf = (input: LexiconBuildInput): LexiconIndex =>
  createReferenceIndex({
    version: input.version as LexiconVersion,
    profile: input.profile as LexiconIndex['profile'],
    document: input.document,
  });

function built(input: LexiconBuildInput): Uint8Array {
  const r = buildLexiconIndex(input, OPTIONS);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

function decoded(bytes: Uint8Array): LexiconIndex {
  const r = decodeLexiconIndex(bytes);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

const codesOf = (s: string): number[] =>
  Array.from({ length: s.length }, (_, i) => s.charCodeAt(i) - 65);

/** Recomputes the CRC so that structural checks (not the checksum) are exercised. */
function withCrc(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(
    CRC_OFFSET,
    crc32(bytes, CRC_OFFSET + 4, bytes.length, crc32(bytes, 0, CRC_OFFSET, 0)),
    true,
  );
  return bytes;
}

// --- T-ORACLE ----------------------------------------------------------------------------------------------

function expectSameIndex(binary: LexiconIndex, reference: LexiconIndex): void {
  expect(binary.formatVersion).toBe(1);
  expect(binary.gaddag).toBeUndefined();
  expect([binary.version, binary.size, binary.termCount, binary.maxFormLength]).toEqual([
    reference.version,
    reference.size,
    reference.termCount,
    reference.maxFormLength,
  ]);
  expect(binary.profile).toEqual(reference.profile);
  expect(binary.categories()).toEqual(reference.categories());
  expect([...binary.letterCounts()]).toEqual([...reference.letterCounts()]);
  for (let f = 0; f < reference.size; f += 1) {
    const form = f as FormRef;
    const meta = reference.formMeta(form);
    expect(binary.formMeta(form)).toEqual(meta);
    expect(binary.lookup(meta.form)).toBe(form);
    expect(binary.has(meta.form)).toBe(true);
    expect(binary.lookupCodes(codesOf(`Z${meta.form}Z`), 1, meta.form.length + 1)).toBe(form);
    expect(binary.termOf(form)).toBe(reference.termOf(form));
  }
  for (let t = 0; t < reference.termCount; t += 1) {
    const termRef = t as TermRef;
    expect(binary.meta(termRef)).toEqual(reference.meta(termRef));
    expect(binary.difficulty(termRef)).toBe(reference.difficulty(termRef));
    expect(binary.neighbours(termRef)).toEqual(reference.neighbours(termRef));
    for (const c of reference.categories()) {
      expect(binary.inCategory(termRef, c)).toBe(reference.inCategory(termRef, c));
    }
    for (const n of reference.neighbours(termRef)) {
      expect(binary.related(termRef, n)).toBe(reference.related(termRef, n));
    }
  }
}

describe('binary index ≡ reference index (T-ORACLE, T-COMPLETE)', () => {
  it('fixture', () => {
    expectSameIndex(decoded(built(FIXTURE)), referenceOf(FIXTURE));
  });

  it('real lexicon data', () => {
    expectSameIndex(decoded(built(REAL)), referenceOf(REAL));
  });

  it('T-SOUND / T-REL / crossCheck: random strings, edits, pairs and contexts agree with the reference', () => {
    const binary = decoded(built(REAL));
    const reference = referenceOf(REAL);
    const forms = Array.from(
      { length: reference.size },
      (_, i) => reference.formMeta(i as FormRef).form,
    );
    const letters = fc.string({
      unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
      maxLength: 17,
    });
    fc.assert(
      fc.property(
        letters,
        fc.constantFrom(...forms),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: reference.termCount - 1 }),
        fc.integer({ min: 0, max: reference.termCount - 1 }),
        (random, form, cut, a, b) => {
          for (const s of [
            random,
            form + random,
            form.slice(0, cut),
            form.slice(cut),
            random + form,
          ]) {
            expect(binary.has(s)).toBe(reference.has(s));
            expect(binary.lookup(s)).toBe(reference.lookup(s));
          }
          const before = codesOf(form.slice(0, cut % (form.length + 1)));
          const after = codesOf(form.slice((cut % (form.length + 1)) + 1));
          expect(binary.crossCheck(before, after)).toBe(reference.crossCheck(before, after));
          expect(binary.crossCheck(codesOf(random.slice(0, 3)), [])).toBe(
            reference.crossCheck(codesOf(random.slice(0, 3)), []),
          );
          expect(binary.related(a as TermRef, b as TermRef)).toBe(
            reference.related(a as TermRef, b as TermRef),
          );
        },
      ),
      { seed: 4242, numRuns: 2000 },
    );
  });
});

describe('queries (T-INPUT, contract edge cases)', () => {
  const index = decoded(built(FIXTURE));

  it.each([
    '',
    'A',
    'P',
    'AAAAAAAAAAAAAAAA',
    'pod',
    'P0D',
    'ÉCOLE',
    'İP',
    '\u{1F600}AI',
    'PODSS',
    'PO',
  ])('has(%j) is false and never throws', (s) => {
    expect(index.has(s)).toBe(false);
    expect(index.lookup(s)).toBeUndefined();
  });

  it('rejects non-strings, bad code ranges and bad codes without throwing', () => {
    expect(index.has(42 as unknown as string)).toBe(false);
    const ai = codesOf('AI');
    expect(index.lookupCodes(ai, -1, 2)).toBeUndefined();
    expect(index.lookupCodes(ai, 1, 0)).toBeUndefined();
    expect(index.lookupCodes(ai, 0, 3)).toBeUndefined();
    expect(index.lookupCodes(ai, 0.5, 2)).toBeUndefined();
    expect(index.lookupCodes([0, 26], 0, 2)).toBeUndefined();
    expect(index.lookupCodes([0, 1.5] as LetterCode[], 0, 2)).toBeUndefined();
    expect(index.lookupCodes([0, Number.NaN], 0, 2)).toBeUndefined();
    expect(index.crossCheck([99], [])).toBe(0);
    expect(index.crossCheck(codesOf('ABCDEFGHIJKLMNO'), [])).toBe(0);
    expect(index.crossCheck(codesOf('PO'), [])).toBe(1 << 3); // POD
  });

  it('throws RangeError for refs outside the index; related(a, a) = 0; inCategory of an unknown id', () => {
    expect(() => index.meta(99 as TermRef)).toThrow(RangeError);
    expect(() => index.difficulty(-1 as TermRef)).toThrow(RangeError);
    expect(() => index.formMeta(1.5 as FormRef)).toThrow(RangeError);
    expect(() => index.termOf(99 as FormRef)).toThrow(RangeError);
    expect(() => index.neighbours(99 as TermRef)).toThrow(RangeError);
    expect(() => index.related(0 as TermRef, 99 as TermRef)).toThrow(RangeError);
    expect(index.related(0 as TermRef, 0 as TermRef)).toBe(0);
    expect(index.inCategory(0 as TermRef, 'nope' as CategoryId)).toBe(false);
  });

  it('memoises frozen metadata; letterCounts is a fresh copy (T-ORACLE)', () => {
    expect(index.meta(0 as TermRef)).toBe(index.meta(0 as TermRef));
    expect(Object.isFrozen(index.meta(0 as TermRef))).toBe(true);
    expect(index.formMeta(0 as FormRef)).toBe(index.formMeta(0 as FormRef));
    const counts = index.letterCounts() as Uint32Array;
    counts[0] = 999;
    expect(index.letterCounts()[0]).not.toBe(999);
    expect(Object.isFrozen(index)).toBe(true);
  });
});

// --- T-DETERMINISM, T-ROUNDTRIP, DAWG minimality -----------------------------------------------------------

/** Rebuilds a canonical document from a decoded index (model(decode(bytes))). */
function documentOf(index: LexiconIndex): LexiconBuildInput['document'] {
  const terms: ReferenceTermInput[] = [];
  for (let t = 0; t < index.termCount; t += 1) {
    const meta = index.meta(t as TermRef);
    const inflections = [];
    for (let f = 0; f < index.size; f += 1) {
      const fm = index.formMeta(f as FormRef);
      if (fm.term === t && fm.kind !== 'canonical')
        inflections.push({ form: fm.form, kind: fm.kind });
    }
    terms.push({
      id: meta.id,
      playable: true,
      form: meta.form,
      difficulty: meta.difficulty,
      categories: meta.categories,
      inflections,
      relations: index.neighbours(t as TermRef).flatMap((n) =>
        relationTypesOf(index.related(t as TermRef, n)).map((type) => ({
          type,
          target: index.meta(n).id,
        })),
      ),
      gameValue: meta.gameValue,
      knowledgeXp: meta.knowledgeXp,
    });
  }
  return { terms };
}

describe('build determinism and round trip (T-DETERMINISM, T-ROUNDTRIP)', () => {
  it('same input ⇒ same bytes; term and array order do not matter', () => {
    const a = built(REAL);
    expect(built(REAL)).toEqual(a);
    const shuffled = [...REAL.document.terms].reverse().map((t) => ({
      ...t,
      inflections: [...t.inflections].reverse(),
      relations: [...t.relations].reverse(),
    }));
    expect(built({ ...REAL, document: { terms: shuffled } })).toEqual(a);
  });

  it('golden pin: the fixture artefact keeps its CRC-32 and size (format 1 is frozen once published)', () => {
    const bytes = built(FIXTURE);
    expect(new DataView(bytes.buffer).getUint32(CRC_OFFSET, true)).toMatchInlineSnapshot(
      `3840568987`,
    );
    expect(bytes.length).toMatchInlineSnapshot(`1048`);
  });

  it('encode(model(decode(bytes))) = bytes', () => {
    for (const input of [FIXTURE, REAL]) {
      const bytes = built(input);
      const again = built({ ...input, document: documentOf(decoded(bytes)) });
      expect(again).toEqual(bytes);
    }
  });

  it('the DAWG is minimal and numbered root-first', () => {
    const forms = Array.from(
      { length: referenceOf(REAL).size },
      (_, i) => referenceOf(REAL).formMeta(i as FormRef).form,
    );
    const dawg = buildDawg(forms);
    const signatures = new Set<string>();
    for (let n = 0; n < dawg.nodeCount; n += 1) {
      const word = dawg.nodes[n * 2] ?? 0;
      const first = dawg.nodes[n * 2 + 1] ?? 0;
      const targets = Array.from(
        { length: popcount(word & 0x03ffffff) },
        (_, k) => dawg.edges[(first + k) * 2],
      );
      signatures.add(`${String(word)}|${targets.join(',')}`);
    }
    expect(signatures.size).toBe(dawg.nodeCount);
    expect(dawg.edgeCount).toBeLessThan(forms.join('').length);
  });
});

// --- build errors ------------------------------------------------------------------------------------------

describe('buildLexiconIndex errors (T-BLOCKLIST, limits)', () => {
  const code = (input: LexiconBuildInput, options: unknown = OPTIONS): unknown => {
    const r = buildLexiconIndex(input, options as typeof OPTIONS);
    return r.ok ? 'ok' : r.error.code;
  };
  const withTerms = (terms: ReferenceTermInput[]): LexiconBuildInput => ({
    ...FIXTURE,
    document: { terms },
  });

  it('BLOCKLISTED_FORM names the form', () => {
    const r = buildLexiconIndex({ ...FIXTURE, blocklist: ['PODS'] }, OPTIONS);
    expect(r.ok ? undefined : r.error).toMatchObject({
      code: 'BLOCKLISTED_FORM',
      details: { form: 'PODS' },
    });
  });

  it.each<[string, LexiconBuildInput, unknown?]>([
    ['VALIDATION_FAILED', { ...FIXTURE, version: 'nope' }],
    ['VALIDATION_FAILED', { ...FIXTURE, profile: { ...FIXTURE.profile, definitionHash: 'x' } }],
    ['VALIDATION_FAILED', { ...FIXTURE, profile: { ...FIXTURE.profile, id: 'has space' } }],
    [
      'UNKNOWN_PROFILE_REFERENCE',
      { ...FIXTURE, profile: { ...FIXTURE.profile, kind: 'team' as 'org' } },
    ],
    ['VALIDATION_FAILED', withTerms([term('a', 'POD'), term('b', 'POD')])],
    ['EMPTY_PROFILE', withTerms([])],
    [
      'LIMIT_EXCEEDED',
      withTerms(
        Array.from({ length: 33 }, (_, i) =>
          term(
            `t${String(i)}`,
            `P${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.charAt(i % 26)}${'ABC'.charAt(Math.floor(i / 26))}`,
            { categories: [`c${String(i)}`] },
          ),
        ),
      ),
    ],
    ['LIMIT_EXCEEDED', withTerms([term('é', 'POD')])],
    ['LIMIT_EXCEEDED', withTerms([term('a', 'POD', { categories: ['dévops'] })])],
    ['LIMIT_EXCEEDED', withTerms([term('a', 'POD', { gameValue: 70000 })])],
    ['LIMIT_EXCEEDED', FIXTURE, { formatVersion: 1, gaddag: true }],
    ['LIMIT_EXCEEDED', FIXTURE, { formatVersion: 2, gaddag: false }],
  ])('%s', (expected, input, options) => {
    expect(code(input, options ?? OPTIONS)).toBe(expected);
  });

  it('a non-RangeError from the source is reported as VALIDATION_FAILED', () => {
    const r = buildLexiconIndex(
      withTerms([{ ...term('a', 'POD'), relations: null as never }]),
      OPTIONS,
    );
    expect(r.ok ? undefined : r.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'invalid source',
    });
  });
});

// --- decoding: T-VERSION, T-CORRUPT ----------------------------------------------------------------------

describe('decodeLexiconIndex format 1 (T-VERSION, T-CORRUPT)', () => {
  const bytes = built(FIXTURE);
  const errorOf = (b: Uint8Array): string => {
    const r = decodeLexiconIndex(b);
    return r.ok ? 'ok' : r.error.code;
  };

  it('T-VERSION: expect mismatches are typed errors; matching expectations decode', () => {
    expect(
      decodeLexiconIndex(bytes, { version: 'ffffffffffffffff' as LexiconVersion }),
    ).toMatchObject({
      error: {
        code: 'VERSION_MISMATCH',
        details: { expected: 'ffffffffffffffff', actual: FIXTURE.version },
      },
    });
    expect(decodeLexiconIndex(bytes, { profileId: 'season-s01' })).toMatchObject({
      error: { code: 'PROFILE_MISMATCH', details: { actual: 'global-ranked' } },
    });
    expect(
      decodeLexiconIndex(bytes, {
        version: FIXTURE.version as LexiconVersion,
        profileId: 'global-ranked',
      }).ok,
    ).toBe(true);
  });

  it('decodes from an unaligned view (one copy)', () => {
    const backing = new Uint8Array(bytes.length + 3);
    backing.set(bytes, 3);
    expect(decoded(backing.subarray(3)).has('POD')).toBe(true);
  });

  it('every truncation is an error, never a throw', () => {
    for (let length = 0; length < bytes.length; length += 1) {
      expect(errorOf(bytes.slice(0, length))).not.toBe('ok');
    }
  });

  it('any single flipped bit is detected (CRC-32)', () => {
    for (let i = 0; i < bytes.length; i += 1) {
      for (const bit of [0, 7]) {
        const copy = bytes.slice();
        copy[i] = (copy[i] ?? 0) ^ (1 << bit);
        expect(errorOf(copy), `byte ${String(i)} bit ${String(bit)}`).not.toBe('ok');
      }
    }
  });

  it('structural checks behind the CRC: random corruptions with a valid CRC never throw', () => {
    const forms = ['POD', 'PODS', 'AI', 'IP', 'KUBERNETES', 'CONTAINER', 'CONTAINERS', 'ZZ'];
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.integer({ min: 0, max: bytes.length - 1 }), fc.integer({ min: 0, max: 255 })),
          {
            minLength: 1,
            maxLength: 4,
          },
        ),
        (edits) => {
          const copy = bytes.slice();
          for (const [at, value] of edits) {
            if (at < CRC_OFFSET || at >= CRC_OFFSET + 4) copy[at] = value;
          }
          const r = decodeLexiconIndex(withCrc(copy));
          if (!r.ok) return;
          // If it still decodes, every query stays total.
          for (const f of forms) {
            const ref = r.value.lookup(f);
            if (ref !== undefined) r.value.meta(r.value.termOf(ref));
          }
          for (let t = 0; t < r.value.termCount; t += 1) r.value.neighbours(t as TermRef);
        },
      ),
      { seed: 99, numRuns: 3000 },
    );
  });

  it.each<[string, (view: DataView, b: Uint8Array) => void]>([
    [
      'flags',
      (v) => {
        v.setUint16(6, 1, true);
      },
    ],
    ['lexiconVersion', (_v, b) => (b[8] = 0x47)],
    ['definitionHash', (_v, b) => (b[24] = 0x20)],
    ['profile kind', (_v, b) => (b[40] = 3)],
    [
      'reserved',
      (v) => {
        v.setUint16(42, 1, true);
      },
    ],
    [
      'section count',
      (v) => {
        v.setUint32(48, 12, true);
      },
    ],
    [
      'section META',
      (v) => {
        v.setUint32(56, 57, true);
      },
    ],
    [
      'META',
      (v) => {
        v.setUint32(60, 24, true);
      },
    ],
    ['maxFormLength', (_v, b) => (b[41] = 14)],
  ])('CORRUPT: %s', (what, edit) => {
    const copy = bytes.slice();
    edit(new DataView(copy.buffer), copy);
    const r = decodeLexiconIndex(withCrc(copy));
    expect(r.ok ? undefined : r.error).toMatchObject({ code: 'CORRUPT', details: { what } });
  });
});

// --- budgets: size gate and has() speed (lexicon-index note §5) --------------------------------------------

// The has() speed gate runs on the compiled dist/ without coverage instrumentation: test/index-speed.test.mjs.
describe('budgets (lexicon-index note §5)', () => {
  const bytes = built(REAL);
  const index = decoded(bytes);

  it('size gate: ≤ 0.55 MB for ≤ 2,000 forms, ≤ 128 bytes per form', () => {
    expect(index.size).toBeLessThanOrEqual(2000);
    expect(bytes.length).toBeLessThanOrEqual(550_000);
    expect(bytes.length / index.size).toBeLessThanOrEqual(128);
  });
});
