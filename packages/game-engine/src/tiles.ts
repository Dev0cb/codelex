/**
 * Tile encoding helpers (ADR-0013 §D3, API note §4): racks and bag are strings of `A`–`Z` and `?` (blank);
 * board squares hold `.`, `A`–`Z` or a designated blank `a`–`z`. ASCII only; explicit comparators only.
 */
import type { BoardTile, LetterTable, RackTile, TileString } from './types.js';

export const EMPTY_SQUARE = '.';
export const BLANK: RackTile = '?';
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const CODE_A = 65;
const CODE_Z = 90;
const CODE_LOWER_A = 97;
const CODE_LOWER_Z = 122;
/** Index of the blank in a 27-slot count array (0..25 = 'A'..'Z'). */
export const BLANK_SLOT = 26;

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One-char `A`–`Z`. */
export function isLetter(value: unknown): value is RackTile {
  if (typeof value !== 'string' || value.length !== 1) return false;
  const code = value.charCodeAt(0);
  return code >= CODE_A && code <= CODE_Z;
}

/** One-char `A`–`Z` or `?`. */
export function isRackTile(value: unknown): value is RackTile {
  return value === BLANK || isLetter(value);
}

/** One-char `A`–`Z` or `a`–`z` (designated blank). */
export function isBoardTile(value: unknown): value is BoardTile {
  if (typeof value !== 'string' || value.length !== 1) return false;
  const code = value.charCodeAt(0);
  return (code >= CODE_A && code <= CODE_Z) || (code >= CODE_LOWER_A && code <= CODE_LOWER_Z);
}

/** True for a designated blank on the board (`a`–`z`). */
export function isBlankOnBoard(tile: string): boolean {
  const code = tile.charCodeAt(0);
  return code >= CODE_LOWER_A && code <= CODE_LOWER_Z;
}

/** The rack tile a board tile consumes: a designated blank consumes `?`. */
export function rackTileOf(tile: BoardTile): RackTile {
  return isBlankOnBoard(tile) ? BLANK : (tile as RackTile);
}

/** The letter a board tile reads as in a word (R-BAG-006 d). */
export function letterOf(tile: string): string {
  return tile.toUpperCase();
}

/** The chars of an ASCII tile string, one per element. */
export function chars(tiles: string): string[] {
  return Array.from({ length: tiles.length }, (_, i) => tiles.charAt(i));
}

/** Sorted multiset string (ascending code unit, so `?` first). */
export function sortTiles(tiles: string | readonly string[]): TileString {
  return (typeof tiles === 'string' ? chars(tiles) : [...tiles]).sort(byCodeUnit).join('');
}

/** Counts per slot: 0..25 = 'A'..'Z', 26 = blank. Ignores other chars (callers pass validated tiles). */
export function countTiles(tiles: string | readonly string[]): number[] {
  const counts = new Array<number>(27).fill(0);
  for (const tile of typeof tiles === 'string' ? chars(tiles) : tiles) {
    const slot = tile === BLANK ? BLANK_SLOT : tile.charCodeAt(0) - CODE_A;
    if (slot >= 0 && slot <= BLANK_SLOT) counts[slot] = (counts[slot] ?? 0) + 1;
  }
  return counts;
}

/**
 * Multiset difference `rack − tiles`. `missing` lists (sorted) the requested tiles the rack cannot supply;
 * `rest` is the sorted rack after removal (meaningful only when `missing` is empty).
 */
export function removeTiles(
  rack: TileString,
  tiles: readonly RackTile[],
): { readonly rest: TileString; readonly missing: TileString } {
  const available = countTiles(rack);
  const missing: string[] = [];
  for (const tile of tiles) {
    const slot = tile === BLANK ? BLANK_SLOT : tile.charCodeAt(0) - CODE_A;
    const left = available[slot] ?? 0;
    if (left > 0) available[slot] = left - 1;
    else missing.push(tile);
  }
  let rest = BLANK.repeat(available[BLANK_SLOT] ?? 0);
  for (let slot = 0; slot < 26; slot += 1) {
    rest += LETTERS.charAt(slot).repeat(available[slot] ?? 0);
  }
  return { rest, missing: sortTiles(missing) };
}

/** The full bag of a letter table, sorted ascending (`??AAAAAAAAB…Z`, API note §7.2 step 3). */
export function initialBag(table: LetterTable): TileString {
  let bag = BLANK.repeat(table.blanks);
  for (let slot = 0; slot < 26; slot += 1) {
    bag += LETTERS.charAt(slot).repeat(table.counts[slot] ?? 0);
  }
  return bag;
}

/** Face value of a rack or board tile: blanks (`?` and `a`–`z`) score 0 (R-BAG-006). */
export function tileValue(table: LetterTable, tile: string): number {
  const code = tile.charCodeAt(0);
  if (code < CODE_A || code > CODE_Z) return table.blankValue;
  return table.values[code - CODE_A] ?? 0;
}
