import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getLetterTable } from './rules/constants.js';
import {
  countTiles,
  initialBag,
  isBlankOnBoard,
  isBoardTile,
  isLetter,
  isRackTile,
  letterOf,
  rackTileOf,
  removeTiles,
  sortTiles,
  tileValue,
} from './tiles.js';
import type { RackTile } from './types.js';

const table = getLetterTable('letters-v1');
const rackTile = fc.constantFrom(...('?ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') as RackTile[]));

describe('tile predicates', () => {
  it.each([
    ['A', true, true, true],
    ['Z', true, true, true],
    ['?', false, true, false],
    ['a', false, false, true],
    ['z', false, false, true],
    ['@', false, false, false],
    ['[', false, false, false],
    ['`', false, false, false],
    ['{', false, false, false],
    ['AB', false, false, false],
    ['', false, false, false],
    [1, false, false, false],
    [null, false, false, false],
  ])('%j: letter %s, rack %s, board %s', (value, letter, rack, board) => {
    expect(isLetter(value)).toBe(letter);
    expect(isRackTile(value)).toBe(rack);
    expect(isBoardTile(value)).toBe(board);
  });

  it('maps board tiles to rack tiles and letters (R-BAG-006)', () => {
    expect(isBlankOnBoard('k')).toBe(true);
    expect(isBlankOnBoard('K')).toBe(false);
    expect(rackTileOf('k')).toBe('?');
    expect(rackTileOf('K')).toBe('K');
    expect(letterOf('k')).toBe('K');
  });
});

describe('multisets', () => {
  it('sortTiles orders by code unit, blanks first', () => {
    expect(sortTiles('ZA?B?')).toBe('??ABZ');
  });

  it('countTiles counts letters and blanks', () => {
    const counts = countTiles('A?AZ');
    expect(counts).toHaveLength(27);
    expect([counts[0], counts[25], counts[26]]).toEqual([2, 1, 1]);
  });

  it('removeTiles reports exactly the missing tiles', () => {
    expect(removeTiles('??AEINS', ['A', '?', 'S'])).toEqual({ rest: '?EIN', missing: '' });
    expect(removeTiles('AEINST', ['A', 'A', '?', 'Z'])).toEqual({
      rest: 'EINST',
      missing: '?AZ',
    });
  });

  it('property: removeTiles agrees with a naive multiset difference', () => {
    fc.assert(
      fc.property(
        fc.array(rackTile, { maxLength: 9 }),
        fc.array(rackTile, { maxLength: 9 }),
        (rack, take) => {
          const pool = [...rack];
          const missing: string[] = [];
          for (const t of take) {
            const i = pool.indexOf(t);
            if (i === -1) missing.push(t);
            else pool.splice(i, 1);
          }
          expect(removeTiles(sortTiles(rack), take)).toEqual({
            rest: sortTiles(pool),
            missing: sortTiles(missing),
          });
        },
      ),
      { seed: 2024, numRuns: 500 },
    );
  });
});

describe('initial bag and values (R-BAG-001, R-BAG-002, R-BAG-006)', () => {
  it('builds the sorted 100-tile bag of letters-v1', () => {
    const bag = initialBag(table);
    expect(bag).toHaveLength(100);
    expect(bag.startsWith('??AAAAAAAAB')).toBe(true);
    expect(bag.endsWith('YYZ')).toBe(true);
    expect(sortTiles(bag)).toBe(bag);
    const counts = countTiles(bag);
    expect(counts.slice(0, 26)).toEqual([...table.counts]);
    expect(counts[26]).toBe(2);
  });

  it('P-BAG-002-b: blanks score 0, letters their table value', () => {
    expect(tileValue(table, '?')).toBe(0);
    expect(tileValue(table, 'z')).toBe(0);
    expect(tileValue(table, 'Z')).toBe(10);
    expect(tileValue(table, 'K')).toBe(5);
  });
});
