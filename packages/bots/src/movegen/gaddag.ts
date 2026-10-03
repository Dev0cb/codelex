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
import { GADDAG_SEPARATOR, type Gaddag, type GaddagNode } from '@codelex/lexicon/index';
import { BLANK, EMPTY } from '../board.js';
import { compareKeys } from '../key.js';
import { lowestBit, valueAt, Workspace } from './common.js';
import type { Candidate, Generation, GenerationInput, MoveGenerator } from './types.js';

export function gaddagGenerator(gaddag: Gaddag): MoveGenerator {
  return (input: GenerationInput): Generation => generate(gaddag, input);
}

function generate(gaddag: Gaddag, input: GenerationInput): Generation {
  const { view } = input;
  const { size, codes, anchors } = view;
  const ws = new Workspace(input);
  // A function, not the field read inline: TypeScript narrows `ws.exhausted` across nested calls otherwise.
  const stopped = (): boolean => ws.exhausted;

  // Current line: squares at `base + i * step`, i = 0..size-1.
  let base = 0;
  let step = 1;
  let cross: readonly number[] = view.crossRow;
  let anchorPos = 0;

  const sqAt = (i: number): number => base + i * step;
  const codeAt = (i: number): number => valueAt(codes, sqAt(i), EMPTY);
  const freeAt = (i: number): boolean => i < 0 || i >= size || codeAt(i) === EMPTY;
  const follow = (node: GaddagNode, symbol: number): GaddagNode | -1 =>
    ws.step(gaddag.next(node, symbol));

  /** Square `pos` holds (or just received) letter `code`; `node` is the state after reading it. */
  function goOn(pos: number, node: GaddagNode): void {
    if (pos <= anchorPos) {
      const leftFree = freeAt(pos - 1);
      if (leftFree && freeAt(anchorPos + 1) && gaddag.isFinal(node)) ws.record();
      if (pos > 0) gen(pos - 1, node);
      if (stopped() || !leftFree || anchorPos + 1 >= size) return;
      const turned = follow(node, GADDAG_SEPARATOR);
      if (turned !== -1) gen(anchorPos + 1, turned);
    } else {
      if (freeAt(pos + 1) && gaddag.isFinal(node)) ws.record();
      if (pos + 1 < size) gen(pos + 1, node);
    }
  }

  function place(pos: number, node: GaddagNode, letter: number, slot: number): void {
    const target = follow(node, letter);
    if (target === -1) return;
    ws.place(sqAt(pos), letter, slot);
    goOn(pos, target);
    ws.unplace(slot);
  }

  function gen(pos: number, node: GaddagNode): void {
    if (stopped()) return;
    const existing = codeAt(pos);
    if (existing !== EMPTY) {
      const target = follow(node, existing);
      if (target !== -1) goOn(pos, target);
      return;
    }
    if (ws.rackTiles === 0) return;
    const sq = sqAt(pos);
    if (pos < anchorPos && anchors[sq] === true) return;
    const allowed = gaddag.arcs(node) & valueAt(cross, sq, 0);
    for (let m = allowed & ws.rackMask; m !== 0 && !stopped(); m &= m - 1) {
      const letter = lowestBit(m);
      place(pos, node, letter, letter);
    }
    if (ws.blanks() === 0) return;
    for (let m = allowed; m !== 0 && !stopped(); m &= m - 1) {
      place(pos, node, lowestBit(m), BLANK);
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
  return ws.result();
}

/** Candidates sorted by canonical key (the order used for sampling, independent of the automaton). */
export function byKey(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => compareKeys(a.key, b.key));
}
