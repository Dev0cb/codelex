/**
 * Strategist lane blocking (spec S-2 `D`; AC-6) and the overflow attention key (S-1), on hand-built boards.
 */
import fc from 'fast-check';
import { getLayout, type Placement } from '@codelex/game-engine';
import { describe, expect, it } from 'vitest';
import { EMPTY } from '../board.js';
import { STRATEGIST_STRATEGY as S } from '../personalities.js';
import { attentionKey, denialPermille, exposure, hotSquares, isHot, withTiles } from './lanes.js';

const LAYOUT = getLayout('classic-v1');
const SIZE = 15;
const empty = (): number[] => new Array<number>(SIZE * SIZE).fill(EMPTY);
const at = (tiles: readonly (readonly [number, number])[]): number[] => {
  const codes = empty();
  for (const [r, c] of tiles) codes[r * SIZE + c] = 0;
  return codes;
};

describe('hot squares', () => {
  it('a TW is hot with a tile adjacent or within reach 4 over empty squares only', () => {
    // TW (3, 0).
    expect(isHot(at([[3, 1]]), SIZE, 3, 0, 4)).toBe(true);
    expect(isHot(at([[3, 4]]), SIZE, 3, 0, 4)).toBe(true);
    expect(isHot(at([[3, 5]]), SIZE, 3, 0, 4)).toBe(false);
    expect(isHot(at([[7, 0]]), SIZE, 3, 0, 4)).toBe(true);
    expect(isHot(at([[4, 1]]), SIZE, 3, 0, 4)).toBe(false); // diagonal does not count
    expect(isHot(empty(), SIZE, 3, 0, 4)).toBe(false);
  });

  it('counts empty TW and DW squares only; covered premiums are not hot', () => {
    expect(hotSquares(empty(), LAYOUT.squares, SIZE, 4)).toEqual({ tw: 0, dw: 0 });
    // A tile at (3, 4): TW (3, 0) at distance 4; DW (1, 4) at distance 2 up its column.
    expect(hotSquares(at([[3, 4]]), LAYOUT.squares, SIZE, 4)).toEqual({ tw: 1, dw: 1 });
    // Covering TW (3, 0) itself: it is no longer empty, so no longer hot.
    expect(
      hotSquares(
        at([
          [3, 0],
          [3, 1],
        ]),
        LAYOUT.squares,
        SIZE,
        4,
      ),
    ).toEqual({ tw: 0, dw: 1 });
    expect(exposure(at([[3, 4]]), LAYOUT.squares, SIZE, S)).toBe(60 + 20);
  });

  it('exposure is a pure function of the board', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 14 }), fc.integer({ min: 0, max: 14 })), {
          maxLength: 12,
        }),
        (tiles) => {
          const a = at(tiles);
          const b = at([...tiles].reverse());
          expect(exposure(a, LAYOUT.squares, SIZE, S)).toBe(exposure(b, LAYOUT.squares, SIZE, S));
          expect(a).toEqual(b);
        },
      ),
    );
  });

  it('places candidate tiles on a scratch copy, blanks as their letter', () => {
    const codes = empty();
    const tiles: Placement[] = [
      { row: 0, col: 0, tile: 'B' },
      { row: 0, col: 1, tile: 'c' },
    ];
    const after = withTiles(codes, SIZE, tiles);
    expect([after[0], after[1]]).toEqual([1, 2]);
    expect(codes[0]).toBe(EMPTY);
  });
});

describe('denial mode (GD-4 edges)', () => {
  // The mechanism, with the spec's starting weights (1500 / 1000 / 400 ‰).
  const START = { ...S, denialEvenPermille: 1000, denialTrailPermille: 400 };

  it('leading at ≥ +30, trailing at ≤ −50, even otherwise and whenever the bag is empty', () => {
    expect(denialPermille(30, 50, START)).toBe(1500);
    expect(denialPermille(29, 50, START)).toBe(1000);
    expect(denialPermille(-49, 50, START)).toBe(1000);
    expect(denialPermille(-50, 50, START)).toBe(400);
    expect(denialPermille(100, 0, START)).toBe(1000);
    expect(denialPermille(-100, 0, START)).toBe(1000);
  });

  it('BOT_VERSION 2 frozen data denies only while leading (B4 tuning, ST-2)', () => {
    expect([S.denialLeadPermille, S.denialEvenPermille, S.denialTrailPermille]).toEqual([
      1500, 0, 0,
    ]);
    expect(denialPermille(30, 50, S)).toBe(1500);
    expect(denialPermille(29, 50, S)).toBe(0);
    expect(denialPermille(-50, 50, S)).toBe(0);
    expect(denialPermille(100, 0, S)).toBe(0);
  });
});

describe('attention key (S-1)', () => {
  it('8 per tile, 4 per newly covered DW/TW, 1 per DL/TL', () => {
    const tiles: Placement[] = [
      { row: 7, col: 6, tile: 'A' }, // plain
      { row: 7, col: 7, tile: 'B' }, // DW (start)
      { row: 7, col: 2, tile: 'C' }, // DL
      { row: 3, col: 0, tile: 'D' }, // TW
    ];
    expect(attentionKey(tiles, LAYOUT.squares, SIZE)).toBe(32 + 4 + 1 + 4);
  });
});
