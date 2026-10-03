/**
 * Outcome-affecting constants of `engineRulesVersion` 1 (GAME_RULES v0.3): the `classic-v1` premium layout
 * (§2.1), the `letters-v1` letter table (§3.1) and `RULES`. Frozen: changing any value is an
 * `engineRulesVersion` bump (ADR-0013 §D5). There is no runtime derivation path (P-BAG-001-f).
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

function buildSquares(): readonly SquareKind[] {
  const squares = new Array<SquareKind>(SIZE * SIZE).fill('plain');
  for (const [kind, coordinates] of CLASSIC_V1_PREMIUMS) {
    for (const [row, col] of coordinates) squares[row * SIZE + col] = kind;
  }
  return Object.freeze(squares);
}

const CLASSIC_V1: Layout = Object.freeze({
  id: 'classic-v1',
  size: SIZE,
  start: Object.freeze({ row: 7, col: 7 }),
  squares: buildSquares(),
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

// Lookups by id only (never iterated): a typed id outside the union is a programmer error.
const LAYOUTS: ReadonlyMap<string, Layout> = new Map([[CLASSIC_V1.id, CLASSIC_V1]]);
const LETTER_TABLES: ReadonlyMap<string, LetterTable> = new Map([[LETTERS_V1.id, LETTERS_V1]]);

/** The premium layout of a layout id (R-BOARD-002). Only `classic-v1` exists in `engineRulesVersion` 1. */
export function getLayout(id: LayoutId): Layout {
  const layout = LAYOUTS.get(id);
  if (layout === undefined) throw new RangeError('unknown layout id');
  return layout;
}

/** The letter table of a table id (R-BAG-001). Only `letters-v1` exists in `engineRulesVersion` 1. */
export function getLetterTable(id: LetterTableId): LetterTable {
  const table = LETTER_TABLES.get(id);
  if (table === undefined) throw new RangeError('unknown letter table id');
  return table;
}

/** Every other outcome-affecting constant of rules version 1 (GAME_RULES v0.3). */
export const RULES: Rules = Object.freeze({
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

/** Premium of a square; `plain` outside the board is never asked for (callers check bounds first). */
export function squareKind(layout: Layout, row: number, col: number): SquareKind {
  return layout.squares[row * layout.size + col] ?? 'plain';
}
