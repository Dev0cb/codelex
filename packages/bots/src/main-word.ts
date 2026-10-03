/**
 * Main word of a candidate before evaluation (bots-api §5.3 step 1, BOT-9: reading the board and the lexicon
 * for filtering, never for points). Main line per R-TURN-006 b: several tiles → their line; one tile → the
 * longer run, ties to the row. The evaluated breakdown is authoritative; P-BOT-07 checks that both agree.
 */
import type { Placement } from '@codelex/game-engine';
import { DIFFICULTIES, type LexiconIndex } from '@codelex/lexicon/index';
import { codeOf, EMPTY, type BoardView } from './board.js';

function runCodes(
  view: BoardView,
  placed: ReadonlyMap<number, number>,
  row: number,
  col: number,
  dRow: number,
  dCol: number,
): number[] {
  const { size, codes } = view;
  const at = (r: number, c: number): number => {
    if (r < 0 || c < 0 || r >= size || c >= size) return EMPTY;
    const sq = r * size + c;
    return placed.get(sq) ?? codes[sq] ?? EMPTY;
  };
  let r = row;
  let c = col;
  while (at(r - dRow, c - dCol) !== EMPTY) {
    r -= dRow;
    c -= dCol;
  }
  const out: number[] = [];
  for (let code = at(r, c); code !== EMPTY; code = at(r, c)) {
    out.push(code);
    r += dRow;
    c += dCol;
  }
  return out;
}

export function mainWordCodes(view: BoardView, tiles: readonly Placement[]): number[] {
  const placed = new Map<number, number>();
  for (const t of tiles) placed.set(t.row * view.size + t.col, codeOf(t.tile));
  const first = tiles[0];
  if (first === undefined) return [];
  const rowRun = runCodes(view, placed, first.row, first.col, 0, 1);
  if (tiles.length > 1) {
    return tiles.every((t) => t.row === first.row)
      ? rowRun
      : runCodes(view, placed, first.row, first.col, 1, 0);
  }
  const colRun = runCodes(view, placed, first.row, first.col, 1, 0);
  return colRun.length > rowRun.length ? colRun : rowRun;
}

/** Difficulty rank (0 novice … 3 expert) of the main word's canonical term; 4 if it is not a playable form. */
export function mainDifficultyRank(
  view: BoardView,
  tiles: readonly Placement[],
  lexicon: LexiconIndex,
): number {
  const codes = mainWordCodes(view, tiles);
  const form = lexicon.lookupCodes(codes, 0, codes.length);
  if (form === undefined) return DIFFICULTIES.length;
  return DIFFICULTIES.indexOf(lexicon.difficulty(lexicon.termOf(form)));
}
