/** Direct access to the generation pipeline for tests (no policy, no fallback). */
import {
  evaluateMove,
  getLayout,
  observe,
  type MatchState,
  type Observation,
  type Placement,
  type PlaceWordAction,
} from '@codelex/game-engine';
import type { LexiconIndex } from '@codelex/lexicon/index';
import { boardView, rackCounts } from '../../src/board.js';
import { placementKey } from '../../src/key.js';
import { selectGenerator, type Generation } from '../../src/movegen/index.js';

export const UNBOUNDED = Number.MAX_SAFE_INTEGER;

export function generateFor(
  obs: Observation,
  lexicon: LexiconIndex,
  maxNodes = UNBOUNDED,
): Generation {
  return selectGenerator(lexicon).generate({
    view: boardView(obs, getLayout(obs.config.layout), lexicon),
    rack: rackCounts(obs.rack),
    seat: obs.seatOnTurn,
    maxNodes,
  });
}

export function observeOnTurn(state: MatchState): Observation {
  return observe(state, state.seatOnTurn);
}

const ROW_STEP = { row: 0, col: 1 } as const;
const COL_STEP = { row: 1, col: 0 } as const;

/**
 * Independent oracle (P-BOT-04 completeness): every PLACE_WORD of 1..maxTiles rack tiles on consecutive empty
 * squares of a line (existing tiles in between are skipped), touching a tile or covering the start square,
 * accepted by `evaluateMove`. Blanks try every letter. Returns canonical keys.
 */
export function bruteForceKeys(
  obs: Observation,
  lexicon: LexiconIndex,
  maxTiles: number,
): Set<string> {
  const layout = getLayout(obs.config.layout);
  const size = layout.size;
  const at = (r: number, c: number): string => obs.board[r]?.charAt(c) ?? '';
  const empty = (r: number, c: number): boolean => at(r, c) === '.';
  const boardEmpty = obs.board.every((row) => /^\.*$/.test(row));
  const touches = (r: number, c: number): boolean =>
    [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ].some(([rr, cc]) => {
      const t = at(rr ?? -1, cc ?? -1);
      return t !== '' && t !== '.';
    });

  const squareSets: { row: number; col: number }[][] = [];
  const seenSets = new Set<string>();
  for (const step of [ROW_STEP, COL_STEP]) {
    for (let r0 = 0; r0 < size; r0 += 1) {
      for (let c0 = 0; c0 < size; c0 += 1) {
        if (!empty(r0, c0)) continue;
        const squares: { row: number; col: number }[] = [];
        for (let r = r0, c = c0; r < size && c < size && squares.length < maxTiles;) {
          if (empty(r, c)) {
            squares.push({ row: r, col: c });
            const id = squares.map((s) => `${String(s.row)},${String(s.col)}`).join(';');
            const ok = boardEmpty
              ? squares.some((s) => s.row === layout.start.row && s.col === layout.start.col)
              : squares.some((s) => touches(s.row, s.col));
            if (ok && !seenSets.has(id)) {
              seenSets.add(id);
              squareSets.push([...squares]);
            }
          }
          r += step.row;
          c += step.col;
        }
      }
    }
  }

  const accepted = new Set<string>();
  const rack = Array.from(obs.rack);
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function assign(
    squares: readonly { row: number; col: number }[],
    used: boolean[],
    acc: Placement[],
  ): void {
    if (acc.length === squares.length) {
      const tiles = [...acc].sort((a, b) => a.row - b.row || a.col - b.col);
      const action: PlaceWordAction = { seat: obs.seatOnTurn, type: 'PLACE_WORD', tiles };
      if (evaluateMove(obs, action, { lexicon }).ok) accepted.add(placementKey(tiles));
      return;
    }
    const sq = squares[acc.length];
    if (sq === undefined) return;
    const tried = new Set<string>();
    for (let i = 0; i < rack.length; i += 1) {
      const tile = rack[i] ?? '';
      if (used[i] === true || tried.has(tile)) continue;
      tried.add(tile);
      used[i] = true;
      const letters = tile === '?' ? Array.from(LETTERS.toLowerCase()) : [tile];
      for (const letter of letters) {
        acc.push({ row: sq.row, col: sq.col, tile: letter as Placement['tile'] });
        assign(squares, used, acc);
        acc.pop();
      }
      used[i] = false;
    }
  }
  for (const squares of squareSets) assign(squares, [], []);
  return accepted;
}
