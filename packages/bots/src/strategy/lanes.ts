/**
 * Strategist lane blocking and premium denial (spec S-2 `D`) and the overflow attention key (S-1). Board analysis
 * only (engine API Q10): premium squares from the layout, letters from the board view; never a score.
 */
import type { Placement, SquareKind } from '@codelex/game-engine';
import { EMPTY } from '../board.js';
import type { StrategyData } from '../types.js';

const STEPS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * An empty TW or DW square is hot when a tile lies within `laneReach` squares along its row or column with only
 * empty squares in between (an orthogonally adjacent tile is the distance-1 case).
 */
export function isHot(
  codes: readonly number[],
  size: number,
  row: number,
  col: number,
  reach: number,
): boolean {
  for (const [dRow, dCol] of STEPS) {
    for (let d = 1; d <= reach; d += 1) {
      const r = row + dRow * d;
      const c = col + dCol * d;
      if (r < 0 || c < 0 || r >= size || c >= size) break;
      if ((codes[r * size + c] ?? EMPTY) !== EMPTY) return true;
    }
  }
  return false;
}

export interface HotCount {
  readonly tw: number;
  readonly dw: number;
}

/** Hot TW and DW squares of a board. */
export function hotSquares(
  codes: readonly number[],
  squares: readonly SquareKind[],
  size: number,
  reach: number,
): HotCount {
  let tw = 0;
  let dw = 0;
  for (let sq = 0; sq < size * size; sq += 1) {
    const kind = squares[sq];
    if ((kind !== 'TW' && kind !== 'DW') || (codes[sq] ?? EMPTY) !== EMPTY) continue;
    if (!isHot(codes, size, Math.floor(sq / size), sq % size, reach)) continue;
    if (kind === 'TW') tw += 1;
    else dw += 1;
  }
  return { tw, dw };
}

/** `exposure(board) = hotTwDp · #hot TW + hotDwDp · #hot DW`. */
export function exposure(
  codes: readonly number[],
  squares: readonly SquareKind[],
  size: number,
  s: StrategyData,
): number {
  const hot = hotSquares(codes, squares, size, s.laneReach);
  return s.hotTwDp * hot.tw + s.hotDwDp * hot.dw;
}

/** A scratch copy of `codes` with `tiles` placed (a blank reads as its letter). */
export function withTiles(
  codes: readonly number[],
  size: number,
  tiles: readonly Placement[],
): number[] {
  const out = [...codes];
  for (const t of tiles) {
    const c = t.tile.charCodeAt(0);
    out[t.row * size + t.col] = c >= 97 ? c - 97 : c - 65;
  }
  return out;
}

/** Denial weight (‰) for the score situation: leading, trailing, or even (also whenever the bag is empty). */
export function denialPermille(lead: number, bagCount: number, s: StrategyData): number {
  if (bagCount === 0) return s.denialEvenPermille;
  if (lead >= s.leadThreshold) return s.denialLeadPermille;
  if (lead <= -s.trailThreshold) return s.denialTrailPermille;
  return s.denialEvenPermille;
}

/**
 * Overflow attention key (S-1): `8 · tilesPlaced + 4 · (DW + TW newly covered) + (DL + TL newly covered)`. No
 * letter values and no randomness, so it is not a second scoring path.
 */
export function attentionKey(
  tiles: readonly Placement[],
  squares: readonly SquareKind[],
  size: number,
): number {
  let key = 8 * tiles.length;
  for (const t of tiles) {
    const kind = squares[t.row * size + t.col];
    if (kind === 'DW' || kind === 'TW') key += 4;
    else if (kind === 'DL' || kind === 'TL') key += 1;
  }
  return key;
}
