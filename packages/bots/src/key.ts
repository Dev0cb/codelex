/**
 * Canonical action key (bots-api §4.4, O-4 accepted): `P` + per canonical tile `RRCCt`; `X` + sorted tiles for
 * an exchange; `S` for a pass. A bijection of the ADR-0013 §D2 canonical form, ordered by code unit: the total
 * order of ADR-0013 §D4.7 without `JSON.stringify`.
 *
 * Generation never builds keys (B4 cheaper key build): it deduplicates with a packed integer signature
 * (`movegen/common.ts`), and the policies build the string key only for the candidates they keep, or order
 * candidates with `comparePlacements`, which is the same order as `compareKeys` over `placementKey`.
 */
import type { ExchangeAction, PassAction, Placement, PlaceWordAction } from '@codelex/game-engine';
import type { Candidate } from './movegen/types.js';

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

/** Key of canonical placements (sorted by (row, col)). */
export function placementKey(tiles: readonly Placement[]): string {
  let key = 'P';
  for (const t of tiles) key += pad2(t.row) + pad2(t.col) + t.tile;
  return key;
}

export function actionKey(action: PlaceWordAction | ExchangeAction | PassAction): string {
  switch (action.type) {
    case 'PLACE_WORD':
      return placementKey(action.tiles);
    case 'EXCHANGE':
      return `X${action.tiles.join('')}`;
    case 'PASS':
      return 'S';
  }
}

/** Code-unit comparator (ADR-0013 §D4.2-3: never locale-dependent). */
export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `compareKeys(placementKey(a), placementKey(b))` without building either string: the key is a sequence of
 * fixed-width `RRCCt` blocks after a common `P`, so code-unit order is (row, col, tile char) block by block, a
 * proper prefix first. Row and column are < 100, so two zero-padded digits order like the numbers.
 */
export function comparePlacements(a: readonly Placement[], b: readonly Placement[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i] as Placement;
    const y = b[i] as Placement;
    if (x.row !== y.row) return x.row < y.row ? -1 : 1;
    if (x.col !== y.col) return x.col < y.col ? -1 : 1;
    if (x.tile !== y.tile) return x.tile < y.tile ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** Canonical key of a generated candidate (built on demand, for kept candidates only). */
export function candidateKey(candidate: Candidate): string {
  return placementKey(candidate.action.tiles);
}

/** Candidates sorted by canonical key (the order used for sampling, independent of the automaton). */
export function byKey(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => comparePlacements(a.action.tiles, b.action.tiles));
}
