import { describe, expect, it } from '@jest/globals';

import {
  BOARD_SIZE,
  FOCUS_THRESHOLD,
  clampTranslation,
  focusTranslation,
  hitTest,
  toContent,
} from './geometry';

const SIZE = 344;
const CELL = SIZE / BOARD_SIZE;

describe('hitTest (E-1.4 §2.3)', () => {
  it('maps Overview points to squares, row-major, 0-based', () => {
    expect(hitTest(1, 1, SIZE, 1, 0, 0)).toEqual({ row: 0, col: 0 });
    expect(hitTest(SIZE - 1, SIZE - 1, SIZE, 1, 0, 0)).toEqual({ row: 14, col: 14 });
    expect(hitTest(SIZE / 2, SIZE / 2, SIZE, 1, 0, 0)).toEqual({ row: 7, col: 7 });
    expect(hitTest(CELL * 3 + 1, CELL * 5 + 1, SIZE, 1, 0, 0)).toEqual({ row: 5, col: 3 });
  });

  it('returns null outside the 15 × 15 range', () => {
    expect(hitTest(-1, 10, SIZE, 1, 0, 0)).toBeNull();
    expect(hitTest(10, SIZE, SIZE, 1, 0, 0)).toBeNull();
  });

  it.each([1, 2.15, 2.5])('inverts the camera transform at zoom %d', (zoom) => {
    const max = ((zoom - 1) * SIZE) / 2;
    for (const [tx, ty] of [
      [0, 0],
      [max, -max],
      [-max / 2, max / 3],
    ] as const) {
      for (const [row, col] of [
        [0, 0],
        [7, 7],
        [14, 3],
      ] as const) {
        // Centre of the square in content coordinates, projected to the viewport.
        const cx = (col + 0.5) * CELL;
        const cy = (row + 0.5) * CELL;
        const vx = SIZE / 2 + tx + (cx - SIZE / 2) * zoom;
        const vy = SIZE / 2 + ty + (cy - SIZE / 2) * zoom;
        if (vx < 0 || vy < 0 || vx >= SIZE || vy >= SIZE) continue;
        expect(hitTest(vx, vy, SIZE, zoom, tx, ty)).toEqual({ row, col });
        expect(toContent(vx, vy, SIZE, zoom, tx, ty)).toEqual({
          x: expect.closeTo(cx, 6) as unknown as number,
          y: expect.closeTo(cy, 6) as unknown as number,
        });
      }
    }
  });
});

describe('camera', () => {
  it('keeps the board covering the viewport', () => {
    expect(clampTranslation(500, SIZE, 1)).toBe(0);
    expect(clampTranslation(-500, SIZE, 2)).toBe(-SIZE / 2);
    expect(clampTranslation(10, SIZE, 2)).toBe(10);
  });

  it('centres a square in Focus, clamped at the board edges', () => {
    expect(focusTranslation(7, SIZE, 2.15)).toBeCloseTo(0, 6);
    const corner = focusTranslation(0, SIZE, 2.15);
    expect(corner).toBeCloseTo(((2.15 - 1) * SIZE) / 2, 6);
    expect(focusTranslation(14, SIZE, 2.15)).toBeCloseTo(-corner, 6);
  });

  it('switches glyph sizes and double-tap direction at 1.6× (E-1.4 §2.4)', () => {
    expect(FOCUS_THRESHOLD).toBe(1.6);
  });
});
