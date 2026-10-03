import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  GLOBAL_PROFILE,
  computeLexiconVersion,
  lexiconContentDocument,
  profileDefinitionHash,
} from '../../../scripts/canonical.mjs';
import { loadLexicon } from '../../../scripts/validate.mjs';
import { GADDAG_SEPARATOR, relationTypesOf } from '../constants.js';
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
import { Buffer } from 'node:buffer';

import {
  buildDawg,
  buildGaddag,
  buildLexiconIndex,
  checkBuiltArtefact,
  gaddagPaths,
  type LexiconBuildInput,
} from './build.js';
import { crc32 } from './crc32.js';
import {
  CRC_OFFSET,
  align8,
  GADDAG_ARC_MASK,
  SECTION_TABLE_OFFSET,
  SECTIONS,
  TERM_FIELDS,
  popcount,
  type SectionName,
} from './format.js';

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

/** Default build: with the GADDAG (server artefact); `NO_GADDAG` is the mobile fallback (flags bit 0 clear). */
const OPTIONS = { formatVersion: 1, gaddag: true } as const;
const NO_GADDAG = { formatVersion: 1, gaddag: false } as const;

/** The L3 reference index of a build input (the oracle). */
const referenceOf = (input: LexiconBuildInput): LexiconIndex =>
  createReferenceIndex({
    version: input.version as LexiconVersion,
    profile: input.profile as LexiconIndex['profile'],
    document: input.document,
  });

function build(
  input: LexiconBuildInput,
  options: { readonly formatVersion: 1; readonly gaddag: boolean } = OPTIONS,
): Uint8Array {
  const r = buildLexiconIndex(input, options);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

/**
 * `build`, memoised per (input object, gaddag) to keep the suite fast under coverage; returns a fresh copy so
 * that a test can never alter another test's bytes. Determinism tests call `build` directly.
 */
const builtCache = new Map<LexiconBuildInput, Map<boolean, Uint8Array>>();
function built(
  input: LexiconBuildInput,
  options: { readonly formatVersion: 1; readonly gaddag: boolean } = OPTIONS,
): Uint8Array {
  let byInput = builtCache.get(input);
  if (byInput === undefined) {
    byInput = new Map();
    builtCache.set(input, byInput);
  }
  let bytes = byInput.get(options.gaddag);
  if (bytes === undefined) {
    bytes = build(input, options);
    byInput.set(options.gaddag, bytes);
  }
  return bytes.slice();
}

function decoded(bytes: Uint8Array): LexiconIndex {
  const r = decodeLexiconIndex(bytes);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

const codesOf = (s: string): number[] =>
  Array.from({ length: s.length }, (_, i) => s.charCodeAt(i) - 65);

/** The shape shared by `Dawg` and `Gaddag`, with plain numbers (tests only). */
interface Automaton {
  readonly root: number;
  arcs(node: never): number;
  next(node: never, symbol: number): number;
  isFinal(node: never): boolean;
}

/** Every accepted path, letters as A–Z and the separator as `+`, in traversal order (arcs ascending). */
function languageOf(automaton: Automaton): string[] {
  const out: string[] = [];
  const arcs = automaton.arcs.bind(automaton) as (node: number) => number;
  const next = automaton.next.bind(automaton) as (node: number, symbol: number) => number;
  const isFinal = automaton.isFinal.bind(automaton) as (node: number) => boolean;
  const visit = (node: number, path: string): void => {
    if (isFinal(node)) out.push(path);
    const mask = arcs(node);
    for (let symbol = 0; symbol <= GADDAG_SEPARATOR; symbol += 1) {
      if ((mask & (1 << symbol)) === 0) continue;
      const target = next(node, symbol);
      if (target === -1)
        throw new Error(`arc ${String(symbol)} of node ${String(node)} has no target`);
      visit(target, path + (symbol === GADDAG_SEPARATOR ? '+' : String.fromCharCode(65 + symbol)));
    }
  };
  visit(automaton.root, '');
  return out;
}

/** The GADDAG language of a set of forms, as `languageOf` spells it. */
const gaddagLanguageOf = (forms: readonly string[]): string[] =>
  forms
    .flatMap((f) =>
      gaddagPaths(f).map((p) =>
        p.map((c) => (c === GADDAG_SEPARATOR ? '+' : String.fromCharCode(65 + c))).join(''),
      ),
    )
    .sort();

const formsOf = (index: LexiconIndex): string[] =>
  Array.from({ length: index.size }, (_, i) => index.formMeta(i as FormRef).form);

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

/** Offset and length of a section, read from the section table. */
function sectionOf(bytes: Uint8Array, name: SectionName): { offset: number; length: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const i = SECTIONS.indexOf(name);
  return {
    offset: view.getUint32(SECTION_TABLE_OFFSET + i * 8, true),
    length: view.getUint32(SECTION_TABLE_OFFSET + i * 8 + 4, true),
  };
}

/** Invariants that any successfully decoded index must satisfy, whatever its bytes (T-CORRUPT, R1 m4). */
function expectCoherent(index: LexiconIndex): void {
  const canonical = new Set<number>();
  const letters = new Array<number>(26).fill(0);
  for (let f = 0; f < index.size; f += 1) {
    const form = f as FormRef;
    const meta = index.formMeta(form);
    expect(meta.term).toBe(index.termOf(form));
    expect(index.lookup(meta.form)).toBe(form);
    if (meta.kind === 'canonical') canonical.add(f);
    for (const c of codesOf(meta.form)) letters[c] = (letters[c] ?? 0) + 1;
  }
  expect(canonical.size).toBe(index.termCount);
  expect([...index.letterCounts()]).toEqual(letters);
  const ids = new Set<string>();
  const used = new Set<string>();
  for (let t = 0; t < index.termCount; t += 1) {
    const term = t as TermRef;
    const meta = index.meta(term);
    const ref = index.lookup(meta.form);
    expect(ref).toBeDefined();
    expect(canonical.has(ref as number)).toBe(true);
    expect(index.termOf(ref as FormRef)).toBe(term);
    expect(meta.gameValue).toBeLessThanOrEqual(0xffff);
    expect(meta.knowledgeXp).toBeLessThanOrEqual(0xffff);
    ids.add(meta.id);
    meta.categories.forEach((c) => used.add(c));
    index.difficulty(term);
    for (const c of index.categories()) index.inCategory(term, c);
    for (const n of index.neighbours(term)) {
      expect(index.related(n, term)).toBe(index.related(term, n));
      expect(index.related(term, n)).not.toBe(0);
    }
  }
  expect(ids.size).toBe(index.termCount);
  expect([...used].sort()).toEqual([...index.categories()]);
  index.crossCheck(codesOf('PO'), []);
  index.crossCheck([], codesOf('I'));
  // Automata (T-GADDAG): the DAWG spells exactly the forms in FormRef order; the GADDAG, when present, spells
  // exactly their GADDAG paths.
  const forms = formsOf(index);
  expect(languageOf(index.dawg)).toEqual(forms);
  if (index.gaddag !== undefined) {
    expect(languageOf(index.gaddag).sort()).toEqual(gaddagLanguageOf(forms));
  }
}

// --- T-ORACLE ----------------------------------------------------------------------------------------------

function expectSameIndex(binary: LexiconIndex, reference: LexiconIndex, withGaddag = true): void {
  expect(binary.formatVersion).toBe(1);
  expect(languageOf(binary.dawg)).toEqual(languageOf(reference.dawg));
  if (withGaddag) {
    expect(binary.gaddag).toBeDefined();
    expect(reference.gaddag).toBeDefined();
    expect(languageOf(binary.gaddag as Automaton).sort()).toEqual(
      languageOf(reference.gaddag as Automaton).sort(),
    );
  } else {
    expect(binary.gaddag).toBeUndefined();
  }
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

// These groups build (and self-check) the full real lexicon several times per test, so their cost grows
// with every content batch. CI runs them alongside other packages under coverage on slower runners.
const REAL_DATA_BUILDS = { timeout: 30_000 };

describe('binary index ≡ reference index (T-ORACLE, T-COMPLETE)', REAL_DATA_BUILDS, () => {
  it('fixture', () => {
    expectSameIndex(decoded(built(FIXTURE)), referenceOf(FIXTURE));
  });

  it('real lexicon data', () => {
    expectSameIndex(decoded(built(REAL)), referenceOf(REAL));
  });

  it('non-canonical category order: binary and reference agree on [primary, ...rest sorted] (R1 m2)', () => {
    const input: LexiconBuildInput = {
      ...FIXTURE,
      document: {
        terms: [
          term('pod', 'POD', { categories: ['devops', 'networking', 'cloud', 'ai'] }),
          term('ip', 'IP', { categories: ['networking'] }),
        ],
      },
    };
    const binary = decoded(built(input));
    expectSameIndex(binary, referenceOf(input));
    expect(binary.meta(binary.termOf(binary.lookup('POD') as FormRef)).categories).toEqual([
      'devops',
      'ai',
      'cloud',
      'networking',
    ]);
  });

  it('decoded indexes are coherent (fixture and real data)', () => {
    expectCoherent(decoded(built(FIXTURE)));
    expectCoherent(decoded(built(REAL)));
    expectCoherent(decoded(built(FIXTURE, NO_GADDAG)));
  });

  it('without the GADDAG (flags bit 0 clear): same index, gaddag undefined, dawg present', () => {
    for (const input of [FIXTURE, REAL]) {
      const bytes = built(input, NO_GADDAG);
      expect(new DataView(bytes.buffer).getUint16(6, true)).toBe(0);
      expect(sectionOf(bytes, 'GADDAG_NODES').length).toBe(0);
      expect(sectionOf(bytes, 'GADDAG_EDGES').length).toBe(0);
      expectSameIndex(decoded(bytes), referenceOf(input), false);
    }
    expect(new DataView(built(FIXTURE).buffer).getUint16(6, true)).toBe(1);
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
        fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
        (random, form, cut, a, b, letter) => {
          const i = cut % (form.length + 1);
          for (const s of [
            random,
            form + random,
            form.slice(0, cut),
            form.slice(cut),
            random + form,
            form.slice(0, i) + letter + form.slice(i), // insert
            form.slice(0, i) + letter + form.slice(i + 1), // substitute
            form.slice(0, i) + form.slice(i + 1), // delete
            form.slice(0, i) + form.charAt(i + 1) + form.charAt(i) + form.slice(i + 2), // transpose
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

describe('queries (T-INPUT, R-CORE-003 / P-CORE-003-b form gate, contract edge cases)', () => {
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

describe('build determinism and round trip (T-DETERMINISM, T-ROUNDTRIP)', REAL_DATA_BUILDS, () => {
  it('same input ⇒ same bytes; term and array order do not matter', () => {
    const a = build(REAL);
    expect(build(REAL)).toEqual(a);
    const shuffled = [...REAL.document.terms].reverse().map((t) => ({
      ...t,
      inflections: [...t.inflections].reverse(),
      relations: [...t.relations].reverse(),
    }));
    expect(build({ ...REAL, document: { terms: shuffled } })).toEqual(a);
  });

  it('golden pin: the fixture artefact keeps its CRC-32 and size (format 1 is frozen once published)', () => {
    const bytes = built(FIXTURE);
    expect(new DataView(bytes.buffer).getUint32(CRC_OFFSET, true)).toMatchInlineSnapshot(
      `3204721097`,
    );
    expect(bytes.length).toMatchInlineSnapshot(`2696`);
    const lean = built(FIXTURE, NO_GADDAG);
    expect(new DataView(lean.buffer).getUint32(CRC_OFFSET, true)).toMatchInlineSnapshot(
      `3433582439`,
    );
    expect(lean.length).toMatchInlineSnapshot(`1072`);
  });

  it('with and without the GADDAG, every other section is byte-identical', () => {
    const full = built(REAL);
    const lean = built(REAL, NO_GADDAG);
    for (const name of SECTIONS) {
      if (name === 'META' || name.startsWith('GADDAG')) continue;
      const a = sectionOf(full, name);
      const b = sectionOf(lean, name);
      expect(full.subarray(a.offset, a.offset + a.length), name).toEqual(
        lean.subarray(b.offset, b.offset + b.length),
      );
    }
  });

  it('encode(model(decode(bytes))) = bytes', () => {
    for (const input of [FIXTURE, REAL]) {
      for (const options of [OPTIONS, NO_GADDAG]) {
        const bytes = built(input, options);
        const again = built({ ...input, document: documentOf(decoded(bytes)) }, options);
        expect(again).toEqual(bytes);
      }
    }
  });

  it('the DAWG is minimal and numbered root-first', () => {
    const reference = referenceOf(REAL);
    const forms = Array.from(
      { length: reference.size },
      (_, i) => reference.formMeta(i as FormRef).form,
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

  it('the GADDAG is minimal, numbered root-first, and smaller than its trie', () => {
    const forms = formsOf(referenceOf(REAL));
    const gaddag = buildGaddag(forms);
    const signatures = new Set<string>();
    for (let n = 0; n < gaddag.nodeCount; n += 1) {
      const word = gaddag.nodes[n * 2] ?? 0;
      const first = gaddag.nodes[n * 2 + 1] ?? 0;
      const targets = Array.from(
        { length: popcount(word & GADDAG_ARC_MASK) },
        (_, k) => gaddag.edges[first + k],
      );
      signatures.add(`${String(word)}|${targets.join(',')}`);
    }
    expect(signatures.size).toBe(gaddag.nodeCount);
    const pathSymbols = forms.reduce((sum, f) => sum + f.length * f.length, 0);
    expect(gaddag.edgeCount).toBeLessThan(pathSymbols);
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
    ['LIMIT_EXCEEDED', FIXTURE, { formatVersion: 2, gaddag: false }],
  ])('%s', (expected, input, options) => {
    expect(code(input, options ?? OPTIONS)).toBe(expected);
  });

  it('self-check: an artefact its own decoder rejects is VALIDATION_FAILED (R1 m2)', () => {
    const bytes = built(FIXTURE);
    expect(checkBuiltArtefact(bytes, FIXTURE)).toEqual({ ok: true, value: bytes });
    const broken = bytes.slice();
    broken[100] = (broken[100] ?? 0) ^ 1;
    expect(checkBuiltArtefact(broken, FIXTURE)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', details: { decodeError: 'CORRUPT', what: 'crc32' } },
    });
    expect(checkBuiltArtefact(bytes, { ...FIXTURE, version: 'ffffffffffffffff' })).toMatchObject({
      ok: false,
      error: { details: { decodeError: 'VERSION_MISMATCH' } },
    });
  });

  it.each<[string, string[]]>([
    ['empty', []],
    ['duplicate', ['devops', 'cloud', 'devops']],
  ])('%s category list → VALIDATION_FAILED', (_name, categories) => {
    expect(code(withTerms([term('a', 'POD', { categories })]))).toBe('VALIDATION_FAILED');
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

describe('decodeLexiconIndex format 1 (T-VERSION, T-CORRUPT)', REAL_DATA_BUILDS, () => {
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

  it.each([1, 2, 3, 4, 5, 6, 7])(
    'decodes a Node Buffer at byte offset %i (Buffer#slice is a view: R1 M1)',
    (k) => {
      const buffer = Buffer.alloc(bytes.length + k).subarray(k);
      buffer.set(bytes);
      expect(buffer.byteOffset % 8).not.toBe(0);
      const r = decodeLexiconIndex(buffer);
      expect(r.ok).toBe(true);
      if (r.ok) expectSameIndex(r.value, referenceOf(FIXTURE));
      expect(Buffer.compare(buffer, Buffer.from(bytes))).toBe(0); // the input is never written to
    },
  );

  it('decodes Buffer.from(bytes) (pooled allocation) and an unaligned Buffer of the real data', () => {
    expect(decoded(Buffer.from(bytes)).has('POD')).toBe(true);
    const real = built(REAL);
    const backing = Buffer.alloc(real.length + 5);
    backing.set(real, 5);
    expectSameIndex(decoded(backing.subarray(5)), referenceOf(REAL));
  });

  it('CORRUPT: trailing bytes after the last section', () => {
    const longer = new Uint8Array(bytes.length + 8);
    longer.set(bytes);
    expect(decodeLexiconIndex(withCrc(longer))).toMatchObject({
      error: { code: 'CORRUPT', details: { what: 'trailing bytes' } },
    });
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
          // If it still decodes, every query stays total and the index is coherent.
          for (const f of forms) {
            const ref = r.value.lookup(f);
            if (ref !== undefined) r.value.meta(r.value.termOf(ref));
          }
          expectCoherent(r.value);
        },
      ),
      { seed: 99, numRuns: 3000 },
    );
  });

  it.each([2, 4, 0x80, 0x8000, 0xfffe, 0xffff])(
    'UNSUPPORTED_FORMAT: flags 0x%s (any bit other than bit 0)',
    (flags) => {
      for (const options of [OPTIONS, NO_GADDAG]) {
        const copy = built(FIXTURE, options);
        const view = new DataView(copy.buffer);
        view.setUint16(6, view.getUint16(6, true) | flags, true);
        expect(decodeLexiconIndex(withCrc(copy))).toMatchObject({
          ok: false,
          error: { code: 'UNSUPPORTED_FORMAT', details: { supported: 1 } },
        });
      }
    },
  );

  it('CORRUPT: flags bit 0 disagrees with the GADDAG sections', () => {
    for (const [options, flags] of [
      [OPTIONS, 0],
      [NO_GADDAG, 1],
    ] as const) {
      const copy = built(FIXTURE, options);
      new DataView(copy.buffer).setUint16(6, flags, true);
      expect(decodeLexiconIndex(withCrc(copy))).toMatchObject({
        error: { code: 'CORRUPT', details: { what: 'gaddag counts' } },
      });
    }
  });

  it.each<SectionName>(['DAWG_NODES', 'DAWG_EDGES', 'GADDAG_NODES', 'GADDAG_EDGES'])(
    'CORRUPT: every u32 of %s, changed, with a valid CRC (canonical automata, exact language)',
    (name) => {
      const bytes0 = built(FIXTURE);
      const { offset, length } = sectionOf(bytes0, name);
      for (let at = offset; at < offset + length; at += 4) {
        const original = new DataView(bytes0.buffer).getUint32(at, true);
        for (const value of [
          original + 1,
          original - 1,
          original ^ 0x8000_0000,
          original ^ (1 << 26),
          0,
          0xffff_ffff,
        ]) {
          if (value >>> 0 === original) continue;
          const copy = bytes0.slice();
          new DataView(copy.buffer).setUint32(at, value >>> 0, true);
          const r = decodeLexiconIndex(withCrc(copy));
          expect(
            r.ok ? undefined : r.error.code,
            `${name} +${String(at - offset)} = ${String(value)}`,
          ).toBe('CORRUPT');
        }
      }
    },
  );

  it.each<[string, (view: DataView, b: Uint8Array) => void]>([
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
    [
      // PODS (FormRef 6) claims to be a canonical form.
      'canonical forms',
      (_v, b) => (b[sectionOf(b, 'FORM_KIND').offset + 6] = 0),
    ],
    [
      // POD (FormRef 5) loses its canonical kind: one canonical form too few.
      'canonical forms',
      (_v, b) => (b[sectionOf(b, 'FORM_KIND').offset + 5] = 1),
    ],
    [
      'LETTERS',
      (v, b) => {
        v.setUint32(sectionOf(b, 'LETTERS').offset, 99, true);
      },
    ],
    [
      'term 0',
      (v, b) => {
        v.setUint32(sectionOf(b, 'TERMS').offset + 2 * 4, 0x1_0000, true);
      },
    ],
    [
      'term 0',
      (v, b) => {
        v.setUint32(sectionOf(b, 'TERMS').offset + 3 * 4, 0x1_0000, true);
      },
    ],
    [
      'term ids',
      (v, b) => {
        const terms = sectionOf(b, 'TERMS').offset;
        const second = terms + TERM_FIELDS * 4;
        v.setUint32(second + 4 * 4, v.getUint32(terms + 4 * 4, true), true);
        v.setUint32(second + 5 * 4, v.getUint32(terms + 5 * 4, true), true);
      },
    ],
    [
      // IP (TermRef 2) moves from networking (category 3) to ai (category 0): networking is unused.
      'categories',
      (v, b) => {
        const base = sectionOf(b, 'TERMS').offset + 2 * TERM_FIELDS * 4;
        v.setUint32(base, v.getUint32(base, true) & 0xff, true);
        v.setUint32(base + 4, 1, true);
      },
    ],
    [
      'padding',
      (_v, b) => {
        const kinds = sectionOf(b, 'FORM_KIND');
        b[kinds.offset + kinds.length] = 1;
      },
    ],
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

  const lean = built(REAL, NO_GADDAG);
  const sizeOf = (b: Uint8Array, ...names: SectionName[]): number =>
    names.reduce((sum, name) => sum + sectionOf(b, name).length, 0);

  it('size gate: ≤ 0.55 MB for ≤ 2,000 forms with the GADDAG; ≤ 128 bytes per form without it', () => {
    expect(index.size).toBeLessThanOrEqual(2000);
    expect(bytes.length).toBeLessThanOrEqual(550_000);
    expect(lean.length / index.size).toBeLessThanOrEqual(128);
  });

  it('size gate: GADDAG sections ≤ 6 × DAWG sections (sprint 2 decision log)', () => {
    const dawg = sizeOf(bytes, 'DAWG_NODES', 'DAWG_EDGES');
    const gaddag = sizeOf(bytes, 'GADDAG_NODES', 'GADDAG_EDGES');
    expect(gaddag).toBeGreaterThan(0);
    expect(gaddag).toBeLessThanOrEqual(6 * dawg);
    expect(bytes.length - lean.length).toBe(align8(gaddag));
    console.log(
      `size: ${String(index.size)} forms; artefact ${String(bytes.length)} B with GADDAG, ` +
        `${String(lean.length)} B without; DAWG ${String(dawg)} B, GADDAG ${String(gaddag)} B ` +
        `(${(gaddag / dawg).toFixed(2)}×)`,
    );
  });
});
