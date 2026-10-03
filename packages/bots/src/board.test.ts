import { getLayout } from '@codelex/game-engine';
import { describe, expect, it } from 'vitest';
import { tinyIndex } from '../test/support/lexicons.js';
import { boardWith, craftedObservation, spell } from '../test/support/match.js';
import { ALL_LETTERS, boardView, codeOf, EMPTY, rackCounts } from './board.js';
import { mainDifficultyRank, mainWordCodes } from './main-word.js';

const TINY = tinyIndex();
const LAYOUT = getLayout('classic-v1');
const bit = (ch: string): number => 1 << (ch.charCodeAt(0) - 65);

describe('board view', () => {
  it('reads codes, blanks as their letter, and rack counts', () => {
    expect(codeOf('.')).toBe(EMPTY);
    expect(codeOf('A')).toBe(0);
    expect(codeOf('z')).toBe(25);
    const counts = rackCounts('??AZZ');
    expect(counts[26]).toBe(2);
    expect(counts[0]).toBe(1);
    expect(counts[25]).toBe(2);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('has only the start anchor on an empty board', () => {
    const view = boardView(craftedObservation(TINY, boardWith([]), 'A'), LAYOUT, TINY);
    expect(view.empty).toBe(true);
    expect(view.anchors.filter(Boolean)).toHaveLength(1);
    expect(view.anchors[7 * 15 + 7]).toBe(true);
    expect(view.crossRow.every((m) => m === ALL_LETTERS)).toBe(true);
  });

  it('computes anchors and cross-checks around tiles', () => {
    // N O d E on row 7 (blank d), cols 5..8.
    const obs = craftedObservation(TINY, boardWith(spell('NOdE', 7, 5)), 'A');
    const view = boardView(obs, LAYOUT, TINY);
    expect(view.empty).toBe(false);
    expect(view.codes[7 * 15 + 7]).toBe(3);
    expect(view.anchors[7 * 15 + 4]).toBe(true);
    expect(view.anchors[6 * 15 + 6]).toBe(true);
    expect(view.anchors[7 * 15 + 6]).toBe(false);
    // Left of NODE: no form ?NODE in the tiny lexicon; right: NODES.
    expect(view.crossCol[7 * 15 + 4]).toBe(0);
    expect(view.crossCol[7 * 15 + 9]).toBe(bit('S'));
    // Above O (col 6): ?O → NO, TO.
    expect(view.crossRow[6 * 15 + 6]).toBe(bit('N') | bit('T'));
    // Squares without perpendicular neighbours are unconstrained.
    expect(view.crossRow[7 * 15 + 4]).toBe(ALL_LETTERS);
  });

  it('finds the main word as the engine does (R-TURN-006 b)', () => {
    const obs = craftedObservation(
      TINY,
      boardWith([...spell('NODE', 7, 5), ...spell('TO', 5, 9, 'col')]),
      'S',
    );
    const view = boardView(obs, LAYOUT, TINY);
    const word = (codes: number[]): string => String.fromCharCode(...codes.map((c) => c + 65));
    // One tile at (7,9): row run NODES (5) vs column run TOS (3) → row.
    expect(word(mainWordCodes(view, [{ row: 7, col: 9, tile: 'S' }]))).toBe('NODES');
    // One tile under T,O at (7,9) is the same square; a tile at (4,9): column ?TO longer than the row run.
    expect(word(mainWordCodes(view, [{ row: 4, col: 9, tile: 'A' }]))).toBe('ATO');
    // Several tiles in a column.
    expect(
      word(
        mainWordCodes(view, [
          { row: 8, col: 5, tile: 'O' },
          { row: 9, col: 5, tile: 'S' },
        ]),
      ),
    ).toBe('NOS');
    expect(mainWordCodes(view, [])).toEqual([]);
    expect(mainDifficultyRank(view, [{ row: 7, col: 9, tile: 'S' }], TINY)).toBe(0);
    expect(mainDifficultyRank(view, [{ row: 4, col: 9, tile: 'A' }], TINY)).toBe(4);
  });
});
