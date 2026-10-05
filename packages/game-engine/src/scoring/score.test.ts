import {
  createReferenceIndex,
  type DefinitionHash,
  type LexiconVersion,
  type ReferenceTermInput,
} from '@codelex/lexicon/index';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import classicGolden from '../../test/golden/scoring/v1/classic.json' with { type: 'json' };
import inflectionGolden from '../../test/golden/scoring/v1/inflections.json' with { type: 'json' };
import { CTX, boardWith } from '../../test/support/small-lexicon.js';
import { comparePlacements } from '../actions/parse.js';
import {
  checkPlacement,
  checkPlacementGeometry,
  type CheckedPlacement,
} from '../placement/check.js';
import { getLayout, getLetterTable } from '../rules/constants.js';
import { rulesFor } from '../rules/registry.js';
import type { BoardTile, EngineLexicon, Layout, Placement, SquareKind } from '../types.js';
import { chainAfter, previewPlacement, scorePlacement, wordBase } from './score.js';

interface GoldenTile {
  readonly r: number;
  readonly c: number;
  readonly letter: string;
  readonly blank?: boolean;
}
interface GoldenWord {
  readonly form: string;
  readonly main: boolean;
  readonly letterSum: number;
  readonly wordMult: number;
  readonly base: number;
  readonly termBonus: number;
}
interface GoldenCase {
  readonly id: string;
  readonly firstMove: boolean;
  readonly board: readonly GoldenTile[];
  readonly place: readonly GoldenTile[];
  readonly context?: { readonly prevMainTerm: string; readonly chainK: number };
  readonly expected: {
    readonly words: readonly GoldenWord[];
    readonly fullStack: number;
    readonly chain: number;
    readonly chainKAfter?: number;
    readonly total: number;
  };
}

type Difficulty = 'novice' | 'intermediate' | 'advanced' | 'expert';
const stubTerm = (
  form: string,
  difficulty: Difficulty,
  extra: Partial<Pick<ReferenceTermInput, 'inflections' | 'relations'>> = {},
): ReferenceTermInput => ({
  id: form.toLowerCase(),
  playable: true,
  form,
  difficulty,
  categories: ['cloud'],
  inflections: extra.inflections ?? [],
  relations: extra.relations ?? [],
  gameValue: 1,
  knowledgeXp: 1,
});

/** The G-LEX-SMALL stubs of RULE_PROPERTIES §3.1 and §3.2. */
const STUB: EngineLexicon = createReferenceIndex({
  version: '1111111111111111' as LexiconVersion,
  profile: {
    id: 'global-ranked',
    kind: 'global',
    definitionHash: '2222222222222222' as DefinitionHash,
  },
  document: {
    terms: [
      stubTerm('AI', 'novice'),
      stubTerm('API', 'novice'),
      stubTerm('CI', 'intermediate'),
      stubTerm('CLOUD', 'novice'),
      stubTerm('CLOUDFLARE', 'advanced'),
      stubTerm('BUCKET', 'intermediate', { relations: [{ type: 'part_of', target: 'cloud' }] }),
      stubTerm('CHATBOT', 'novice'),
      stubTerm('CPU', 'novice'),
      stubTerm('ETL', 'advanced'),
      stubTerm('GO', 'intermediate'),
      stubTerm('JSON', 'intermediate'),
      stubTerm('KUBERNETES', 'expert'),
      stubTerm('NAT', 'advanced'),
      stubTerm('PYTHON', 'intermediate'),
      stubTerm('TCP', 'intermediate'),
      stubTerm('ZERODAY', 'expert'),
      stubTerm('POD', 'advanced', {
        inflections: [{ form: 'PODS', kind: 'plural' }],
        relations: [{ type: 'part_of', target: 'kubernetes' }],
      }),
      stubTerm('SQL', 'intermediate'),
    ],
  },
});

const layout = getLayout('classic-v1');
const letters = getLetterTable('letters-v1');

/** ADR-0014 §D1: internal modules take the match's rules; these unit tests run rules version 1. */
const R1 = rulesFor(1).rules;

function toPlacement(t: GoldenTile): Placement {
  return {
    row: t.r,
    col: t.c,
    tile: (t.blank === true ? t.letter.toLowerCase() : t.letter) as BoardTile,
  };
}

function checked(c: GoldenCase): CheckedPlacement {
  const board = boardWith(c.board.map((t) => [t.r, t.c, t.letter]));
  const tiles = c.place.map(toPlacement).sort(comparePlacements);
  const rack = c.place.map((t) => (t.blank === true ? '?' : t.letter)).join('');
  const r = checkPlacement({ board, layout, rack, tiles, rules: R1 }, STUB);
  if (!r.ok) throw new Error(`${c.id}: ${JSON.stringify(r.error)}`);
  return r.value;
}

const cases: readonly GoldenCase[] = [
  ...(classicGolden.scoringCases as readonly GoldenCase[]),
  ...(inflectionGolden.scoringCases as readonly GoldenCase[]),
];

describe('golden scoring cases (RULE_PROPERTIES §3.1, §3.2; R-SCORE-001, R-SCORE-002, R-SCORE-003, R-SCORE-004, R-SCORE-005, R-SCORE-008)', () => {
  it('transcribes every case', () => {
    expect(cases).toHaveLength(22);
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const placement = checked(c);
    if (c.firstMove) expect(c.board).toHaveLength(0);
    const context = {
      lastMainForm: c.context?.prevMainTerm ?? '',
      chainK: c.context?.chainK ?? 0,
    };
    const breakdown = scorePlacement(placement, layout, letters, context, STUB, R1);
    expect(
      breakdown.words.map(({ form, main, letterSum, wordMult, base, termBonus }) => ({
        form,
        main,
        letterSum,
        wordMult,
        base,
        termBonus,
      })),
    ).toEqual(c.expected.words);
    expect(breakdown.fullStack).toBe(c.expected.fullStack);
    expect(breakdown.chain).toBe(c.expected.chain);
    if (c.expected.chainKAfter !== undefined)
      expect(breakdown.chainKAfter).toBe(c.expected.chainKAfter);
    expect(breakdown.total).toBe(c.expected.total);
    // P-API-05 / R-SCORE-008 a: components sum to the total.
    expect(
      breakdown.words.reduce((s, w) => s + w.total, 0) + breakdown.fullStack + breakdown.chain,
    ).toBe(breakdown.total);
    expect(breakdown.tilesPlaced).toBe(c.place.length);
  });

  it('exposes the canonical term of an inflected form (E-1.7 AC-9, R-CORE-006)', () => {
    const c = cases.find((x) => x.id === 'GC-INF-01') as GoldenCase;
    const [word] = scorePlacement(
      checked(c),
      layout,
      letters,
      { lastMainForm: '', chainK: 0 },
      STUB,
      R1,
    ).words;
    expect(word).toMatchObject({
      form: 'PODS',
      termId: 'pod',
      canonicalForm: 'POD',
      difficulty: 'advanced',
      techBonus: 0,
      compileBonus: 0,
      total: 22,
    });
  });
});

describe('ADR-0014 §D5 (T-6, L7): rules version 2 scores from letters-v2 and its term bonus, never from gameValue (R-SCORE-001, R-SCORE-003)', () => {
  const lexiconWithGameValue = (gameValue: number): EngineLexicon =>
    createReferenceIndex({
      version: '3333333333333333' as LexiconVersion,
      profile: {
        id: 'global-ranked',
        kind: 'global',
        definitionHash: '2222222222222222' as DefinitionHash,
      },
      document: { terms: [{ ...stubTerm('PYTHON', 'intermediate'), gameValue }] },
    });

  // PYTHON across the plain start of classic-v2, row 7 cols 4–9: no premium square on the way.
  const score = (lexicon: EngineLexicon, candidate: 'tb-0-2-4-8' | 'tb-0-3-6-12'): number => {
    const rules = rulesFor(2).candidates.find((c) => c.id === candidate)?.rules;
    if (rules === undefined) throw new Error(candidate);
    const v2Layout = getLayout('classic-v2');
    const tiles = (['P', 'Y', 'T', 'H', 'O', 'N'] as const).map((tile, i) => ({
      row: 7,
      col: 4 + i,
      tile,
    }));
    const r = checkPlacement(
      { board: boardWith([]), layout: v2Layout, rack: 'PYTHON', tiles, rules },
      lexicon,
    );
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const context = { lastMainForm: '', chainK: 0 };
    return scorePlacement(r.value, v2Layout, getLetterTable('letters-v2'), context, lexicon, rules)
      .total;
  };

  it('letter sum from letters-v2 (P2 Y5 T1 H3 O1 N1 = 13) plus the candidate bonus; gameValue is ignored', () => {
    expect(score(lexiconWithGameValue(1), 'tb-0-2-4-8')).toBe(13 + 2);
    expect(score(lexiconWithGameValue(999), 'tb-0-2-4-8')).toBe(13 + 2);
    expect(score(lexiconWithGameValue(1), 'tb-0-3-6-12')).toBe(13 + 3);
  });
});

describe('chain (R-SCORE-005)', () => {
  const ref = (form: string): NonNullable<ReturnType<EngineLexicon['lookup']>> => {
    const r = STUB.lookup(form);
    if (r === undefined) throw new Error(form);
    return r;
  };

  it('P-SCORE-005-a/b: k grows by one per link and caps at 5 (+5 … +25)', () => {
    expect(
      [0, 1, 2, 3, 4, 5].map((k) =>
        chainAfter(ref('BUCKET'), { lastMainForm: 'CLOUD', chainK: k }, STUB, R1),
      ),
    ).toEqual([1, 2, 3, 4, 5, 5]);
  });

  it('P-SCORE-005-a: undirected (CLOUD after BUCKET links too)', () => {
    expect(chainAfter(ref('CLOUD'), { lastMainForm: 'BUCKET', chainK: 0 }, STUB, R1)).toBe(1);
  });

  it('P-SCORE-005-c/d/f: no previous word, the same term, or an inflection of it → 0', () => {
    expect(chainAfter(ref('CLOUD'), { lastMainForm: '', chainK: 3 }, STUB, R1)).toBe(0);
    expect(chainAfter(ref('CLOUD'), { lastMainForm: 'CLOUD', chainK: 3 }, STUB, R1)).toBe(0);
    expect(chainAfter(ref('PODS'), { lastMainForm: 'POD', chainK: 3 }, STUB, R1)).toBe(0);
    expect(chainAfter(ref('PODS'), { lastMainForm: 'KUBERNETES', chainK: 3 }, STUB, R1)).toBe(4);
  });

  it('a previous form missing from the pinned index never links (defensive)', () => {
    expect(chainAfter(ref('CLOUD'), { lastMainForm: 'NOTAWORD', chainK: 1 }, STUB, R1)).toBe(0);
  });
});

describe('preview (R-SCORE-009)', () => {
  it('P-SCORE-009-a/b and GC-SCORE-05: Σ base + Full Stack, no lexicon access, AIM previews like any word', () => {
    const board = boardWith([
      [7, 6, 'A'],
      [7, 7, 'I'],
    ]);
    const tiles: Placement[] = [{ row: 7, col: 8, tile: 'M' }];
    const g = checkPlacementGeometry({ board, layout, rack: 'M', tiles, rules: R1 });
    if (!g.ok) throw new Error('geometry');
    const preview = previewPlacement(g.value.words, tiles.length, layout, letters, R1);
    expect(preview.total).toBe(5); // A1 + I1 + M3, (7,8) is plain in classic-v1
    expect(preview.words).toEqual([
      {
        form: 'AIM',
        main: true,
        start: { row: 7, col: 6 },
        direction: 'row',
        letterSum: 5,
        wordMult: 1,
        base: 5,
      },
    ]);
    // P-SCORE-009-a by construction: the preview takes no lexicon parameter (API-7). Its parameters are
    // (words, tilesPlaced, layout, letters, rules): the fifth is the match's rules (ADR-0014 §D1), not a lexicon.
    expect(previewPlacement).toHaveLength(5);
  });

  it('P-SCORE-009-c: committed − preview = Σ termBonus + chain, ≥ 0, on every golden case', () => {
    for (const c of cases) {
      const placement = checked(c);
      const context = {
        lastMainForm: c.context?.prevMainTerm ?? '',
        chainK: c.context?.chainK ?? 0,
      };
      const committed = scorePlacement(placement, layout, letters, context, STUB, R1);
      const preview = previewPlacement(
        placement.words,
        placement.tiles.length,
        layout,
        letters,
        R1,
      );
      const delta = committed.words.reduce((s, w) => s + w.termBonus, 0) + committed.chain;
      expect(committed.total - preview.total, c.id).toBe(delta);
      expect(delta).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('property: word base vs a rational oracle (P-SCORE-001-a/b/c, P-SCORE-007)', () => {
  const VALUES: Readonly<Record<string, number>> = Object.fromEntries(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l, i) => [l, letters.values[i] ?? 0]),
  );
  const cell = fc.record({
    row: fc.integer({ min: 0, max: 14 }),
    col: fc.integer({ min: 0, max: 14 }),
    tile: fc.constantFrom('A', 'K', 'Z', 'q', 'E', 'x'),
    isNew: fc.boolean(),
  });

  it('matches Σ value × letterMult (new) × Π wordMult (new); covered premiums never count', () => {
    fc.assert(
      fc.property(fc.array(cell, { minLength: 2, maxLength: 15 }), (cells) => {
        const word = {
          form: '',
          main: true,
          start: { row: 0, col: 0 },
          direction: 'row' as const,
          cells: cells as never,
        };
        const got = wordBase(word, layout, letters);
        let sum = 0;
        let mult = 1;
        let plainSum = 0;
        for (const c of cells) {
          const v = c.tile === c.tile.toLowerCase() ? 0 : (VALUES[c.tile] ?? 0);
          plainSum += v;
          const kind = layout.squares[c.row * 15 + c.col];
          if (!c.isNew) {
            sum += v;
            continue;
          }
          sum += v * (kind === 'DL' ? 2 : kind === 'TL' ? 3 : 1);
          mult *= kind === 'DW' ? 2 : kind === 'TW' ? 3 : 1;
        }
        expect(got).toEqual({ letterSum: sum, wordMult: mult, base: sum * mult });
        expect(Number.isSafeInteger(got.base)).toBe(true);
        // Monotonic: premiums under new tiles never lower the score vs all-plain squares.
        expect(got.base).toBeGreaterThanOrEqual(plainSum);
        // Premiums applied once: the same cells already covered score their face value only.
        const covered = wordBase(
          { ...word, cells: cells.map((c) => ({ ...c, isNew: false })) },
          layout,
          letters,
        );
        expect(covered).toEqual({ letterSum: plainSum, wordMult: 1, base: plainSum });
      }),
      { seed: 8, numRuns: 500 },
    );
  });
});

describe('fixture-layout golden cases (RULE_PROPERTIES §3: GC-SCORE-02, GC-SCORE-03)', () => {
  /** A fixture layout: only the named premiums, everything else plain (RULE_PROPERTIES §3 convention). */
  function fixtureLayout(
    premiums: readonly (readonly [number, number, 'DL' | 'TL' | 'DW' | 'TW'])[],
  ): Layout {
    const squares: SquareKind[] = new Array<SquareKind>(225).fill('plain');
    for (const [r, c, kind] of premiums) squares[r * 15 + c] = kind;
    return { ...layout, squares };
  }

  function score(
    board: Parameters<typeof boardWith>[0],
    tiles: Placement[],
    fixture: Layout,
    context = { lastMainForm: '', chainK: 0 },
  ): ReturnType<typeof scorePlacement> {
    const rack = tiles.map((t) => t.tile).join('');
    const r = checkPlacement(
      { board: boardWith(board), layout: fixture, rack, tiles, rules: R1 },
      CTX.lexicon,
    );
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return scorePlacement(r.value, fixture, letters, context, CTX.lexicon, R1);
  }

  it('GC-SCORE-02: DNS 10 + CDN 15 with the shared DL = 25; TCP → DNS is no link', () => {
    const b = score(
      [
        [7, 6, 'C'],
        [7, 7, 'D'],
      ],
      [
        { row: 6, col: 8, tile: 'D' },
        { row: 7, col: 8, tile: 'N' },
        { row: 8, col: 8, tile: 'S' },
      ],
      fixtureLayout([[7, 8, 'DL']]),
      { lastMainForm: 'TCP', chainK: 0 },
    );
    expect(b.words.map((w) => [w.form, w.total])).toEqual([
      ['DNS', 10],
      ['CDN', 15],
    ]);
    expect(b.chain).toBe(0);
    expect(b.total).toBe(25);
  });

  it('GC-SCORE-03: single I above P of TCP → IP 4 + chain 5 (TCP uses IP) = 9', () => {
    const b = score(
      [
        [7, 6, 'T'],
        [7, 7, 'C'],
        [7, 8, 'P'],
      ],
      [{ row: 6, col: 8, tile: 'I' }],
      fixtureLayout([[6, 8, 'DL']]),
      { lastMainForm: 'TCP', chainK: 0 },
    );
    expect(b).toMatchObject({ chain: 5, chainKAfter: 1, total: 9 });
  });
});
