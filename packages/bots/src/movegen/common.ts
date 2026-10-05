/**
 * Bookkeeping shared by the GADDAG and DAWG generators (bots-api §4.1 step 3): rack counts and letter mask, the
 * tiles of the current path, the node budget (BOT-3, BOT-4) and the deduplicated candidate list (packed signatures, no keys).
 * Per-call state only (no module state, API note §17).
 */
import type { BoardTile, Placement } from '@codelex/game-engine';
import { BLANK } from '../board.js';
import type { Candidate, Generation, GenerationInput } from './types.js';

const CODE_A = 65;
const CODE_LOWER_A = 97;
const MIN_FIRST_MOVE_TILES = 2;

/** `values[i]`, or `fallback` outside the array (bounds are checked by construction; this keeps types exact). */
export function valueAt(values: readonly number[], i: number, fallback: number): number {
  return i >= 0 && i < values.length ? (values[i] as number) : fallback;
}

/** Lowest set bit index of a non-zero mask. */
export function lowestBit(mask: number): number {
  return 31 - Math.clz32(mask & -mask);
}

/** Rack size (R-BAG-003): at most this many tiles per placement, the limit of the packed signature. */
const MAX_PACKED_TILES = 7;
/** Tile codes 0..51 (A..Z natural, a..z blank), stored + 1 so that placements of different lengths differ. */
const TILE_RADIX = 53;

export class Workspace {
  /** 27 counts, index 26 = blank. */
  readonly rack: number[];
  rackTiles: number;
  /** Bit l set iff the rack holds a natural letter l. */
  rackMask = 0;
  nodes = 0;
  exhausted = false;
  readonly candidates: Candidate[] = [];
  /** Current path: squares and tile codes (letter, + 26 for a blank), a stack in placement order. */
  private readonly squares: number[] = [];
  private readonly tiles: number[] = [];
  private depth = 0;
  /** Scratch for `record`: the path sorted by square. */
  private readonly sortedSquares: number[] = [];
  private readonly sortedTiles: number[] = [];
  private readonly seen = new Set<number>();
  private readonly size: number;
  private readonly firstMove: boolean;
  private readonly seat: number;
  private readonly maxNodes: number;

  constructor(input: GenerationInput) {
    this.rack = [...input.rack];
    this.rackTiles = this.rack.reduce((a, b) => a + b, 0);
    for (let l = 0; l < BLANK; l += 1) if (valueAt(this.rack, l, 0) > 0) this.rackMask |= 1 << l;
    this.size = input.view.size;
    this.firstMove = input.view.empty;
    this.seat = input.seat;
    this.maxNodes = input.maxNodes;
  }

  /** BOT-3/BOT-4: counts a successful transition, or reports exhaustion (and -1) when the budget is spent. */
  step<N extends number>(target: N | -1): N | -1 {
    if (target === -1) return -1;
    if (this.nodes >= this.maxNodes) {
      this.exhausted = true;
      return -1;
    }
    this.nodes += 1;
    return target;
  }

  blanks(): number {
    return valueAt(this.rack, BLANK, 0);
  }

  /** Takes a tile (`slot` = letter or BLANK) from the rack and places it as `letter` on square `sq`. */
  place(sq: number, letter: number, slot: number): void {
    this.consume(slot);
    this.squares[this.depth] = sq;
    this.tiles[this.depth] = slot === BLANK ? letter + BLANK : letter;
    this.depth += 1;
  }

  /** Undoes the last `place` of a tile from `slot`. */
  unplace(slot: number): void {
    this.depth -= 1;
    this.restore(slot);
  }

  consume(slot: number): void {
    const left = valueAt(this.rack, slot, 0) - 1;
    this.rack[slot] = left;
    this.rackTiles -= 1;
    if (slot !== BLANK && left === 0) this.rackMask &= ~(1 << slot);
  }

  restore(slot: number): void {
    this.rack[slot] = valueAt(this.rack, slot, 0) + 1;
    this.rackTiles += 1;
    if (slot !== BLANK) this.rackMask |= 1 << slot;
  }

  /**
   * Emits the current placement once; first move needs ≥ 2 tiles (R-TURN-002). Dedupe uses a packed integer
   * signature, so a duplicate (a one-tile move found in both directions) costs no allocation. The tiles of a
   * generated placement plus the board tiles between them form one run, so its squares are the first `count`
   * empty squares from its first square along its line: (first square, direction, tile codes in square order)
   * identifies it on this board. With ≤ 7 tiles the signature stays below 53^7 × 450 < 2^53. A longer placement
   * needs a rack larger than R-BAG-003 allows (crafted test observations only); it is not deduplicated, which is
   * exact because only one-tile moves can be generated twice (once per direction; the leftmost-anchor rule makes
   * every longer placement unique).
   */
  record(): void {
    const count = this.depth;
    if (count === 0 || (this.firstMove && count < MIN_FIRST_MOVE_TILES)) return;
    const sortedSquares = this.sortedSquares;
    const sortedTiles = this.sortedTiles;
    // Insertion sort by square (row-major = canonical (row, col) order); ≤ 7 entries.
    for (let i = 0; i < count; i += 1) {
      const sq = valueAt(this.squares, i, 0);
      const tile = valueAt(this.tiles, i, 0);
      let j = i;
      while (j > 0 && valueAt(sortedSquares, j - 1, 0) > sq) {
        sortedSquares[j] = valueAt(sortedSquares, j - 1, 0);
        sortedTiles[j] = valueAt(sortedTiles, j - 1, 0);
        j -= 1;
      }
      sortedSquares[j] = sq;
      sortedTiles[j] = tile;
    }
    const first = valueAt(sortedSquares, 0, 0);
    const size = this.size;
    if (count <= MAX_PACKED_TILES) {
      let packed = 0;
      for (let i = 0; i < count; i += 1)
        packed = packed * TILE_RADIX + valueAt(sortedTiles, i, 0) + 1;
      const column = count > 1 && valueAt(sortedSquares, 1, 0) - first >= size ? 1 : 0;
      const signature = (packed * size * size + first) * 2 + column;
      if (this.seen.has(signature)) return;
      this.seen.add(signature);
    }
    const tiles: Placement[] = [];
    for (let i = 0; i < count; i += 1) {
      const sq = valueAt(sortedSquares, i, 0);
      const code = valueAt(sortedTiles, i, 0);
      tiles.push({
        row: Math.floor(sq / size),
        col: sq % size,
        tile: String.fromCharCode(
          code >= BLANK ? CODE_LOWER_A + code - BLANK : CODE_A + code,
        ) as BoardTile,
      });
    }
    this.candidates.push({
      action: { seat: this.seat, type: 'PLACE_WORD', tiles },
      tilesPlaced: count,
    });
  }

  result(): Generation {
    return { candidates: this.candidates, nodesUsed: this.nodes, exhausted: this.exhausted };
  }
}
