/**
 * Bookkeeping shared by the GADDAG and DAWG generators (bots-api §4.1 step 3): rack counts and letter mask, the
 * tiles of the current path, the node budget (BOT-3, BOT-4) and the deduplicated candidate list (§4.4 keys).
 * Per-call state only (no module state, API note §17).
 */
import type { BoardTile, Placement } from '@codelex/game-engine';
import { BLANK } from '../board.js';
import { placementKey } from '../key.js';
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

export class Workspace {
  /** 27 counts, index 26 = blank. */
  readonly rack: number[];
  rackTiles: number;
  /** Bit l set iff the rack holds a natural letter l. */
  rackMask = 0;
  nodes = 0;
  exhausted = false;
  readonly placed: Placement[] = [];
  readonly candidates: Candidate[] = [];
  private readonly seen = new Set<string>();
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
    this.placed.push({
      row: Math.floor(sq / this.size),
      col: sq % this.size,
      tile: String.fromCharCode((slot === BLANK ? CODE_LOWER_A : CODE_A) + letter) as BoardTile,
    });
  }

  /** Undoes the last `place` of a tile from `slot`. */
  unplace(slot: number): void {
    this.placed.pop();
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

  /** Emits the current placement once (by canonical key); first move needs ≥ 2 tiles (R-TURN-002). */
  record(): void {
    const count = this.placed.length;
    if (count === 0 || (this.firstMove && count < MIN_FIRST_MOVE_TILES)) return;
    const tiles = [...this.placed].sort((a, b) => a.row - b.row || a.col - b.col);
    const key = placementKey(tiles);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.candidates.push({
      action: { seat: this.seat, type: 'PLACE_WORD', tiles },
      key,
      tilesPlaced: count,
    });
  }

  result(): Generation {
    return { candidates: this.candidates, nodesUsed: this.nodes, exhausted: this.exhausted };
  }
}
