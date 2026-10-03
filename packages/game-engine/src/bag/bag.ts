/**
 * Bag operations (R-BAG-003, R-BAG-005): draws take tiles from the head; an exchange draws first, then appends
 * the returned tiles and reshuffles the whole bag with the persisted `bag` stream state.
 */
import { err, ok, type Result } from '@codelex/config/result';
import { exchangeRejection, rackRejection } from '../errors.js';
import { createRng } from '../rng/index.js';
import { RULES } from '../rules/constants.js';
import { chars, removeTiles, sortTiles } from '../tiles.js';
import type { RackTile, Rejection, TileString } from '../types.js';

export type BagRngState = readonly [number, number, number, number];

export interface Draw {
  /** Tiles drawn, in draw order. */
  readonly drawn: TileString;
  readonly bag: TileString;
}

/** Takes `min(count, bag.length)` tiles from the head (R-BAG-003: a short bag gives what it has). */
export function drawTiles(bag: TileString, count: number): Draw {
  const n = Math.max(0, Math.min(count, bag.length));
  return { drawn: bag.slice(0, n), bag: bag.slice(n) };
}

/** Refills `rack` to the rack size from the bag; returns the sorted rack and the drawn tiles. */
export function refillRack(
  rack: TileString,
  bag: TileString,
): Draw & { readonly rack: TileString } {
  const draw = drawTiles(bag, RULES.rackSize - rack.length);
  return { ...draw, rack: sortTiles(rack + draw.drawn) };
}

export interface Exchanged {
  /** Rack after the exchange, sorted; same size as before (P-BAG-005-c). */
  readonly rack: TileString;
  /** Tiles drawn, in draw order. */
  readonly drawn: TileString;
  /** Sorted returned tiles. */
  readonly returned: TileString;
  readonly bag: TileString;
  readonly rng: BagRngState;
}

/**
 * Validates and performs an exchange of canonical `tiles` (API note §8.3: `exchange` tile_count →
 * `exchange` bag_too_small → `rack`). The returned tiles are never redrawn in the same exchange.
 */
export function exchangeTiles(
  rack: TileString,
  bag: TileString,
  rng: BagRngState,
  tiles: readonly RackTile[],
): Result<Exchanged, Rejection> {
  if (tiles.length === 0 || tiles.length > RULES.rackSize) {
    return err(exchangeRejection('tile_count'));
  }
  if (bag.length < RULES.minBagForExchange) return err(exchangeRejection('bag_too_small'));
  const { rest, missing } = removeTiles(rack, tiles);
  if (missing !== '') return err(rackRejection(missing));

  const draw = drawTiles(bag, tiles.length);
  const returned = sortTiles(tiles);
  const generator = createRng(rng);
  const reshuffled = generator.shuffle(chars(draw.bag + returned)).join('');
  const [s0, s1, s2, s3] = generator.state();
  return ok({
    rack: sortTiles(rest + draw.drawn),
    drawn: draw.drawn,
    returned,
    bag: reshuffled,
    rng: [s0, s1, s2, s3],
  });
}
