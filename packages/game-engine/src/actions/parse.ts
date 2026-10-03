/**
 * Runtime shape check and canonicalisation of actions (API note §8.1, §8.2 `malformed`, §13.7: actions are never
 * trusted). Produces fresh objects with only the known keys; PLACE_WORD tiles sorted by (row, col), EXCHANGE
 * tiles sorted by code unit. Placement geometry (count, bounds, duplicates) is checked later (§8.3 step 5).
 */
import { err, ok, type Result } from '@codelex/config/result';
import { malformed } from '../errors.js';
import { isJcsInteger } from '../hash/jcs.js';
import { isBoardTile, isRackTile, BLANK } from '../tiles.js';
import type { Action, Placement, RackTile, Rejection } from '../types.js';

const ACTION_KEYS: Readonly<Record<Action['type'], readonly string[]>> = {
  PLACE_WORD: ['seat', 'tiles', 'type'],
  EXCHANGE: ['seat', 'tiles', 'type'],
  PASS: ['seat', 'type'],
  RESIGN: ['seat', 'type'],
};
const PLACEMENT_KEYS = ['col', 'row', 'tile'];

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isActionType(value: unknown): value is Action['type'] {
  return value === 'PLACE_WORD' || value === 'EXCHANGE' || value === 'PASS' || value === 'RESIGN';
}

/** First unknown key in sorted order, prefixed with `path`. */
function unknownKey(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string,
): Rejection | undefined {
  const extra = Object.keys(value)
    .sort(byCodeUnit)
    .find((k) => !allowed.includes(k));
  return extra === undefined ? undefined : malformed('unknown_field', `${path}${extra}`);
}

/** `(row, col, tile)` ascending: a total order, so even duplicate squares have one canonical order (n2). */
export function comparePlacements(a: Placement, b: Placement): number {
  return a.row - b.row || a.col - b.col || byCodeUnit(a.tile, b.tile);
}

function parsePlacement(value: unknown, index: number): Result<Placement, Rejection> {
  const path = `tiles[${String(index)}]`;
  if (!isPlainObject(value)) return err(malformed('bad_tile', path));
  const extra = unknownKey(value, PLACEMENT_KEYS, `${path}.`);
  if (extra !== undefined) return err(extra);
  const { row, col, tile } = value;
  // `-0` is a safe integer but outside the JCS subset (ADR-0013 §D3): it would make the log unhashable.
  if (!isJcsInteger(row)) return err(malformed('bad_coordinate', `${path}.row`));
  if (!isJcsInteger(col)) return err(malformed('bad_coordinate', `${path}.col`));
  if (tile === BLANK) return err(malformed('blank_undesignated', `${path}.tile`));
  if (!isBoardTile(tile)) return err(malformed('bad_tile', `${path}.tile`));
  return ok({ row, col, tile });
}

/**
 * Parses an untrusted action for a match with `seats` seats. Checks, in order: plain object with a known `type`
 * (`unknown_type`), no unknown key (`unknown_field`, first in sorted order), `seat` a safe integer in
 * `[0, seats)` other than `-0` (`seat_out_of_range`), then each tile in index order (`bad_coordinate` for a
 * coordinate that is not a safe integer or is `-0`, `blank_undesignated`, `bad_tile`). Returns the canonical
 * action.
 */
export function parseAction(input: unknown, seats: number): Result<Action, Rejection> {
  if (!isPlainObject(input)) return err(malformed('unknown_type', ''));
  const type = input['type'];
  if (!isActionType(type)) return err(malformed('unknown_type', 'type'));
  const extra = unknownKey(input, ACTION_KEYS[type], '');
  if (extra !== undefined) return err(extra);
  const seat = input['seat'];
  if (!isJcsInteger(seat) || seat < 0 || seat >= seats) {
    return err(malformed('seat_out_of_range', 'seat'));
  }
  if (type === 'PASS' || type === 'RESIGN') return ok({ seat, type });

  const tiles = input['tiles'];
  if (!Array.isArray(tiles)) return err(malformed('bad_tile', 'tiles'));
  const items = tiles as readonly unknown[];
  if (type === 'EXCHANGE') {
    const rackTiles: RackTile[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const tile = items[i];
      if (!isRackTile(tile)) return err(malformed('bad_tile', `tiles[${String(i)}]`));
      rackTiles.push(tile);
    }
    return ok({ seat, type, tiles: rackTiles.sort(byCodeUnit) });
  }
  const placements: Placement[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const parsed = parsePlacement(items[i], i);
    if (!parsed.ok) return parsed;
    placements.push(parsed.value);
  }
  return ok({ seat, type, tiles: placements.sort(comparePlacements) });
}
