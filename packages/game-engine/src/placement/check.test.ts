import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CTX, boardWith, spell } from '../../test/support/small-lexicon.js';
import { comparePlacements } from '../actions/parse.js';
import { getLayout } from '../rules/constants.js';
import { rulesFor } from '../rules/registry.js';
import { removeTiles, rackTileOf, sortTiles } from '../tiles.js';
import type { BoardTile, Placement, Rejection } from '../types.js';
import {
  checkPlacement,
  checkPlacementGeometry,
  placeTiles,
  type FormedWord,
  type PlacementInput,
} from './check.js';

const layout = getLayout('classic-v1');
const EMPTY = boardWith([]);

/** ADR-0014 §D1: internal modules take the match's rules; these unit tests run rules version 1. */
const R1 = rulesFor(1).rules;

const p = (row: number, col: number, tile: string): Placement => ({
  row,
  col,
  tile: tile as BoardTile,
});

function input(
  board: readonly string[],
  tiles: readonly Placement[],
  rack = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ??',
): PlacementInput {
  return {
    board,
    layout,
    rack: sortTiles(rack),
    tiles: [...tiles].sort(comparePlacements),
    rules: R1,
  };
}

function words(board: readonly string[], tiles: readonly Placement[], rack?: string): FormedWord[] {
  const r = checkPlacement(input(board, tiles, rack), CTX.lexicon);
  if (!r.ok) throw new Error(`rejected: ${JSON.stringify(r.error)}`);
  return [...r.value.words];
}

function rejection(
  board: readonly string[],
  tiles: readonly Placement[],
  rack?: string,
): Rejection {
  const r = checkPlacement(input(board, tiles, rack), CTX.lexicon);
  if (r.ok) throw new Error('expected a rejection');
  return r.error;
}

const violation = (
  board: readonly string[],
  tiles: readonly Placement[],
  rack?: string,
): unknown => {
  const e = rejection(board, tiles, rack);
  return e.code === 'placement' ? e.details.violation : e.code;
};

const summary = (ws: readonly FormedWord[]): string[] =>
  ws.map(
    (w) =>
      `${w.form}${w.main ? '*' : ''}@${String(w.start.row)},${String(w.start.col)}${w.direction}`,
  );

describe('first move (R-BOARD-004, R-TURN-002; GC-TURN-02)', () => {
  it('AI at (7,7)(7,8) is accepted', () => {
    expect(summary(words(EMPTY, [p(7, 7, 'A'), p(7, 8, 'I')]))).toEqual(['AI*@7,7row']);
  });

  it('AI at (3,3)(3,4) misses the start square', () => {
    expect(violation(EMPTY, [p(3, 3, 'A'), p(3, 4, 'I')])).toBe('start_not_covered');
  });

  it('a single tile at (7,7) is too short', () => {
    expect(violation(EMPTY, [p(7, 7, 'A')])).toBe('first_move_too_short');
  });

  it('a vertical first move reads top to bottom', () => {
    expect(summary(words(EMPTY, [p(6, 7, 'I'), p(7, 7, 'P')]))).toEqual(['IP*@6,7col']);
  });
});

describe('later moves (R-TURN-002; GC-TURN-03)', () => {
  const T = boardWith([[7, 7, 'T']]);

  it('C(7,8) P(7,9) after T forms TCP', () => {
    expect(summary(words(T, [p(7, 8, 'C'), p(7, 9, 'P')]))).toEqual(['TCP*@7,7row']);
  });

  it('C(7,8) P(7,10) leaves a gap', () => {
    expect(violation(T, [p(7, 8, 'C'), p(7, 10, 'P')])).toBe('gap');
  });

  it('C(8,8) P(9,9) is diagonal', () => {
    expect(violation(T, [p(8, 8, 'C'), p(9, 9, 'P')])).toBe('not_collinear');
  });

  it('a gap filled by an existing tile is not a gap (play through)', () => {
    const board = boardWith(spell('C', 7, 8));
    expect(summary(words(board, [p(7, 7, 'T'), p(7, 9, 'P')]))).toEqual(['TCP*@7,7row']);
  });

  it('a move touching nothing is not connected', () => {
    expect(violation(T, [p(0, 0, 'A'), p(0, 1, 'I')])).toBe('not_connected');
  });

  it('a tile on an occupied square is rejected', () => {
    expect(violation(T, [p(7, 7, 'A'), p(7, 8, 'I')])).toBe('occupied');
  });
});

describe('formed words (R-TURN-006)', () => {
  it('GC-SCORE-02: DNS down column 8, cross-word CDN on row 7', () => {
    const board = boardWith(spell('CD', 7, 6));
    const ws = words(board, [p(6, 8, 'D'), p(7, 8, 'N'), p(8, 8, 'S')]);
    expect(summary(ws)).toEqual(['DNS*@6,8col', 'CDN@7,6row']);
    expect(ws[1]?.cells.map((c) => c.isNew)).toEqual([false, false, true]);
  });

  it('GC-SCORE-03: single tile I above P of TCP forms the column word IP (main)', () => {
    const board = boardWith(spell('TCP', 7, 6));
    expect(summary(words(board, [p(6, 8, 'I')]))).toEqual(['IP*@6,8col']);
  });

  it('GC-TURN-06: single tile tie → the row word is main', () => {
    const board = boardWith([
      [7, 6, 'A'],
      [6, 7, 'C'],
    ]);
    expect(summary(words(board, [p(7, 7, 'D')]))).toEqual(['AD*@7,6row', 'CD@6,7col']);
  });

  it('single tile: the longer run is main even when it is the column', () => {
    const board = boardWith([...spell('PO', 5, 7, 'col'), [7, 6, 'A']]);
    expect(summary(words(board, [p(7, 7, 'D')]))).toEqual(['POD*@5,7col', 'AD@7,6row']);
  });

  it('P-TURN-006-d: pre-existing words without new tiles are not formed again', () => {
    const board = boardWith([...spell('TCP', 7, 6), ...spell('GIT', 9, 6)]);
    // TCP and GIT stay on the board; only the new column word IP is formed.
    expect(summary(words(board, [p(6, 8, 'I')]))).toEqual(['IP*@6,8col']);
  });

  it('E-1.7: a hook PODS is formed and resolved through its inflection', () => {
    const board = boardWith(spell('POD', 7, 6));
    const r = checkPlacement(input(board, [p(7, 9, 'S')]), CTX.lexicon);
    if (!r.ok) throw new Error('expected ok');
    const [word] = r.value.words;
    expect(word?.form).toBe('PODS');
    expect(CTX.lexicon.meta(CTX.lexicon.termOf(word?.ref ?? (-1 as never))).form).toBe('POD');
  });

  it('P-BAG-006-d: words through a blank are read with the designated letter; rack gives up a blank', () => {
    const r = checkPlacement(input(EMPTY, [p(7, 7, 'a'), p(7, 8, 'i')], '??'), CTX.lexicon);
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.words[0]?.form).toBe('AI');
    expect(r.value.words[0]?.cells.map((c) => c.tile)).toEqual(['a', 'i']);
    expect(r.value.rackAfter).toBe('');
  });
});

describe('rejection precedence (API note §8.3 step 5, P-API-08)', () => {
  it('tile_count before everything', () => {
    expect(violation(EMPTY, [])).toBe('tile_count');
    const eight = Array.from({ length: 8 }, (_, i) => p(7, i, 'A'));
    expect(violation(EMPTY, eight)).toBe('tile_count');
  });

  it('off_board before duplicate_square and rack', () => {
    expect(violation(EMPTY, [p(15, 7, 'Z'), p(15, 7, 'Z')], '')).toBe('off_board');
    expect(violation(EMPTY, [p(-1, 7, 'A')])).toBe('off_board');
    expect(violation(EMPTY, [p(7, -1, 'A')])).toBe('off_board');
    expect(violation(EMPTY, [p(7, 15, 'A')])).toBe('off_board');
  });

  it('duplicate_square before rack', () => {
    expect(violation(EMPTY, [p(7, 7, 'Z'), p(7, 7, 'Z')], '')).toBe('duplicate_square');
  });

  it('rack before occupied and geometry; lists the missing tiles sorted', () => {
    const board = boardWith([[7, 7, 'T']]);
    expect(rejection(board, [p(7, 7, 'Z'), p(9, 9, 'a'), p(8, 8, 'A')], 'A')).toEqual({
      kind: 'rejection',
      code: 'rack',
      message: 'tiles not on the rack',
      details: { missing: '?Z' },
    });
  });

  it('occupied before not_collinear, not_collinear before gap', () => {
    const board = boardWith([[7, 7, 'T']]);
    expect(violation(board, [p(7, 7, 'A'), p(9, 9, 'B')])).toBe('occupied');
    expect(violation(board, [p(7, 9, 'A'), p(9, 9, 'B'), p(9, 11, 'C')])).toBe('not_collinear');
  });

  it('gap before start_not_covered; start_not_covered before first_move_too_short', () => {
    expect(violation(EMPTY, [p(3, 3, 'A'), p(3, 5, 'I')])).toBe('gap');
    expect(violation(EMPTY, [p(3, 3, 'A')])).toBe('start_not_covered');
  });

  it('R-TURN-003 / P-TURN-003-b: not_in_lexicon last, listing every non-playable word with its role (GC-SCORE-04)', () => {
    const ai = boardWith(spell('AI', 7, 6));
    expect(rejection(ai, [p(7, 8, 'M')])).toEqual({
      kind: 'rejection',
      code: 'not_in_lexicon',
      message: 'formed word(s) not in the lexicon',
      details: { words: [{ form: 'AIM', main: true }] },
    });
    // A valid main word with an invalid cross-word: only the cross-word is listed.
    const board = boardWith(spell('CD', 7, 6));
    expect(rejection(board, [p(6, 8, 'D'), p(7, 8, 'X'), p(8, 8, 'S')])).toMatchObject({
      code: 'not_in_lexicon',
      details: {
        words: [
          { form: 'DXS', main: true },
          { form: 'CDX', main: false },
        ],
      },
    });
  });
});

describe('placeTiles', () => {
  it('writes tiles and shares untouched rows', () => {
    const after = placeTiles(EMPTY, [p(7, 7, 'A'), p(7, 8, 'i')]);
    expect(after[7]).toBe('.......Ai......');
    expect(after[6]).toBe(EMPTY[6]);
    expect(EMPTY[7]).toBe('...............');
  });
});

// ---------------------------------------------------------------------------------------------------------
// Property: geometry check vs an independent oracle (G-PLACEMENT-GEOM, P-TURN-002, P-TURN-006, P-BOARD-004).
// ---------------------------------------------------------------------------------------------------------

const SIZE = 15;
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const occupied = (b: readonly string[], r: number, c: number): boolean =>
  r >= 0 && c >= 0 && r < SIZE && c < SIZE && b[r]?.charAt(c) !== '.';

/** First violated check, written independently of check.ts as plain loops over the rules text. */
function oracleViolation(
  board: readonly string[],
  tiles: readonly Placement[],
  rack: string,
): string | undefined {
  if (tiles.length === 0 || tiles.length > 7) return 'tile_count';
  if (tiles.some((t) => t.row < 0 || t.row >= SIZE || t.col < 0 || t.col >= SIZE))
    return 'off_board';
  const keys = tiles.map((t) => `${String(t.row)},${String(t.col)}`);
  if (new Set(keys).size !== keys.length) return 'duplicate_square';
  if (
    removeTiles(
      rack,
      tiles.map((t) => rackTileOf(t.tile)),
    ).missing !== ''
  )
    return 'rack';
  if (tiles.some((t) => occupied(board, t.row, t.col))) return 'occupied';
  const rows = new Set(tiles.map((t) => t.row));
  const cols = new Set(tiles.map((t) => t.col));
  if (rows.size > 1 && cols.size > 1) return 'not_collinear';
  const after = placeTiles(board, tiles);
  const rs = tiles.map((t) => t.row);
  const cs = tiles.map((t) => t.col);
  for (let r = Math.min(...rs); r <= Math.max(...rs); r += 1) {
    for (let c = Math.min(...cs); c <= Math.max(...cs); c += 1) {
      if (!occupied(after, r, c)) return 'gap';
    }
  }
  const empty = board.every((line) => line === '.'.repeat(SIZE));
  if (empty) {
    if (!tiles.some((t) => t.row === 7 && t.col === 7)) return 'start_not_covered';
    if (tiles.length < 2) return 'first_move_too_short';
    return undefined;
  }
  const adjacent = tiles.some((t) =>
    [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ].some(([dr, dc]) => occupied(board, t.row + (dr ?? 0), t.col + (dc ?? 0))),
  );
  return adjacent ? undefined : 'not_connected';
}

/** Every maximal run ≥ 2 of the board after placement that contains a new tile, keyed `form@r,c dir`. */
function oracleWords(board: readonly string[], tiles: readonly Placement[]): string[] {
  const after = placeTiles(board, tiles);
  const isNew = (r: number, c: number): boolean => tiles.some((t) => t.row === r && t.col === c);
  const found: string[] = [];
  for (const direction of ['row', 'col'] as const) {
    for (let line = 0; line < SIZE; line += 1) {
      let run: [number, number][] = [];
      for (let i = 0; i <= SIZE; i += 1) {
        const [r, c] = direction === 'row' ? [line, i] : [i, line];
        if (i < SIZE && occupied(after, r, c)) {
          run.push([r, c]);
          continue;
        }
        if (run.length >= 2 && run.some(([rr, cc]) => isNew(rr, cc))) {
          const form = run.map(([rr, cc]) => (after[rr]?.charAt(cc) ?? '').toUpperCase()).join('');
          const [r0, c0] = run[0] ?? [0, 0];
          found.push(`${form}@${String(r0)},${String(c0)}${direction}`);
        }
        run = [];
      }
    }
  }
  return found.sort(byCodeUnit);
}

const letterArb = fc.constantFrom(...'ABCDEIOPST'.split(''));
const boardTileArb = fc.oneof(
  { weight: 9, arbitrary: letterArb },
  { weight: 1, arbitrary: fc.constantFrom('a', 'i', 's') },
);
const coord = fc.integer({ min: 3, max: 11 });
const existingArb = fc.oneof(
  { weight: 1, arbitrary: fc.constant<[number, number, string][]>([]) },
  {
    weight: 4,
    arbitrary: fc.array(fc.tuple(coord, coord, letterArb), { minLength: 1, maxLength: 14 }),
  },
);
const lineArb = fc
  .record({
    vertical: fc.boolean(),
    row: coord,
    col: coord,
    length: fc.integer({ min: 1, max: 6 }),
    holes: fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 2 }),
  })
  .chain(({ vertical, row, col, length, holes }) =>
    fc
      .array(boardTileArb, { minLength: length, maxLength: length })
      .map((ts) =>
        ts
          .map((tile, i) => p(vertical ? row + i : row, vertical ? col : col + i, tile))
          .filter((_, i) => !holes.includes(i) || length === 1),
      ),
  );
const scatteredArb: fc.Arbitrary<Placement[]> = fc.array(
  fc.record({
    row: fc.integer({ min: -1, max: 15 }),
    col: fc.integer({ min: -1, max: 15 }),
    tile: boardTileArb.map((t) => t as BoardTile),
  }),
  { minLength: 0, maxLength: 8 },
);
const placementArb = fc.oneof(
  { weight: 4, arbitrary: lineArb },
  { weight: 1, arbitrary: scatteredArb },
);

describe('property: geometry check ≡ independent oracle', () => {
  it('accepts exactly the oracle-legal placements and forms exactly the oracle words', () => {
    let accepted = 0;
    fc.assert(
      fc.property(existingArb, placementArb, fc.boolean(), (existing, rawTiles, fullRack) => {
        const board = boardWith(existing);
        const tiles = [...rawTiles].sort(comparePlacements);
        const needed = tiles.map((t) => rackTileOf(t.tile)).join('');
        const rack = sortTiles(fullRack ? needed + 'XYZ' : needed.slice(1));
        const r = checkPlacementGeometry({ board, layout, rack, tiles, rules: R1 });
        const expected = oracleViolation(board, tiles, rack);
        if (!r.ok) {
          const got = r.error.code === 'placement' ? r.error.details.violation : r.error.code;
          expect(got).toBe(expected);
          return;
        }
        accepted += 1;
        expect(expected).toBeUndefined();
        const ws = r.value.words;
        expect(
          ws
            .map((w) => `${w.form}@${String(w.start.row)},${String(w.start.col)}${w.direction}`)
            .sort(byCodeUnit),
        ).toEqual(oracleWords(board, tiles));
        // Exactly one main word, first; it lies on the placement line (or the longer/tie-row run for one tile).
        expect(ws.filter((w) => w.main)).toHaveLength(1);
        expect(ws[0]?.main).toBe(true);
        const main = ws[0] as FormedWord;
        if (tiles.length > 1) {
          const line = tiles.every((t) => t.row === tiles[0]?.row) ? 'row' : 'col';
          expect(main.direction).toBe(line);
          expect(
            tiles.every((t) => main.cells.some((c) => c.row === t.row && c.col === t.col)),
          ).toBe(true);
        } else {
          const crossLen = ws[1]?.form.length ?? 1;
          expect(
            main.form.length > crossLen ||
              (main.form.length === crossLen && main.direction === 'row'),
          ).toBe(true);
        }
        // Cross-words in (row, col) order of their new tile.
        const crossKeys = ws.slice(1).map((w) => {
          const t = w.cells.find((c) => c.isNew) as Placement;
          return t.row * SIZE + t.col;
        });
        expect([...crossKeys].sort((a, b) => a - b)).toEqual(crossKeys);
        expect(r.value.rackAfter).toBe(
          removeTiles(
            rack,
            tiles.map((t) => rackTileOf(t.tile)),
          ).rest,
        );
      }),
      { seed: 20261002, numRuns: 3000 },
    );
    expect(accepted).toBeGreaterThan(100);
  });
});
