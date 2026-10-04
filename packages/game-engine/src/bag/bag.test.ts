import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deriveStreamState } from '../rng/index.js';
import { rulesFor } from '../rules/registry.js';
import { countTiles, sortTiles } from '../tiles.js';
import type { RackTile } from '../types.js';
import { drawTiles, exchangeTiles, refillRack, type BagRngState } from './bag.js';

const RNG: BagRngState = deriveStreamState('00c0de1e00000001', 'bag');
const BAG = 'QWERTYUIOPASDFGHJKLZ';

/** ADR-0014 §D1: internal modules take the match's rules; these unit tests run rules version 1. */
const R1 = rulesFor(1).rules;

describe('draws (R-BAG-003, R-BAG-005 b)', () => {
  it('takes tiles from the head', () => {
    expect(drawTiles(BAG, 3)).toEqual({ drawn: 'QWE', bag: BAG.slice(3) });
  });

  it('a short bag gives what it has; never negative', () => {
    expect(drawTiles('AB', 5)).toEqual({ drawn: 'AB', bag: '' });
    expect(drawTiles('AB', -1)).toEqual({ drawn: '', bag: 'AB' });
  });

  it('GC-BAG-01: bag 2, rack of 2 after placing 5 → draws 2, rack 4, bag 0', () => {
    expect(refillRack('AE', 'XZ', R1)).toEqual({ rack: 'AEXZ', drawn: 'XZ', bag: '' });
  });

  it('P-BAG-003-a: refill reaches min(7, rack + bag)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 7 }), fc.integer({ min: 0, max: 20 }), (r, b) => {
        const out = refillRack('A'.repeat(r), BAG.slice(0, b), R1);
        expect(out.rack).toHaveLength(Math.min(7, r + b));
        expect(out.drawn + out.bag).toBe(BAG.slice(0, b));
      }),
      { seed: 7, numRuns: 200 },
    );
  });
});

describe('exchange (R-BAG-005)', () => {
  it('P-BAG-005-d: rejects 0 or > 7 tiles, a bag under 7, then tiles not on the rack', () => {
    const fail = (rack: string, bag: string, tiles: RackTile[]): unknown => {
      const r = exchangeTiles(rack, bag, RNG, tiles, R1);
      return r.ok ? undefined : r.error;
    };
    expect(fail('AEINRST', BAG, [])).toMatchObject({
      code: 'exchange',
      details: { violation: 'tile_count' },
    });
    expect(fail('AEINRST', BAG, ['A', 'E', 'I', 'N', 'R', 'S', 'T', 'A'])).toMatchObject({
      code: 'exchange',
      details: { violation: 'tile_count' },
    });
    // bag_too_small comes before the rack check (API note §8.3).
    expect(fail('AEINRST', 'ABCDEF', ['Z'])).toMatchObject({
      code: 'exchange',
      details: { violation: 'bag_too_small' },
    });
    expect(fail('AEINRST', BAG, ['Z', 'A', '?'])).toMatchObject({
      code: 'rack',
      details: { missing: '?Z' },
    });
  });

  it('accepts a bag of exactly 7', () => {
    expect(exchangeTiles('AEINRST', 'BCDFGHJ', RNG, ['A'], R1).ok).toBe(true);
  });

  it('P-BAG-005-c/e: same rack size, same bag size, returned tiles not redrawn, deterministic', () => {
    fc.assert(
      fc.property(
        fc.subarray([0, 1, 2, 3, 4, 5, 6], { minLength: 1 }),
        fc.integer({ min: 7, max: 20 }),
        (positions, bagSize) => {
          const rack = 'AEINRS?';
          const tiles = positions.map((i) => rack.charAt(i) as RackTile);
          const bag = BAG.slice(0, bagSize);
          const r = exchangeTiles(sortTiles(rack), bag, RNG, tiles, R1);
          if (!r.ok) throw new Error('expected ok');
          const out = r.value;
          expect(out.rack).toHaveLength(7);
          expect(out.bag).toHaveLength(bagSize);
          expect(out.drawn).toBe(bag.slice(0, tiles.length));
          expect(out.returned).toBe(sortTiles(tiles));
          // Conservation: rack + bag before = rack + bag after (as multisets).
          expect(countTiles(out.rack + out.bag)).toEqual(countTiles(rack + bag));
          expect(out.rng).not.toEqual(RNG);
          expect(exchangeTiles(sortTiles(rack), bag, RNG, tiles, R1)).toEqual(r);
        },
      ),
      { seed: 11, numRuns: 200 },
    );
  });

  it('does not modify its inputs', () => {
    const rng = Object.freeze([...RNG]) as unknown as BagRngState;
    const tiles = Object.freeze(['A']) as readonly RackTile[];
    expect(() => exchangeTiles('AEINRST', BAG, rng, tiles, R1)).not.toThrow();
    expect(rng).toEqual(RNG);
  });
});
