// T-GADDAG (lexicon-index note §7) and the `LexiconIndex.dawg` accessor (bots-api note §4.3, O-1), for both
// implementations: the `.clxi` binary index (minimal automata) and the reference index (plain tries).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  GLOBAL_PROFILE,
  computeLexiconVersion,
  lexiconContentDocument,
  profileDefinitionHash,
} from '../../../scripts/canonical.mjs';
import { loadLexicon } from '../../../scripts/validate.mjs';
import { GADDAG_SEPARATOR, LETTER_COUNT } from '../constants.js';
import { decodeLexiconIndex } from '../decode.js';
import { createReferenceIndex } from '../reference.js';
import type {
  Dawg,
  DawgNode,
  FormRef,
  Gaddag,
  GaddagNode,
  LetterCode,
  LetterMask,
  LexiconIndex,
  LexiconVersion,
} from '../types.js';

import { buildLexiconIndex, gaddagPaths, type LexiconBuildInput } from './build.js';
import { checkAutomaton } from './decode.js';
import { GADDAG_ARC_MASK } from './format.js';

/** Real-data tests under v8 coverage and a parallel `turbo` run exceed vitest's 5 s default (time only). */
const HEAVY_MS = 30_000;

const lex = loadLexicon();
const REAL: LexiconBuildInput = {
  version: computeLexiconVersion(lex),
  profile: {
    id: GLOBAL_PROFILE.id,
    kind: 'global',
    definitionHash: profileDefinitionHash(GLOBAL_PROFILE),
  },
  document: lexiconContentDocument(lex),
};

/** Small hand-made lexicon where prefixes, suffixes and one-letter differences collide on purpose. */
const TINY: LexiconBuildInput = {
  version: '0123456789abcdef',
  profile: { id: 'global-ranked', kind: 'global', definitionHash: 'fedcba9876543210' },
  document: {
    terms: [
      'AB',
      'ABA',
      'ABBA',
      'BA',
      'BAB',
      'CAB',
      'CABS',
      'SCAB',
      'POD',
      'PODS',
      'TOP',
      'STOP',
    ].map((form) => ({
      id: form.toLowerCase(),
      playable: true,
      form,
      difficulty: 'novice',
      categories: ['devops'],
      inflections: [],
      relations: [],
      gameValue: 1,
      knowledgeXp: 1,
    })),
  },
};

function binaryOf(input: LexiconBuildInput): LexiconIndex {
  const built = buildLexiconIndex(input, { formatVersion: 1, gaddag: true });
  if (!built.ok) throw new Error(built.error.message);
  const decoded = decodeLexiconIndex(built.value);
  if (!decoded.ok) throw new Error(decoded.error.message);
  return decoded.value;
}

const referenceOf = (input: LexiconBuildInput): LexiconIndex =>
  createReferenceIndex({
    version: input.version as LexiconVersion,
    profile: input.profile as LexiconIndex['profile'],
    document: input.document,
  });

const codesOf = (s: string): LetterCode[] =>
  Array.from({ length: s.length }, (_, i) => s.charCodeAt(i) - 65);

const formsOf = (index: LexiconIndex): string[] =>
  Array.from({ length: index.size }, (_, i) => index.formMeta(i as FormRef).form);

function gaddagOf(index: LexiconIndex): Gaddag {
  const { gaddag } = index;
  if (gaddag === undefined) throw new Error('no GADDAG');
  return gaddag;
}

/** Follows `symbols` from the root; -1 as soon as an arc is missing. */
function walk(g: Gaddag, symbols: readonly number[]): GaddagNode | -1 {
  let node: GaddagNode | -1 = g.root;
  for (const s of symbols) {
    if (node === -1) return -1;
    node = g.next(node, s);
  }
  return node;
}

/** Every accepted GADDAG path, letters A–Z, separator `+`. */
function gaddagLanguage(g: Gaddag): string[] {
  const out: string[] = [];
  const visit = (node: GaddagNode, path: string): void => {
    if (g.isFinal(node)) out.push(path);
    const arcs = g.arcs(node);
    for (let s = 0; s <= GADDAG_SEPARATOR; s += 1) {
      if ((arcs & (1 << s)) === 0) continue;
      const target = g.next(node, s);
      if (target === -1) throw new Error('arc without target');
      visit(target, path + (s === GADDAG_SEPARATOR ? '+' : String.fromCharCode(65 + s)));
    }
  };
  visit(g.root, '');
  return out.sort();
}

/** Every accepted DAWG path, in traversal order (arcs ascending). */
function dawgLanguage(d: Dawg): string[] {
  const out: string[] = [];
  const visit = (node: DawgNode, path: string): void => {
    if (d.isFinal(node)) out.push(path);
    const arcs = d.arcs(node);
    for (let s = 0; s < LETTER_COUNT; s += 1) {
      if ((arcs & (1 << s)) === 0) continue;
      const target = d.next(node, s);
      if (target === -1) throw new Error('arc without target');
      visit(target, path + String.fromCharCode(65 + s));
    }
  };
  visit(d.root, '');
  return out;
}

const pathString = (path: readonly number[]): string =>
  path.map((s) => (s === GADDAG_SEPARATOR ? '+' : String.fromCharCode(65 + s))).join('');

/**
 * `crossCheck` through the GADDAG (how a bot computes it, Gordon 1994): letter L fits between `before` and
 * `after` iff the path L rev(before) [◇ after] is accepted (the split right after L).
 */
function gaddagCrossCheck(
  g: Gaddag,
  before: readonly LetterCode[],
  after: readonly LetterCode[],
): LetterMask {
  const tail = [
    ...[...before].reverse(),
    ...(after.length > 0 ? [GADDAG_SEPARATOR, ...after] : []),
  ];
  let mask = 0;
  for (let letter = 0; letter < LETTER_COUNT; letter += 1) {
    const node = walk(g, [letter, ...tail]);
    if (node !== -1 && g.isFinal(node)) mask |= 1 << letter;
  }
  return mask;
}

/** Brute force over the form set: every letter tried at the gap. */
function bruteCrossCheck(
  forms: ReadonlySet<string>,
  before: readonly LetterCode[],
  after: readonly LetterCode[],
): LetterMask {
  const b = String.fromCharCode(...before.map((c) => c + 65));
  const a = String.fromCharCode(...after.map((c) => c + 65));
  let mask = 0;
  for (let letter = 0; letter < LETTER_COUNT; letter += 1) {
    if (forms.has(b + String.fromCharCode(65 + letter) + a)) mask |= 1 << letter;
  }
  return mask;
}

const CASES: [string, LexiconBuildInput][] = [
  ['tiny', TINY],
  ['real data', REAL],
];

describe.each(CASES)('T-GADDAG on %s', (_name, input) => {
  const binary = binaryOf(input);
  const reference = referenceOf(input);
  const forms = formsOf(reference);
  const formSet = new Set(forms);
  const expected = forms.flatMap((f) => gaddagPaths(f).map(pathString)).sort();

  it.each([
    ['binary', binary],
    ['reference', reference],
  ])(
    '%s: every form is reachable through each of its rev(prefix) [◇ suffix] paths',
    (_n, index) => {
      const g = gaddagOf(index);
      for (const form of forms) {
        const paths = gaddagPaths(form);
        expect(paths).toHaveLength(form.length);
        for (const path of paths) {
          const node = walk(g, path);
          expect(node, `${form}: ${pathString(path)}`).not.toBe(-1);
          expect(g.isFinal(node as GaddagNode), `${form}: ${pathString(path)}`).toBe(true);
        }
      }
    },
    HEAVY_MS,
  );

  it.each([
    ['binary', binary],
    ['reference', reference],
  ])(
    '%s: no extra words (the GADDAG language is exactly those paths)',
    (_n, index) => {
      expect(gaddagLanguage(gaddagOf(index))).toEqual(expected);
    },
    HEAVY_MS,
  );

  it.each([
    ['binary', binary],
    ['reference', reference],
  ])(
    '%s: dawg enumerates exactly the playable forms, in FormRef order',
    (_n, index) => {
      expect(dawgLanguage(index.dawg)).toEqual(forms);
      for (const form of forms) {
        let node: DawgNode | -1 = index.dawg.root;
        for (const c of codesOf(form)) node = node === -1 ? -1 : index.dawg.next(node, c);
        expect(node !== -1 && index.dawg.isFinal(node)).toBe(true);
      }
    },
    HEAVY_MS,
  );

  it(
    'crossCheck: index (DAWG) ≡ GADDAG ≡ brute force at every position of every form',
    () => {
      const g = gaddagOf(binary);
      const gr = gaddagOf(reference);
      for (const form of forms) {
        const codes = codesOf(form);
        for (let i = 0; i < codes.length; i += 1) {
          const before = codes.slice(0, i);
          const after = codes.slice(i + 1);
          const brute = bruteCrossCheck(formSet, before, after);
          expect(brute & (1 << (codes[i] ?? 0))).not.toBe(0);
          expect(gaddagCrossCheck(g, before, after), `${form} @${String(i)}`).toBe(brute);
          expect(gaddagCrossCheck(gr, before, after)).toBe(brute);
          expect(binary.crossCheck(before, after)).toBe(brute);
          expect(reference.crossCheck(before, after)).toBe(brute);
        }
      }
    },
    HEAVY_MS,
  );

  it(
    'crossCheck property: random contexts (fragments of forms and random letters)',
    () => {
      const g = gaddagOf(binary);
      const letter = fc.integer({ min: 0, max: LETTER_COUNT - 1 });
      const fragment = fc.oneof(
        fc.array(letter, { maxLength: 6 }),
        fc
          .tuple(fc.constantFrom(...forms), fc.nat(), fc.nat())
          .map(([f, x, y]) =>
            codesOf(f.slice(Math.min(x, y) % (f.length + 1), Math.max(x, y) % (f.length + 1))),
          ),
      );
      fc.assert(
        fc.property(fragment, fragment, (before, after) => {
          const brute = bruteCrossCheck(formSet, before, after);
          expect(gaddagCrossCheck(g, before, after)).toBe(brute);
          expect(binary.crossCheck(before, after)).toBe(brute);
          expect(reference.crossCheck(before, after)).toBe(brute);
        }),
        { seed: 5150, numRuns: 3000 },
      );
    },
    HEAVY_MS,
  );
});

describe('Dawg / Gaddag accessors: contract edge cases (both implementations)', () => {
  const indexes = [
    ['binary', binaryOf(TINY)],
    ['reference', referenceOf(TINY)],
  ] as const;

  it.each(indexes)('%s: nodes that are not its own are dead ends, never a throw', (_n, index) => {
    const g = gaddagOf(index);
    for (const bad of [-1, 0.5, 1e9, Number.NaN, 2 ** 32]) {
      expect(g.arcs(bad as GaddagNode)).toBe(0);
      expect(g.next(bad as GaddagNode, 0)).toBe(-1);
      expect(g.isFinal(bad as GaddagNode)).toBe(false);
      expect(index.dawg.arcs(bad as DawgNode)).toBe(0);
      expect(index.dawg.next(bad as DawgNode, 0)).toBe(-1);
      expect(index.dawg.isFinal(bad as DawgNode)).toBe(false);
    }
    for (const symbol of [-1, 27, 1.5, Number.NaN]) expect(g.next(g.root, symbol)).toBe(-1);
    for (const letter of [-1, 26, 1.5, Number.NaN]) {
      expect(index.dawg.next(index.dawg.root, letter)).toBe(-1);
    }
    expect(index.dawg.next(index.dawg.root, 25)).toBe(-1); // no form starts with Z
    expect(g.isFinal(g.root)).toBe(false);
    expect(index.dawg.isFinal(index.dawg.root)).toBe(false);
  });

  it.each(indexes)('%s: the separator is an arc of the GADDAG, never of the DAWG', (_n, index) => {
    const g = gaddagOf(index);
    const afterA = g.next(g.root, 0); // A…
    expect(afterA).not.toBe(-1);
    expect(g.arcs(afterA as GaddagNode) & (1 << GADDAG_SEPARATOR)).not.toBe(0); // A◇B (AB, ABA, ABBA)
    expect(index.dawg.arcs(index.dawg.root) & ~((1 << LETTER_COUNT) - 1)).toBe(0);
  });

  it.each(indexes)('%s: accessors are stable (same object, frozen)', (_n, index) => {
    expect(index.dawg).toBe(index.dawg);
    expect(index.gaddag).toBe(index.gaddag);
    expect(Object.isFrozen(index.dawg)).toBe(true);
    expect(Object.isFrozen(index.gaddag)).toBe(true);
  });
});

describe('checkAutomaton: each canonical-shape invariant has its own error (hand-built automata)', () => {
  const FINAL = 0x8000_0000;
  const A = 1 << 0;
  const B = 1 << 1;
  /** nodes: [word, firstEdge] pairs; edges: targets (stride 1); cap 3. */
  const check = (nodes: number[][], edges: number[]): string | number =>
    checkAutomaton(
      Uint32Array.from(nodes.flat()),
      Uint32Array.from(edges),
      1,
      GADDAG_ARC_MASK,
      3,
      'x',
    );

  it.each<[string, number[][], number[], string | number]>([
    [
      'accepts AA and AB: 2 paths',
      [
        [A, 0],
        [A | B, 1],
        [FINAL, 3],
      ],
      [1, 2, 2],
      2,
    ],
    [
      'unknown bit',
      [
        [A | (1 << 28), 0],
        [FINAL, 1],
      ],
      [1],
      'x node 0',
    ],
    [
      'firstEdge not contiguous',
      [
        [A, 0],
        [FINAL, 0],
      ],
      [1],
      'x node 1',
    ],
    [
      'edge count',
      [
        [A, 0],
        [FINAL, 1],
      ],
      [1, 1],
      'x edges',
    ],
    [
      'target out of range',
      [
        [A, 0],
        [FINAL, 1],
      ],
      [2],
      'x edge 0',
    ],
    [
      'not breadth-first',
      [
        [A | B, 0],
        [FINAL, 2],
        [FINAL | A, 2],
      ],
      [2, 1, 1],
      'x order',
    ],
    [
      'unreachable node',
      [
        [FINAL, 0],
        [FINAL, 0],
      ],
      [],
      'x order',
    ],
    [
      'cycle',
      [
        [A, 0],
        [FINAL | A, 1],
      ],
      [1, 1],
      'x cycle',
    ],
    [
      'dead node',
      [
        [A, 0],
        [0, 1],
      ],
      [1],
      'x dead node',
    ],
    [
      'not minimal',
      [
        [A | B, 0],
        [FINAL, 2],
        [FINAL, 2],
      ],
      [1, 2],
      'x minimality',
    ],
    [
      'deeper than 16 symbols',
      Array.from({ length: 18 }, (_, i) => (i < 17 ? [A, i] : [FINAL, 17])),
      Array.from({ length: 17 }, (_, i) => i + 1),
      'x depth',
    ],
    [
      '8 paths saturate at cap + 1 = 4',
      [
        [A | B, 0],
        [A | B, 2],
        [A | B, 4],
        [FINAL, 6],
      ],
      [1, 1, 2, 2, 3, 3],
      4,
    ],
  ])('%s', (_name, nodes, edges, expected) => {
    expect(check(nodes, edges)).toBe(expected);
  });
});
