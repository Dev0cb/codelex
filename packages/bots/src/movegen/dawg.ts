/**
 * DAWG move generation (Appel & Jacobson 1988; bots-api §4.3, BOT-8): the fallback when the artefact omits the
 * GADDAG section (mobile size gate), over `Dawg.arcs/next/isFinal` (lexicon-index §2.3).
 *
 * For each anchor and direction: if the square before the anchor holds a tile, the left part is the run of tiles
 * already on the board (read through the DAWG); otherwise the left part is built from the rack over the free,
 * non-anchor squares before the anchor (`limit`), every prefix of the DAWG being tried. Each left part is then
 * extended to the right from the anchor through rack tiles and board tiles, pruned by the cross-check masks and the
 * rack counts. A left part never covers an anchor, so a placement is generated from the leftmost anchor it covers
 * only, as on the GADDAG path; one-tile moves found in both directions are deduplicated by key. Recursion depth
 * ≤ 2 frames per rack tile and 1 per board tile on the line, i.e. < 40 (ADR-0013 §D4.8 ≤ 64).
 *
 * Same move set as the GADDAG path (P-BOT-03); the generation order differs, which only matters when a budget
 * drops work (BOT-4). A node (BOT-3) = one successful transition followed. Non-anchor squares before an anchor have
 * no perpendicular neighbour, so their cross-check mask is "every letter" and the left part needs no mask.
 */
import type { Dawg, DawgNode } from '@codelex/lexicon/index';
import { BLANK, EMPTY } from '../board.js';
import { lowestBit, valueAt, Workspace } from './common.js';
import type { Generation, GenerationInput, MoveGenerator } from './types.js';

export function dawgGenerator(dawg: Dawg): MoveGenerator {
  return (input: GenerationInput): Generation => generate(dawg, input);
}

function generate(dawg: Dawg, input: GenerationInput): Generation {
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
  const follow = (node: DawgNode, letter: number): DawgNode | -1 =>
    ws.step(dawg.next(node, letter));

  /** Extends the word to the right from square `pos` (≥ anchorPos); `node` = state of the letters so far. */
  function extendRight(pos: number, node: DawgNode): void {
    if (stopped()) return;
    if (pos >= size) {
      if (dawg.isFinal(node)) ws.record();
      return;
    }
    const existing = codeAt(pos);
    if (existing !== EMPTY) {
      const target = follow(node, existing);
      if (target !== -1) extendRight(pos + 1, target);
      return;
    }
    // A free square ends the word here, once the anchor is covered.
    if (pos > anchorPos && dawg.isFinal(node)) ws.record();
    if (ws.rackTiles === 0) return;
    const allowed = dawg.arcs(node) & valueAt(cross, sqAt(pos), 0);
    for (let m = allowed & ws.rackMask; m !== 0 && !stopped(); m &= m - 1) {
      extendWith(pos, node, lowestBit(m), lowestBit(m));
    }
    if (ws.blanks() === 0) return;
    for (let m = allowed; m !== 0 && !stopped(); m &= m - 1) {
      extendWith(pos, node, lowestBit(m), BLANK);
    }
  }

  function extendWith(pos: number, node: DawgNode, letter: number, slot: number): void {
    const target = follow(node, letter);
    if (target === -1) return;
    ws.place(sqAt(pos), letter, slot);
    extendRight(pos + 1, target);
    ws.unplace(slot);
  }

  // Current left part built from the rack, in reading order (letter, slot): its tiles are out of the rack.
  const leftLetters: number[] = [];
  const leftSlots: number[] = [];

  /** Places the current left part just before the anchor, extends it, then tries longer left parts. */
  function leftPart(node: DawgNode, limit: number): void {
    const length = leftLetters.length;
    leftLetters.forEach((letter, k) => {
      const slot = valueAt(leftSlots, k, BLANK);
      ws.restore(slot);
      ws.place(sqAt(anchorPos - length + k), letter, slot);
    });
    extendRight(anchorPos, node);
    for (let k = length - 1; k >= 0; k -= 1) {
      const slot = valueAt(leftSlots, k, BLANK);
      ws.unplace(slot);
      ws.consume(slot);
    }
    if (limit === 0 || ws.rackTiles === 0) return;
    const arcs = dawg.arcs(node);
    for (let m = arcs & ws.rackMask; m !== 0 && !stopped(); m &= m - 1) {
      growLeft(node, lowestBit(m), lowestBit(m), limit);
    }
    if (ws.blanks() === 0) return;
    for (let m = arcs; m !== 0 && !stopped(); m &= m - 1) {
      growLeft(node, lowestBit(m), BLANK, limit);
    }
  }

  function growLeft(node: DawgNode, letter: number, slot: number, limit: number): void {
    const target = follow(node, letter);
    if (target === -1) return;
    ws.consume(slot);
    leftLetters.push(letter);
    leftSlots.push(slot);
    leftPart(target, limit - 1);
    leftLetters.pop();
    leftSlots.pop();
    ws.restore(slot);
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
      if (anchorPos > 0 && codeAt(anchorPos - 1) !== EMPTY) {
        // Left part = the tiles already before the anchor.
        let start = anchorPos - 1;
        while (start > 0 && codeAt(start - 1) !== EMPTY) start -= 1;
        let node: DawgNode | -1 = dawg.root;
        for (let i = start; i < anchorPos && node !== -1; i += 1) node = follow(node, codeAt(i));
        if (node !== -1) extendRight(anchorPos, node);
      } else {
        // Left part from the rack over the free, non-anchor squares before the anchor.
        let limit = 0;
        while (
          anchorPos - limit > 0 &&
          codeAt(anchorPos - limit - 1) === EMPTY &&
          anchors[sqAt(anchorPos - limit - 1)] !== true
        ) {
          limit += 1;
        }
        leftPart(dawg.root, limit);
      }
    }
  }
  return ws.result();
}
