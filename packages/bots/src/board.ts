/**
 * Per-decision board view for move generation (bots-api §4.1 steps 1–2): letter codes per square, anchors and
 * cross-check masks. Scratch arrays are allocated per call (no module state, API note §17). Cross-checks use
 * the index's `crossCheck` once per empty square and direction that has perpendicular neighbours (≤ 2 × 225
 * calls), outside the node budget (BOT-3).
 */
import type { Layout, Observation, Square } from '@codelex/game-engine';
import type { LetterCode, LetterMask, LexiconIndex } from '@codelex/lexicon/index';

export const EMPTY = -1;
/** Every letter allowed. */
export const ALL_LETTERS: LetterMask = (1 << 26) - 1;
export const BLANK = 26;
const CODE_A = 65;
const CODE_LOWER_A = 97;

export interface BoardView {
  readonly size: number;
  readonly start: Square;
  /** Row-major letter codes; `EMPTY` for an empty square (a blank on the board reads as its letter). */
  readonly codes: readonly number[];
  /** True when no tile is on the board (first move). */
  readonly empty: boolean;
  /** Row-major; true for empty squares next to a tile, or the start square on an empty board. */
  readonly anchors: readonly boolean[];
  /** Letters allowed on a square by the column cross-word, for a move along a row. */
  readonly crossRow: readonly LetterMask[];
  /** Letters allowed on a square by the row cross-word, for a move along a column. */
  readonly crossCol: readonly LetterMask[];
}

/** Letter code of a board char, or `EMPTY`. */
export function codeOf(ch: string): number {
  if (ch === '.' || ch === '') return EMPTY;
  const c = ch.charCodeAt(0);
  return c >= CODE_LOWER_A ? c - CODE_LOWER_A : c - CODE_A;
}

/** 27 counts (index 26 = blank) of a rack TileString. */
export function rackCounts(rack: string): number[] {
  const counts = new Array<number>(27).fill(0);
  for (let i = 0; i < rack.length; i += 1) {
    const ch = rack.charAt(i);
    const slot = ch === '?' ? BLANK : ch.charCodeAt(0) - CODE_A;
    if (slot >= 0 && slot <= BLANK) counts[slot] = (counts[slot] ?? 0) + 1;
  }
  return counts;
}

function crossMask(
  lexicon: LexiconIndex,
  codes: readonly number[],
  size: number,
  row: number,
  col: number,
  dRow: number,
  dCol: number,
): LetterMask {
  const before: LetterCode[] = [];
  for (let r = row - dRow, c = col - dCol; r >= 0 && c >= 0; r -= dRow, c -= dCol) {
    const code = codes[r * size + c] ?? EMPTY;
    if (code === EMPTY) break;
    before.push(code);
  }
  before.reverse();
  const after: LetterCode[] = [];
  for (let r = row + dRow, c = col + dCol; r < size && c < size; r += dRow, c += dCol) {
    const code = codes[r * size + c] ?? EMPTY;
    if (code === EMPTY) break;
    after.push(code);
  }
  if (before.length === 0 && after.length === 0) return ALL_LETTERS;
  return lexicon.crossCheck(before, after) & ALL_LETTERS;
}

export function boardView(obs: Observation, layout: Layout, lexicon: LexiconIndex): BoardView {
  const size = layout.size;
  const codes: number[] = new Array<number>(size * size).fill(EMPTY);
  let empty = true;
  for (let row = 0; row < size; row += 1) {
    const line = obs.board[row] ?? '';
    for (let col = 0; col < size; col += 1) {
      const code = codeOf(line.charAt(col));
      codes[row * size + col] = code;
      if (code !== EMPTY) empty = false;
    }
  }
  const occupied = (row: number, col: number): boolean =>
    row >= 0 && col >= 0 && row < size && col < size && codes[row * size + col] !== EMPTY;

  const anchors: boolean[] = new Array<boolean>(size * size).fill(false);
  const crossRow: LetterMask[] = new Array<number>(size * size).fill(ALL_LETTERS);
  const crossCol: LetterMask[] = new Array<number>(size * size).fill(ALL_LETTERS);
  if (empty) {
    anchors[layout.start.row * size + layout.start.col] = true;
  } else {
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const sq = row * size + col;
        if (codes[sq] !== EMPTY) continue;
        const vertical = occupied(row - 1, col) || occupied(row + 1, col);
        const horizontal = occupied(row, col - 1) || occupied(row, col + 1);
        anchors[sq] = vertical || horizontal;
        if (vertical) crossRow[sq] = crossMask(lexicon, codes, size, row, col, 1, 0);
        if (horizontal) crossCol[sq] = crossMask(lexicon, codes, size, row, col, 0, 1);
      }
    }
  }
  return { size, start: layout.start, codes, empty, anchors, crossRow, crossCol };
}
