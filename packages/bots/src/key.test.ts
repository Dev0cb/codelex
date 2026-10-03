import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { actionKey, compareKeys, placementKey } from './key.js';

describe('canonical action key (§4.4)', () => {
  it('encodes PLACE_WORD, EXCHANGE and PASS', () => {
    expect(
      actionKey({
        seat: 0,
        type: 'PLACE_WORD',
        tiles: [
          { row: 7, col: 7, tile: 'A' },
          { row: 7, col: 10, tile: 'p' },
        ],
      }),
    ).toBe('P0707A0710p');
    expect(actionKey({ seat: 1, type: 'EXCHANGE', tiles: ['?', 'A', 'Z'] })).toBe('X?AZ');
    expect(actionKey({ seat: 1, type: 'PASS' })).toBe('S');
  });

  it('is injective over canonical placements and orders by code unit', () => {
    const tile = fc.record({
      row: fc.integer({ min: 0, max: 14 }),
      col: fc.integer({ min: 0, max: 14 }),
      tile: fc.constantFrom('A', 'Z', 'a', 'z', 'Q'),
    });
    fc.assert(
      fc.property(
        fc.array(tile, { minLength: 1, maxLength: 3 }),
        fc.array(tile, { minLength: 1, maxLength: 3 }),
        (a, b) => {
          const same = JSON.stringify(a) === JSON.stringify(b);
          expect(placementKey(a) === placementKey(b)).toBe(same);
          const c = compareKeys(placementKey(a), placementKey(b));
          expect(Math.sign(c)).toBe(-Math.sign(compareKeys(placementKey(b), placementKey(a))) || 0);
        },
      ),
    );
    expect(compareKeys('P', 'P')).toBe(0);
    expect(compareKeys('P0101A', 'P0101a')).toBe(-1);
    expect(compareKeys('S', 'P')).toBe(1);
  });
});
