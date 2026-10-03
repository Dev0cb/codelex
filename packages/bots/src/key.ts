/**
 * Canonical action key (bots-api §4.4, O-4 accepted): `P` + per canonical tile `RRCCt`; `X` + sorted tiles for
 * an exchange; `S` for a pass. A bijection of the ADR-0013 §D2 canonical form, ordered by code unit: the total
 * order of ADR-0013 §D4.7 without `JSON.stringify`.
 */
import type { ExchangeAction, PassAction, Placement, PlaceWordAction } from '@codelex/game-engine';

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
