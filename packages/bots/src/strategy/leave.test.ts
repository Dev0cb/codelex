/**
 * Strategist leave valuation (spec S-2 `L`, S-4 `K*`; AC-4, AC-5): `raw` on letters-v1, `floorDiv`, best keep.
 */
import fc from 'fast-check';
import { getLetterTable } from '@codelex/game-engine';
import { describe, expect, it } from 'vitest';
import { STRATEGIST_STRATEGY as S } from '../personalities.js';
import { bestKeep, countsValue, floorDiv, letterDp, rawLeave, tileCounts } from './leave.js';

const VALUES = getLetterTable('letters-v1').values;
const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const raw = (tiles: string): number => rawLeave(tileCounts(tiles), VALUES, S);

describe('floorDiv', () => {
  it('rounds toward −∞, also for negative numerators', () => {
    expect(floorDiv(7, 2)).toBe(3);
    expect(floorDiv(-7, 2)).toBe(-4);
    expect(floorDiv(-90, 1000)).toBe(-1);
    expect(floorDiv(0, 5)).toBe(0);
  });
});

describe('raw(K) on letters-v1 (spec S-2 table)', () => {
  it('tile terms: E A I O N R T +10, S +40, C L P U 0, D M G H B −10, Y F −20, K W −30, V −40, X Q J Z −60', () => {
    const expected: Record<string, number> = {
      E: 10,
      A: 10,
      I: 10,
      O: 10,
      N: 10,
      R: 10,
      T: 10,
      S: 40,
      C: 0,
      L: 0,
      P: 0,
      U: 0,
      D: -10,
      M: -10,
      G: -10,
      H: -10,
      B: -10,
      Y: -20,
      F: -20,
      K: -30,
      W: -30,
      V: -40,
      X: -60,
      Q: -60,
      J: -60,
      Z: -60,
    };
    for (const [letter, dp] of Object.entries(expected)) {
      expect(letterDp(letter.charCodeAt(0) - 65, VALUES, S)).toBe(dp);
    }
  });

  it('matches the GD-3 worked example and the vowel / duplicate terms', () => {
    expect(raw('KUVW')).toBe(-100); // n 4, ideal 1, one vowel
    expect(raw('?ER')).toBe(170); // the blank is +150 and is not a vowel or a duplicate
    expect(raw('')).toBe(0);
    expect(raw('AEI')).toBe(30 - 60 - 40); // ideal 1, three vowels, all vowels
    expect(raw('RST')).toBe(60 - 30 - 40); // ideal 1, no vowel, none
    expect(raw('EE')).toBe(20 - 30 - 25); // ideal 1, two vowels, one duplicate
    expect(raw('??')).toBe(300); // blanks exempt from duplicates
    expect(raw('SSS')).toBe(120 - 30 - 40 - 50);
  });

  it('is a pure function of the multiset', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...Array.from('?ABEKSUZ')), { maxLength: 7 }),
        (tiles) => {
          expect(raw(tiles.join(''))).toBe(raw([...tiles].reverse().join('')));
        },
      ),
    );
  });

  it('sums letter values, blanks worth 0', () => {
    expect(countsValue(tileCounts('?ZQA'), VALUES)).toBe(19);
  });
});

describe('best keep K* (S-4)', () => {
  it('keeps ?ER of ?EKRUVW and gives back KUVW (GD-3 worked example)', () => {
    expect(bestKeep('?EKRUVW', VALUES, S)).toEqual({ keep: '?ER', give: 'KUVW', raw: 170 });
  });

  it('keeps at most 6 tiles and at most |rack| − 1, so an exchange returns ≥ 1 tile', () => {
    const full = bestKeep('?AERST?', VALUES, S);
    expect(full.keep).toHaveLength(6);
    expect(full.give).toHaveLength(1);
    expect(bestKeep('S', VALUES, S)).toEqual({ keep: '', give: 'S', raw: 0 });
    expect(bestKeep('', VALUES, S)).toEqual({ keep: '', give: '', raw: 0 });
  });

  it('breaks ties toward the larger keep, then the code-unit-smallest string', () => {
    // R and T alone are +10 each (no vowel, ideal 0); together −10 (ideal 1, no vowel): R wins on the string.
    expect(bestKeep('QRTZ', VALUES, S).keep).toBe('R');
    // N, R, T are interchangeable: the smallest string wins among equal keeps.
    expect(bestKeep('QTRN', VALUES, S).keep).toBe('N');
  });

  it('K* maximises raw over every sub-multiset of size ≤ 6', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...Array.from('?AEKNRSUVZ')), { minLength: 1, maxLength: 7 }),
        (tiles) => {
          const rack = tiles.sort(byCode).join('');
          const best = bestKeep(rack, VALUES, S);
          for (let mask = 0; mask < 1 << rack.length; mask += 1) {
            const keep = Array.from(rack)
              .filter((_, i) => (mask & (1 << i)) !== 0)
              .join('');
            if (keep.length <= Math.min(6, rack.length - 1)) {
              expect(best.raw).toBeGreaterThanOrEqual(raw(keep));
            }
          }
          expect(best.raw).toBe(raw(best.keep));
          expect(
            Array.from(best.keep + best.give)
              .sort(byCode)
              .join(''),
          ).toBe(rack);
        },
      ),
      { numRuns: 60 },
    );
  });
});
