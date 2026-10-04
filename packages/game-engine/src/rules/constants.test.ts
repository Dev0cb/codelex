import { describe, expect, it } from 'vitest';
import type { LayoutId, LetterTableId, SquareKind } from '../types.js';
import { getLayout, getLetterTable, RULES, squareKind } from './constants.js';

/** GAME_RULES §2.1 grid, transcribed verbatim (independent of the coordinate table in constants.ts). */
const GRID = `
.. .. .. TW .. .. .. DL .. .. .. TW .. .. ..
.. .. DL .. DW .. .. .. .. .. DW .. DL .. ..
.. DL DW .. .. .. .. DL .. .. .. .. DW DL ..
TW .. .. TL .. DL .. .. .. DL .. TL .. .. TW
.. DW .. .. DL .. TL .. TL .. DL .. .. DW ..
.. .. .. DL .. .. .. .. .. .. .. DL .. .. ..
.. .. .. .. TL .. .. .. .. .. TL .. .. .. ..
DL .. DL .. .. .. .. ST .. .. .. .. DL .. DL
.. .. .. .. TL .. .. .. .. .. TL .. .. .. ..
.. .. .. DL .. .. .. .. .. .. .. DL .. .. ..
.. DW .. .. DL .. TL .. TL .. DL .. .. DW ..
TW .. .. TL .. DL .. .. .. DL .. TL .. .. TW
.. DL DW .. .. .. .. DL .. .. .. .. DW DL ..
.. .. DL .. DW .. .. .. .. .. DW .. DL .. ..
.. .. .. TW .. .. .. DL .. .. .. TW .. .. ..
`;

function gridSquares(): SquareKind[] {
  return GRID.trim()
    .split('\n')
    .flatMap((line) =>
      line.split(' ').map((cell): SquareKind => {
        if (cell === '..') return 'plain';
        if (cell === 'ST') return 'DW';
        return cell as SquareKind;
      }),
    );
}

const layout = getLayout('classic-v1');
const at = (row: number, col: number): SquareKind => squareKind(layout, row, col);
const WORD: ReadonlySet<SquareKind> = new Set(['DW', 'TW']);

describe('classic-v1 layout (R-BOARD-001, R-BOARD-002, R-BOARD-004)', () => {
  it('P-BOARD-001-a: 15×15 with the start square (7,7)', () => {
    expect(layout.id).toBe('classic-v1');
    expect(layout.size).toBe(15);
    expect(layout.start).toEqual({ row: 7, col: 7 });
    expect(layout.squares).toHaveLength(225);
  });

  it('P-BOARD-002-d: equals GAME_RULES §2.1 square by square, start square is a DW', () => {
    expect([...layout.squares]).toEqual(gridSquares());
    expect(at(7, 7)).toBe('DW');
  });

  it('P-BOARD-002-d: counts TW 8, DW 13, TL 12, DL 28 (61 premiums)', () => {
    const count = (kind: SquareKind): number => layout.squares.filter((k) => k === kind).length;
    expect([count('TW'), count('DW'), count('TL'), count('DL')]).toEqual([8, 13, 12, 28]);
    expect(count('plain')).toBe(225 - 61);
  });

  it('P-BOARD-002-a: invariant under the 8 symmetries of the square', () => {
    const n = 14;
    for (let r = 0; r <= n; r += 1) {
      for (let c = 0; c <= n; c += 1) {
        const kind = at(r, c);
        for (const [rr, cc] of [
          [c, r],
          [r, n - c],
          [c, n - r],
          [n - r, c],
          [n - c, r],
          [n - r, n - c],
          [n - c, n - r],
        ] as const) {
          expect(at(rr, cc)).toBe(kind);
        }
      }
    }
  });

  it('P-BOARD-002-e: two word multipliers on a line span ≥ 7 squares (DW×DW needs a 7-letter word), calm start lines', () => {
    for (let r = 0; r < 15; r += 1) {
      for (let c = 0; c < 15; c += 1) {
        if (!WORD.has(at(r, c))) continue;
        // Distance ≥ 6 between the two squares = a word covering both has ≥ 7 letters.
        for (let d = 1; d < 6; d += 1) {
          if (c + d < 15) expect(WORD.has(at(r, c + d)), `row ${String(r)}`).toBe(false);
          if (r + d < 15) expect(WORD.has(at(r + d, c)), `col ${String(c)}`).toBe(false);
        }
      }
    }
    for (let d = -4; d <= 4; d += 1) {
      if (d === 0) continue;
      expect(at(7, 7 + d)).toBe('plain');
      expect(at(7 + d, 7)).toBe('plain');
    }
  });

  it('rejects unknown layout ids (programmer error)', () => {
    // classic-v2 is registered since ADR-0014 (v2 draft): probe an id that no version defines.
    expect(() => getLayout('classic-v9' as LayoutId)).toThrow(RangeError);
  });
});

describe('letters-v1 table (R-BAG-001, R-BAG-002; GC-BAG-02)', () => {
  const table = getLetterTable('letters-v1');
  const compact = (xs: readonly number[]): string =>
    xs.map((x, i) => `${String.fromCharCode(65 + i)}${String(x)}`).join(' ');

  it('GC-BAG-02: values and counts equal GAME_RULES §3.1', () => {
    expect(compact(table.values)).toBe(
      'A1 B3 C2 D3 E1 F4 G3 H3 I1 J8 K5 L2 M3 N1 O1 P2 Q8 R1 S1 T1 U2 V6 W5 X8 Y4 Z10',
    );
    expect(compact(table.counts)).toBe(
      'A8 B2 C5 D3 E9 F1 G3 H2 I7 J1 K1 L4 M3 N6 O7 P4 Q1 R8 S6 T8 U3 V1 W1 X1 Y2 Z1',
    );
    expect(table.blanks).toBe(2);
    expect(table.blankValue).toBe(0);
  });

  it('P-BAG-001-a/b/c: 98 letters + 2 blanks, every letter present, values in [1,10], 1-point letters', () => {
    expect(table.counts.reduce((a, b) => a + b, 0)).toBe(98);
    expect(table.counts.every((n) => n >= 1)).toBe(true);
    expect(table.values.every((v) => v >= 1 && v <= 10)).toBe(true);
    for (const letter of 'EAIONRST') expect(table.values[letter.charCodeAt(0) - 65]).toBe(1);
    expect(table.counts.reduce((sum, n, i) => sum + n * (table.values[i] ?? 0), 0)).toBe(192);
  });

  it('rejects unknown table ids (programmer error)', () => {
    // letters-v2 is registered since ADR-0014 (v2 draft placeholder): probe an id that no version defines.
    expect(() => getLetterTable('letters-v9' as LetterTableId)).toThrow(RangeError);
  });
});

describe('RULES', () => {
  it('holds the GAME_RULES v0.3 constants', () => {
    expect(RULES).toEqual({
      rackSize: 7,
      minFirstMoveTiles: 2,
      minBagForExchange: 7,
      scorelessTurnsPerSeat: 3,
      fullStackTiles: 7,
      fullStackBonus: 50,
      termBonus: { novice: 0, intermediate: 4, advanced: 8, expert: 16 },
      chainStep: 5,
      chainCap: 5,
    });
    expect(Object.isFrozen(RULES)).toBe(true);
    expect(Object.isFrozen(RULES.termBonus)).toBe(true);
  });
});
