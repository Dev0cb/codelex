import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { lexiconContentDocument } from '../../scripts/canonical.mjs';
import { loadLexicon, playableForms } from '../../scripts/validate.mjs';
import { relationBit } from './constants.js';
import {
  REFERENCE_FORMAT_VERSION,
  createReferenceIndex,
  type ReferenceIndexInput,
  type ReferenceTermInput,
} from './reference.js';
import type {
  CategoryId,
  DefinitionHash,
  FormRef,
  LexiconIndex,
  LexiconVersion,
  TermRef,
} from './types.js';

const VERSION = '0123456789abcdef' as LexiconVersion;
const PROFILE = {
  id: 'global-ranked',
  kind: 'global',
  definitionHash: 'fedcba9876543210' as DefinitionHash,
} as const;

function term(
  id: string,
  form: string,
  extra: Partial<ReferenceTermInput> = {},
): ReferenceTermInput {
  return {
    id,
    playable: true,
    form,
    difficulty: 'novice',
    categories: ['cloud'],
    inflections: [],
    relations: [],
    gameValue: 10,
    knowledgeXp: 12,
    ...extra,
  };
}

const FIXTURE: ReferenceIndexInput = {
  version: VERSION,
  profile: PROFILE,
  document: {
    terms: [
      term('pod', 'POD', {
        difficulty: 'intermediate',
        categories: ['devops', 'cloud'],
        inflections: [{ form: 'PODS', kind: 'plural' }],
        relations: [{ type: 'part_of', target: 'kubernetes' }],
        gameValue: 11,
        knowledgeXp: 28,
      }),
      term('kubernetes', 'KUBERNETES', {
        difficulty: 'expert',
        categories: ['devops'],
        relations: [
          { type: 'uses', target: 'container' },
          { type: 'related_to', target: 'pod' },
          { type: 'is_a', target: 'not-in-profile' },
        ],
        gameValue: 43,
        knowledgeXp: 85,
      }),
      term('container', 'CONTAINER', {
        inflections: [{ form: 'CONTAINERS', kind: 'plural' }],
      }),
      term('ai', 'AI', { categories: ['ai'] }),
      term('ip', 'IP', { categories: ['networking'] }),
      { ...term('not-in-profile', 'LEGACY'), playable: false },
    ],
  },
};

function forms(index: LexiconIndex): string[] {
  const out: string[] = [];
  for (let i = 0; i < index.size; i += 1) out.push(index.formMeta(i as FormRef).form);
  return out;
}

function ref(index: LexiconIndex, form: string): FormRef {
  const r = index.lookup(form);
  if (r === undefined) throw new Error(`missing ${form}`);
  return r;
}

const codes = (s: string): number[] =>
  Array.from({ length: s.length }, (_, i) => s.charCodeAt(i) - 65);

describe('createReferenceIndex — fixture', () => {
  const index = createReferenceIndex(FIXTURE);

  it('exposes identity, sizes and the reference format version', () => {
    expect(index.version).toBe(VERSION);
    expect(index.profile).toBe(PROFILE);
    expect(index.formatVersion).toBe(REFERENCE_FORMAT_VERSION);
    expect(index.size).toBe(7);
    expect(index.termCount).toBe(5);
    expect(index.maxFormLength).toBe(10);
    expect(index.gaddag).toBeUndefined();
    expect(Object.isFrozen(index)).toBe(true);
  });

  it('orders FormRefs and TermRefs by UTF-16 code units', () => {
    expect(forms(index)).toEqual([
      'AI',
      'CONTAINER',
      'CONTAINERS',
      'IP',
      'KUBERNETES',
      'POD',
      'PODS',
    ]);
    const termForms = Array.from(
      { length: index.termCount },
      (_, i) => index.meta(i as TermRef).form,
    );
    expect(termForms).toEqual(['AI', 'CONTAINER', 'IP', 'KUBERNETES', 'POD']);
  });

  it('resolves inflections to their canonical term (R-CORE-006)', () => {
    const pods = ref(index, 'PODS');
    const pod = ref(index, 'POD');
    expect(index.termOf(pods)).toBe(index.termOf(pod));
    expect(index.formMeta(pods)).toEqual({
      ref: pods,
      form: 'PODS',
      term: index.termOf(pod),
      kind: 'plural',
    });
    expect(index.formMeta(pod).kind).toBe('canonical');
    expect(index.meta(index.termOf(pods)).form).toBe('POD');
  });

  it('returns frozen, memoised metadata with effective values', () => {
    const t = index.termOf(ref(index, 'POD'));
    const meta = index.meta(t);
    expect(meta).toEqual({
      ref: t,
      id: 'pod',
      form: 'POD',
      difficulty: 'intermediate',
      categories: ['devops', 'cloud'],
      gameValue: 11,
      knowledgeXp: 28,
    });
    expect(Object.isFrozen(meta)).toBe(true);
    expect(Object.isFrozen(meta.categories)).toBe(true);
    expect(index.meta(t)).toBe(meta);
    expect(index.formMeta(ref(index, 'POD'))).toBe(index.formMeta(ref(index, 'POD')));
    expect(index.difficulty(t)).toBe('intermediate');
    expect(index.inCategory(t, 'cloud' as CategoryId)).toBe(true);
    expect(index.inCategory(t, 'ai' as CategoryId)).toBe(false);
    expect(index.categories()).toEqual(['ai', 'cloud', 'devops', 'networking']);
  });

  it('rejects anything that is not a playable form (no case folding)', () => {
    for (const s of [
      'pod',
      'Pod',
      'PO',
      'P',
      '',
      'PODSS',
      'LEGACY',
      'A'.repeat(16),
      'PÖD',
      ' POD',
    ]) {
      expect(index.has(s), s).toBe(false);
      expect(index.lookup(s), s).toBeUndefined();
    }
    expect(index.has(42 as unknown as string)).toBe(false);
  });

  it('looks up letter codes over a sub-range and rejects bad ranges or codes', () => {
    const line = codes('XPODSX');
    expect(index.lookupCodes(line, 1, 5)).toBe(ref(index, 'PODS'));
    expect(index.lookupCodes(line, 1, 4)).toBe(ref(index, 'POD'));
    expect(index.lookupCodes(line, 0, 4)).toBeUndefined();
    expect(index.lookupCodes(line, 4, 1)).toBeUndefined();
    expect(index.lookupCodes(line, -1, 3)).toBeUndefined();
    expect(index.lookupCodes(line, 1, 99)).toBeUndefined();
    expect(index.lookupCodes(line, 1.5, 4)).toBeUndefined();
    expect(index.lookupCodes([15, 26, 3], 0, 3)).toBeUndefined();
    expect(index.lookupCodes([15, -1, 3], 0, 3)).toBeUndefined();
    expect(index.lookupCodes([15, 1.5, 3], 0, 3)).toBeUndefined();
  });

  it('relates terms undirected, in-profile only, never a term to itself (R-SCORE-005)', () => {
    const pod = index.termOf(ref(index, 'POD'));
    const k8s = index.termOf(ref(index, 'KUBERNETES'));
    const container = index.termOf(ref(index, 'CONTAINER'));
    const ai = index.termOf(ref(index, 'AI'));
    const both = relationBit('part_of') | relationBit('related_to');
    expect(index.related(pod, k8s)).toBe(both);
    expect(index.related(k8s, pod)).toBe(both);
    expect(index.related(k8s, container)).toBe(relationBit('uses'));
    expect(index.related(pod, pod)).toBe(0);
    expect(index.related(index.termOf(ref(index, 'PODS')), pod)).toBe(0);
    expect(index.related(ai, pod)).toBe(0);
    expect(index.neighbours(k8s)).toEqual([container, pod].sort((a, b) => a - b));
    expect(index.neighbours(ai)).toEqual([]);
    expect(Object.isFrozen(index.neighbours(k8s))).toBe(true);
  });

  it('counts letters over every playable form and returns a fresh copy (T-ORACLE)', () => {
    const counts = index.letterCounts();
    const expected = new Array<number>(26).fill(0);
    for (const f of forms(index)) for (const c of codes(f)) expected[c] = (expected[c] ?? 0) + 1;
    expect([...counts]).toEqual(expected);
    (counts as unknown as Uint32Array).fill(999);
    expect([...index.letterCounts()]).toEqual(expected);
  });

  it('cross-checks the letters that complete a playable form', () => {
    expect(index.crossCheck(codes('PO'), [])).toBe(1 << 3); // POD
    expect(index.crossCheck(codes('POD'), [])).toBe(1 << 18); // PODS
    expect(index.crossCheck([], codes('I'))).toBe(1 << 0); // AI
    expect(index.crossCheck([], codes('P'))).toBe(1 << 8); // IP
    expect(index.crossCheck(codes('ZZ'), [])).toBe(0);
    expect(index.crossCheck([99], [])).toBe(0);
    expect(index.crossCheck(codes('ABCDEFGHIJKLMNO'), [])).toBe(0);
  });

  it('throws on refs that do not belong to the index', () => {
    expect(() => index.meta(99 as TermRef)).toThrow(RangeError);
    expect(() => index.formMeta(-1 as FormRef)).toThrow(RangeError);
    expect(() => index.termOf(99 as FormRef)).toThrow(RangeError);
    expect(() => index.related(0 as TermRef, 99 as TermRef)).toThrow(RangeError);
    expect(() => index.neighbours(99 as TermRef)).toThrow(RangeError);
  });
});

describe('createReferenceIndex — invalid sources', () => {
  const build = (terms: ReferenceTermInput[]) => () =>
    createReferenceIndex({ version: VERSION, profile: PROFILE, document: { terms } });

  it.each([
    ['invalid form', [term('a', 'pod')]],
    ['missing form', [{ ...term('a', 'POD'), form: undefined }]],
    ['unknown difficulty', [term('a', 'POD', { difficulty: 'legendary' })]],
    ['missing difficulty', [term('a', 'POD', { difficulty: undefined })]],
    ['non-integer value', [term('a', 'POD', { gameValue: 1.5 })]],
    ['missing value', [term('a', 'POD', { knowledgeXp: undefined })]],
    ['invalid inflection', [term('a', 'POD', { inflections: [{ form: 'pods', kind: 'plural' }] })]],
    [
      'unknown inflection kind',
      [term('a', 'POD', { inflections: [{ form: 'PODS', kind: 'dual' }] })],
    ],
    ['duplicate form', [term('a', 'POD'), term('b', 'POD')]],
    [
      'inflection collision',
      [term('a', 'POD', { inflections: [{ form: 'API', kind: 'plural' }] }), term('b', 'API')],
    ],
    ['duplicate id', [term('a', 'POD'), term('a', 'API')]],
    ['empty category list', [term('a', 'POD', { categories: [] })]],
    ['duplicate secondary category', [term('a', 'POD', { categories: ['ai', 'cloud', 'cloud'] })]],
    ['primary repeated as secondary', [term('a', 'POD', { categories: ['ai', 'cloud', 'ai'] })]],
    ['unknown relation type', [term('a', 'POD', { relations: [{ type: 'likes', target: 'a' }] })]],
  ])('throws on %s', (_name, terms) => {
    expect(build(terms)).toThrow(RangeError);
  });

  it('normalises categories to [primary, ...rest sorted by code unit] (R1 m2)', () => {
    const index = build([
      term('a', 'POD', { categories: ['devops', 'networking', 'ai', 'cloud'] }),
    ])();
    expect(index.meta(0 as TermRef).categories).toEqual(['devops', 'ai', 'cloud', 'networking']);
    expect(index.categories()).toEqual(['ai', 'cloud', 'devops', 'networking']);
  });

  it('ignores self-links', () => {
    const index = build([term('a', 'POD', { relations: [{ type: 'uses', target: 'a' }] })])();
    expect(index.neighbours(0 as TermRef)).toEqual([]);
  });
});

describe('createReferenceIndex — real lexicon data (T-COMPLETE, T-SOUND)', () => {
  const lex = loadLexicon();
  const document = lexiconContentDocument(lex);
  const index = createReferenceIndex({
    version: lex.version as LexiconVersion,
    profile: PROFILE,
    document,
  });
  const expected = playableForms(lex);
  const playableSet = new Set(expected.map((r) => r.form));
  const termsById = new Map(document.terms.map((t) => [t.id, t]));
  /** Raw source terms (data files, not the canonical document D): an oracle independent of the normaliser. */
  interface RawTerm {
    readonly id: string;
    readonly playable?: boolean;
    readonly categories: readonly string[];
    readonly relations?: readonly { readonly type: string; readonly target: string }[];
  }
  const rawTerms = (lex.files as readonly { data?: { terms?: RawTerm[] } }[]).flatMap(
    (f) => f.data?.terms ?? [],
  );
  const rawById = new Map(rawTerms.map((t) => [t.id, t]));

  it('T-COMPLETE: every playable form resolves to its source term with the same metadata', () => {
    expect(index.size).toBe(expected.length);
    expect(index.termCount).toBe(document.terms.filter((t) => t.playable).length);
    for (const row of expected) {
      const f = index.lookup(row.form);
      expect(f, row.form).toBeDefined();
      const meta = index.meta(index.termOf(f as FormRef));
      const source = termsById.get(row.termId);
      expect(meta.id).toBe(row.termId);
      expect(meta.form).toBe(source?.form);
      expect(meta.difficulty).toBe(source?.difficulty);
      const [primary, ...secondary] = rawById.get(row.termId)?.categories ?? [];
      expect(meta.categories).toEqual([
        primary,
        ...[...secondary].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      ]);
      expect(meta.gameValue).toBe(source?.gameValue);
      expect(meta.knowledgeXp).toBe(source?.knowledgeXp);
      expect(index.formMeta(f as FormRef).kind).toBe(row.kind);
    }
  });

  it('T-SOUND: random strings and edits of real forms are members only if they are playable', () => {
    const real = [...playableSet];
    const letter = fc.integer({ min: 65, max: 90 }).map((c) => String.fromCharCode(c));
    const randomString = fc.array(letter, { minLength: 1, maxLength: 16 }).map((a) => a.join(''));
    const edited = fc
      .tuple(fc.constantFrom(...real), fc.nat(), letter, fc.integer({ min: 0, max: 3 }))
      .map(([w, pos, l, op]) => {
        const i = pos % (w.length + 1);
        if (op === 0) return w.slice(0, i) + l + w.slice(i); // insert
        if (op === 1) return w.slice(0, i) + w.slice(i + 1); // delete
        if (op === 2) return w.slice(0, i) + l + w.slice(i + 1); // substitute
        return i + 1 < w.length
          ? w.slice(0, i) + w.charAt(i + 1) + w.charAt(i) + w.slice(i + 2)
          : w; // transpose
      });
    const concat = fc
      .tuple(fc.constantFrom(...real), fc.constantFrom(...real))
      .map(([a, b]) => a + b);
    fc.assert(
      fc.property(fc.oneof(randomString, edited, concat), (s) => {
        expect(index.has(s)).toBe(playableSet.has(s));
      }),
      { seed: 1_013, numRuns: 2_000 },
    );
  });

  it('T-SOUND: no proper prefix or suffix of a form is a member unless it is itself playable', () => {
    for (const w of playableSet) {
      for (let i = 1; i < w.length; i += 1) {
        expect(index.has(w.slice(0, i))).toBe(playableSet.has(w.slice(0, i)));
        expect(index.has(w.slice(i))).toBe(playableSet.has(w.slice(i)));
      }
    }
  });

  it('T-REL: every data edge with both ends in the profile is present with its type', () => {
    const refOf = new Map<string, TermRef>();
    for (let t = 0; t < index.termCount; t += 1)
      refOf.set(index.meta(t as TermRef).id, t as TermRef);
    let checked = 0;
    for (const raw of rawTerms) {
      const a = refOf.get(raw.id);
      if (raw.playable !== true || a === undefined) continue;
      for (const r of raw.relations ?? []) {
        const b = refOf.get(r.target);
        if (b === undefined || b === a) continue;
        const bit = relationBit(r.type as Parameters<typeof relationBit>[0]);
        expect(index.related(a, b) & bit, `${raw.id} -${r.type}-> ${r.target}`).toBe(bit);
        expect(index.related(b, a) & bit).toBe(bit);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('relations are symmetric and never point to the term itself', () => {
    for (let t = 0; t < index.termCount; t += 1) {
      for (const n of index.neighbours(t as TermRef)) {
        expect(n).not.toBe(t);
        expect(index.related(n, t as TermRef)).toBe(index.related(t as TermRef, n));
        expect(index.related(t as TermRef, n)).not.toBe(0);
      }
    }
  });
});
