/**
 * Strategist leave valuation (spec S-2 `L`, S-4 best keep `K*`). Integers only, in dp (tenths of a point). Letter
 * values come from the observation's letter table, so a new table needs no code change (GD-5).
 */
import { BLANK } from '../board.js';
import type { StrategyData } from '../types.js';

/** ⌊a / b⌋ rounding toward −∞, also for negative `a` (ADR-0013 §D4.1); b > 0, safe integers. */
export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

const PERMILLE = 1000;
const HALF = 500;
/** A E I O U as LetterCodes. */
const VOWELS: readonly number[] = Object.freeze([0, 4, 8, 14, 20]);
const CODE_A = 65;
const BLANK_CHAR = '?';

/** `tileDp(l)` for a natural letter. */
export function letterDp(letter: number, values: readonly number[], s: StrategyData): number {
  const value = values[letter] ?? 0;
  return (
    Math.max(s.leaveFloorDp, s.leaveBaseDp - s.leavePerValueDp * value) +
    (s.leaveLetterBonusDp[letter] ?? 0)
  );
}

/** `raw(K)` for 27 tile counts (index 26 = blank): tile terms + vowel balance + duplicates. */
export function rawLeave(
  counts: readonly number[],
  values: readonly number[],
  s: StrategyData,
): number {
  let total = (counts[BLANK] ?? 0) * s.leaveBlankDp;
  let n = 0;
  let vowels = 0;
  for (let letter = 0; letter < BLANK; letter += 1) {
    const k = counts[letter] ?? 0;
    if (k === 0) continue;
    total += k * letterDp(letter, values, s);
    n += k;
    if (VOWELS.includes(letter)) vowels += k;
    if (k >= 2) total -= s.duplicateDp * (k - 1);
  }
  const ideal = floorDiv(n * s.vowelIdealPermille + HALF, PERMILLE);
  total -= s.vowelOffDp * Math.abs(vowels - ideal);
  if (n >= 3 && (vowels === 0 || vowels === n)) total -= s.vowelAllOrNoneDp;
  return total;
}

/** 27 counts of a TileString (`?` = blank). */
export function tileCounts(tiles: string): number[] {
  const counts = new Array<number>(BLANK + 1).fill(0);
  for (let i = 0; i < tiles.length; i += 1) {
    const ch = tiles.charAt(i);
    const slot = ch === BLANK_CHAR ? BLANK : ch.charCodeAt(0) - CODE_A;
    counts[slot] = (counts[slot] ?? 0) + 1;
  }
  return counts;
}

/** Σ letter values of 27 counts (blanks are worth 0). */
export function countsValue(counts: readonly number[], values: readonly number[]): number {
  let sum = 0;
  for (let letter = 0; letter < BLANK; letter += 1)
    sum += (counts[letter] ?? 0) * (values[letter] ?? 0);
  return sum;
}

export interface Keep {
  /** Kept tiles, sorted (code unit). */
  readonly keep: string;
  /** The rest of the rack, sorted: the tiles an exchange returns. */
  readonly give: string;
  readonly raw: number;
}

/**
 * `K*` (S-4): the sub-multiset of `rack` (sorted TileString) with at most `min(6, |rack| − 1)` tiles that
 * maximises `raw`; ties to the larger keep, then to the code-unit-smallest sorted string. At most 2^7 subsets.
 * Keeping at most |rack| − 1 tiles means an exchange always returns ≥ 1 tile (R-TURN-001).
 */
export function bestKeep(rack: string, values: readonly number[], s: StrategyData): Keep {
  const tiles = Array.from(rack).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const size = tiles.length;
  const maxKeep = Math.min(6, size - 1);
  let best: Keep = { keep: '', give: tiles.join(''), raw: rawLeave(tileCounts(''), values, s) };
  for (let mask = 1; mask < 1 << size; mask += 1) {
    let keep = '';
    let give = '';
    for (let i = 0; i < size; i += 1) {
      if ((mask & (1 << i)) !== 0) keep += tiles[i] ?? '';
      else give += tiles[i] ?? '';
    }
    if (keep.length > maxKeep) continue;
    const raw = rawLeave(tileCounts(keep), values, s);
    const better =
      raw > best.raw ||
      (raw === best.raw &&
        (keep.length > best.keep.length || (keep.length === best.keep.length && keep < best.keep)));
    if (better) best = { keep, give, raw };
  }
  return best;
}
