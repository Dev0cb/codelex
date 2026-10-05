/**
 * Rules tables (data only; the registry in `registry.ts` says which version uses which):
 * - `engineRulesVersion` 1 (GAME_RULES v0.3.1, frozen): the `classic-v1` premium layout (§2.1), the `letters-v1`
 *   letter table (§3.1) and `RULES_V1`. Changing any value is forbidden (ADR-0013 §D5, ADR-0014 §D1).
 * - `engineRulesVersion` 2 (draft, ADR-0014 §D4): `classic-v2` (plain start, b2-response D4 / §6), the
 *   `letters-v2` table derived from batch 3 (L7) and the two term-bonus candidates (D3). May change until the
 *   freeze (R4).
 * There is no runtime derivation path (P-BAG-001-f).
 */
import type { Layout, LayoutId, LetterTable, LetterTableId, Rules, SquareKind } from '../types.js';

const SIZE = 15;

/** GAME_RULES §2.1 table, one entry per premium square `(row, col)`. */
const CLASSIC_V1_PREMIUMS: readonly (readonly [
  SquareKind,
  readonly (readonly [number, number])[],
])[] = [
  [
    'TW',
    [
      [0, 3],
      [0, 11],
      [3, 0],
      [3, 14],
      [11, 0],
      [11, 14],
      [14, 3],
      [14, 11],
    ],
  ],
  [
    'DW',
    [
      [1, 4],
      [1, 10],
      [2, 2],
      [2, 12],
      [4, 1],
      [4, 13],
      [7, 7],
      [10, 1],
      [10, 13],
      [12, 2],
      [12, 12],
      [13, 4],
      [13, 10],
    ],
  ],
  [
    'TL',
    [
      [3, 3],
      [3, 11],
      [4, 6],
      [4, 8],
      [6, 4],
      [6, 10],
      [8, 4],
      [8, 10],
      [10, 6],
      [10, 8],
      [11, 3],
      [11, 11],
    ],
  ],
  [
    'DL',
    [
      [0, 7],
      [1, 2],
      [1, 12],
      [2, 1],
      [2, 7],
      [2, 13],
      [3, 5],
      [3, 9],
      [4, 4],
      [4, 10],
      [5, 3],
      [5, 11],
      [7, 0],
      [7, 2],
      [7, 12],
      [7, 14],
      [9, 3],
      [9, 11],
      [10, 4],
      [10, 10],
      [11, 5],
      [11, 9],
      [12, 1],
      [12, 7],
      [12, 13],
      [13, 2],
      [13, 12],
      [14, 7],
    ],
  ],
];

const START = Object.freeze({ row: 7, col: 7 });

/** The §2.1 grid; `plainStart` leaves the start square without premium (classic-v2, GAME_RULES 0.4 §2.2 draft). */
function buildSquares(plainStart: boolean): readonly SquareKind[] {
  const squares = new Array<SquareKind>(SIZE * SIZE).fill('plain');
  for (const [kind, coordinates] of CLASSIC_V1_PREMIUMS) {
    for (const [row, col] of coordinates) squares[row * SIZE + col] = kind;
  }
  if (plainStart) squares[START.row * SIZE + START.col] = 'plain';
  return Object.freeze(squares);
}

const CLASSIC_V1: Layout = Object.freeze({
  id: 'classic-v1',
  size: SIZE,
  start: START,
  squares: buildSquares(false),
});

/** R-BOARD-004 v2 (draft): identical to classic-v1 except the start square (7,7), which is plain. */
const CLASSIC_V2: Layout = Object.freeze({
  id: 'classic-v2',
  size: SIZE,
  start: START,
  squares: buildSquares(true),
});

/** GAME_RULES §3.1: index = LetterCode (0 = 'A'). */
const LETTERS_V1: LetterTable = Object.freeze({
  id: 'letters-v1',
  // prettier-ignore
  values: Object.freeze([1, 3, 2, 3, 1, 4, 3, 3, 1, 8, 5, 2, 3, 1, 1, 2, 8, 1, 1, 1, 2, 6, 5, 8, 4, 10]),
  // prettier-ignore
  counts: Object.freeze([8, 2, 5, 3, 9, 1, 3, 2, 7, 1, 1, 4, 3, 6, 7, 4, 1, 8, 6, 8, 3, 1, 1, 1, 2, 1]),
  blanks: 2,
  blankValue: 0,
});

/**
 * `letters-v2` (DRAFT, `engineRulesVersion` 2; task L7, b2-response T-4a). Derived by `tools/letters/derive.mjs`
 * (BALANCE.md R-BAG-001 steps 1–5) from the batch-3 lexicon: `lexiconVersion` e568477b5592a994, profile
 * `global-ranked` with inflections, 2,154 forms. Adjustments: 5a K 1 → 2 tiles (from S), 5c J/X/Z → 8 (Q, the
 * rarest letter, keeps 10). Derivation record: BALANCE.md "Derivation record — `letters-v2`". May change until
 * the freeze (R4); never derived at runtime. Independent of the lexicon `gameValue` (ADR-0014 §D5).
 */
const LETTERS_V2: LetterTable = Object.freeze({
  id: 'letters-v2',
  // prettier-ignore
  values: Object.freeze([1, 3, 2, 2, 1, 4, 3, 3, 1, 8, 4, 2, 2, 1, 1, 2, 10, 1, 1, 1, 2, 6, 5, 8, 5, 8]),
  // prettier-ignore
  counts: Object.freeze([8, 2, 5, 4, 10, 1, 2, 2, 6, 1, 2, 4, 3, 5, 7, 4, 1, 7, 9, 7, 3, 1, 1, 1, 1, 1]),
  blanks: 2,
  blankValue: 0,
});

// Lookups by id only (never iterated): a typed id outside the union is a programmer error.
const LAYOUTS: ReadonlyMap<string, Layout> = new Map([
  [CLASSIC_V1.id, CLASSIC_V1],
  [CLASSIC_V2.id, CLASSIC_V2],
]);
const LETTER_TABLES: ReadonlyMap<string, LetterTable> = new Map([
  [LETTERS_V1.id, LETTERS_V1],
  [LETTERS_V2.id, LETTERS_V2],
]);

/** The premium layout of a layout id (R-BOARD-002). Which version allows which id: `rulesFor(v).layouts`. */
export function getLayout(id: LayoutId): Layout {
  const layout = LAYOUTS.get(id);
  if (layout === undefined) throw new RangeError('unknown layout id');
  return layout;
}

/** The letter table of a table id (R-BAG-001). Which version allows which id: `rulesFor(v).letterTables`. */
export function getLetterTable(id: LetterTableId): LetterTable {
  const table = LETTER_TABLES.get(id);
  if (table === undefined) throw new RangeError('unknown letter table id');
  return table;
}

/** Every other outcome-affecting constant of rules version 1 (GAME_RULES v0.3.1). Frozen. */
export const RULES_V1: Rules = Object.freeze({
  rackSize: 7,
  minFirstMoveTiles: 2,
  minBagForExchange: 7,
  scorelessTurnsPerSeat: 3,
  fullStackTiles: 7,
  fullStackBonus: 50,
  termBonus: Object.freeze({ novice: 0, intermediate: 4, advanced: 8, expert: 16 }),
  chainStep: 5,
  chainCap: 5,
});

/** v2 draft rules: v1 with another R-SCORE-003 term bonus (b2-response D3); nothing else changes. */
function v2Rules(intermediate: number, advanced: number, expert: number): Rules {
  return Object.freeze({
    ...RULES_V1,
    termBonus: Object.freeze({ novice: 0, intermediate, advanced, expert }),
  });
}

/** Draft candidate A of the v2 `/balance-check` (v2-balance-check §2 `v2-3612`): 0/3/6/12. */
export const RULES_V2_TB_0_3_6_12: Rules = v2Rules(3, 6, 12);
/** Draft candidate B (`v2-248`), the D3 lead candidate and the GAME_RULES 0.4 diff value: 0/2/4/8. */
export const RULES_V2_TB_0_2_4_8: Rules = v2Rules(2, 4, 8);

/**
 * Deprecated (ADR-0014 §D6): `rulesFor(1).rules`, kept for one release so that consumers (bots, B3) migrate.
 * Engine code never reads it; read `rulesFor(version).rules` instead.
 */
export const RULES: Rules = RULES_V1;

/** Premium of a square; `plain` outside the board is never asked for (callers check bounds first). */
export function squareKind(layout: Layout, row: number, col: number): SquareKind {
  return layout.squares[row * layout.size + col] ?? 'plain';
}
