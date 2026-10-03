/**
 * GADDAG move generation (Gordon 1994; bots-api §4.2) over `Gaddag.arcs/next/isFinal` (lexicon-index §2.3).
 *
 * From each anchor, walk left reading reversed letters from the rack or the board, cross the separator ◇ when
 * the square left of the leftmost letter is free, then walk right. Pruned by the cross-check masks and the rack
 * counts. A new tile is never placed on an anchor left of the current one in the same line: that move is found
 * from the leftmost anchor it covers, so each placement is generated once per direction (one-tile moves found in
 * both directions are deduplicated by key). Recursion depth ≤ 2 frames per letter (≤ 32, ADR-0013 §D4.8 ≤ 64).
 *
 * A node (BOT-3) = one successful transition followed, the separator arc included. Generation stops before the
 * transition that would exceed `maxNodes` and reports `exhausted` (BOT-4).
 */
import type { BoardTile, Placement } from '@codelex/game-engine';
import { GADDAG_SEPARATOR, type Gaddag, type GaddagNode } from '@codelex/lexicon/index';
import { BLANK, EMPTY } from '../board.js';
import { compareKeys, placementKey } from '../key.js';
import type { Candidate, Generation, GenerationInput, MoveGenerator } from './types.js';

const CODE_A = 65;
const CODE_LOWER_A = 97;
const MIN_FIRST_MOVE_TILES = 2;

/** Lowest set bit index of a non-zero 27-bit mask. */
function lowestBit(mask: number): number {
  return 31 - Math.clz32(mask & -mask);
}

export function gaddagGenerator(gaddag: Gaddag): MoveGenerator {
  return (input: GenerationInput): Generation => generate(gaddag, input);
}

function generate(gaddag: Gaddag, input: GenerationInput): Generation {
  const { view, seat, maxNodes } = input;
  const { size, codes, anchors } = view;
  const rack = [...input.rack];
  let rackTiles = rack.reduce((a, b) => a + b, 0);
  let rackMask = 0;
  for (let l = 0; l < 26; l += 1) if ((rack[l] ?? 0) > 0) rackMask |= 1 << l;

  let nodes = 0;
  let exhausted = false;
  // A function, not the variable: TypeScript does not see the writes made by nested calls.
  const stopped = (): boolean => exhausted;
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  // Placed tiles of the current path (squares and tile chars), in walk order.
  const placedSquares: number[] = [];
  const placedTiles: string[] = [];

  // Current line: squares at `base + i * step`, i = 0..size-1.
  let base = 0;
  let step = 1;
  let cross: readonly number[] = view.crossRow;
  let anchorPos = 0;

  const sqAt = (i: number): number => base + i * step;
  const codeAt = (i: number): number => codes[sqAt(i)] ?? EMPTY;
  const freeAt = (i: number): boolean => i < 0 || i >= size || codeAt(i) === EMPTY;

  function follow(node: GaddagNode, symbol: number): GaddagNode | -1 {
    const target = gaddag.next(node, symbol);
    if (target === -1) return -1;
    if (nodes >= maxNodes) {
      exhausted = true;
      return -1;
    }
    nodes += 1;
    return target;
  }

  function record(): void {
    const count = placedSquares.length;
    if (count === 0 || (view.empty && count < MIN_FIRST_MOVE_TILES)) return;
    const tiles: Placement[] = [];
    for (let k = 0; k < count; k += 1) {
      const sq = placedSquares[k] ?? 0;
      tiles.push({
        row: Math.floor(sq / size),
        col: sq % size,
        tile: (placedTiles[k] ?? '') as BoardTile,
      });
    }
    tiles.sort((a, b) => a.row - b.row || a.col - b.col);
    const key = placementKey(tiles);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ action: { seat, type: 'PLACE_WORD', tiles }, key, tilesPlaced: count });
  }

  /** Square `pos` holds (or just received) letter `code`; `node` is the state after reading it. */
  function goOn(pos: number, node: GaddagNode): void {
    if (pos <= anchorPos) {
      const leftFree = freeAt(pos - 1);
      if (leftFree && freeAt(anchorPos + 1) && gaddag.isFinal(node)) record();
      if (pos > 0) gen(pos - 1, node);
      if (exhausted || !leftFree || anchorPos + 1 >= size) return;
      const turned = follow(node, GADDAG_SEPARATOR);
      if (turned !== -1) gen(anchorPos + 1, turned);
    } else {
      if (freeAt(pos + 1) && gaddag.isFinal(node)) record();
      if (pos + 1 < size) gen(pos + 1, node);
    }
  }

  function place(pos: number, node: GaddagNode, letter: number, slot: number): void {
    const target = follow(node, letter);
    if (target === -1) return;
    rack[slot] = (rack[slot] ?? 0) - 1;
    rackTiles -= 1;
    if (slot !== BLANK && rack[slot] === 0) rackMask &= ~(1 << slot);
    placedSquares.push(sqAt(pos));
    placedTiles.push(String.fromCharCode((slot === BLANK ? CODE_LOWER_A : CODE_A) + letter));
    goOn(pos, target);
    placedSquares.pop();
    placedTiles.pop();
    rack[slot] = (rack[slot] ?? 0) + 1;
    rackTiles += 1;
    if (slot !== BLANK) rackMask |= 1 << slot;
  }

  function gen(pos: number, node: GaddagNode): void {
    if (exhausted) return;
    const existing = codeAt(pos);
    if (existing !== EMPTY) {
      const target = follow(node, existing);
      if (target !== -1) goOn(pos, target);
      return;
    }
    if (rackTiles === 0) return;
    const sq = sqAt(pos);
    if (pos < anchorPos && anchors[sq] === true) return;
    const allowed = gaddag.arcs(node) & (cross[sq] ?? 0);
    for (let m = allowed & rackMask; m !== 0 && !stopped(); m &= m - 1) {
      const letter = lowestBit(m);
      place(pos, node, letter, letter);
    }
    if ((rack[BLANK] ?? 0) === 0) return;
    for (let m = allowed; m !== 0 && !stopped(); m &= m - 1) {
      const letter = lowestBit(m);
      place(pos, node, letter, BLANK);
    }
  }

  for (let sq = 0; sq < size * size && !stopped(); sq += 1) {
    if (anchors[sq] !== true) continue;
    const row = Math.floor(sq / size);
    const col = sq % size;
    for (const direction of [0, 1]) {
      if (stopped()) break;
      const rowMove = direction === 0;
      base = rowMove ? row * size : col;
      step = rowMove ? 1 : size;
      anchorPos = rowMove ? col : row;
      cross = rowMove ? view.crossRow : view.crossCol;
      gen(anchorPos, gaddag.root);
    }
  }
  return { candidates, nodesUsed: nodes, exhausted };
}

/** Candidates sorted by canonical key (the order used for sampling, independent of the automaton). */
export function byKey(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => compareKeys(a.key, b.key));
}
