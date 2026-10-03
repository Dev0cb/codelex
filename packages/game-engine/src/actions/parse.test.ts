import { describe, expect, it } from 'vitest';
import { parseAction } from './parse.js';

const fail = (input: unknown, seats = 2): unknown => {
  const r = parseAction(input, seats);
  return r.ok ? undefined : r.error.code === 'malformed' ? r.error.details : r.error;
};

describe('parseAction — malformed (API note §8.2, R-TURN-001 a)', () => {
  it.each([
    ['not an object', 'x', { violation: 'unknown_type', field: '' }],
    ['null', null, { violation: 'unknown_type', field: '' }],
    ['an array', [], { violation: 'unknown_type', field: '' }],
    ['a class instance', new Map(), { violation: 'unknown_type', field: '' }],
    ['unknown type', { seat: 0, type: 'USE_POWER' }, { violation: 'unknown_type', field: 'type' }],
    ['missing type', { seat: 0 }, { violation: 'unknown_type', field: 'type' }],
    [
      'client score (R-CORE-002 a)',
      { seat: 0, type: 'PASS', score: 10 },
      { violation: 'unknown_field', field: 'score' },
    ],
    [
      'reserved timestamp',
      { seat: 0, type: 'PASS', at: 1 },
      { violation: 'unknown_field', field: 'at' },
    ],
    [
      'first unknown key in sorted order',
      { seat: 0, type: 'PASS', z: 1, b: 1 },
      { violation: 'unknown_field', field: 'b' },
    ],
    ['missing seat', { type: 'PASS' }, { violation: 'seat_out_of_range', field: 'seat' }],
    ['seat = seats', { seat: 2, type: 'PASS' }, { violation: 'seat_out_of_range', field: 'seat' }],
    [
      'negative seat',
      { seat: -1, type: 'PASS' },
      { violation: 'seat_out_of_range', field: 'seat' },
    ],
    [
      'fractional seat',
      { seat: 0.5, type: 'PASS' },
      { violation: 'seat_out_of_range', field: 'seat' },
    ],
    ['string seat', { seat: '0', type: 'PASS' }, { violation: 'seat_out_of_range', field: 'seat' }],
    [
      'tiles not an array',
      { seat: 0, type: 'EXCHANGE', tiles: 'AB' },
      { violation: 'bad_tile', field: 'tiles' },
    ],
    [
      'exchange of a board tile',
      { seat: 0, type: 'EXCHANGE', tiles: ['A', 'a'] },
      { violation: 'bad_tile', field: 'tiles[1]' },
    ],
    [
      'placement not an object',
      { seat: 0, type: 'PLACE_WORD', tiles: ['A'] },
      { violation: 'bad_tile', field: 'tiles[0]' },
    ],
    [
      'placement with an extra key',
      { seat: 0, type: 'PLACE_WORD', tiles: [{ row: 7, col: 7, tile: 'A', score: 3 }] },
      { violation: 'unknown_field', field: 'tiles[0].score' },
    ],
    [
      'fractional row',
      { seat: 0, type: 'PLACE_WORD', tiles: [{ row: 7.5, col: 7, tile: 'A' }] },
      { violation: 'bad_coordinate', field: 'tiles[0].row' },
    ],
    [
      'missing col',
      { seat: 0, type: 'PLACE_WORD', tiles: [{ row: 7, tile: 'A' }] },
      { violation: 'bad_coordinate', field: 'tiles[0].col' },
    ],
    [
      'undesignated blank (R-BAG-006 a)',
      { seat: 0, type: 'PLACE_WORD', tiles: [{ row: 7, col: 7, tile: '?' }] },
      { violation: 'blank_undesignated', field: 'tiles[0].tile' },
    ],
    [
      'bad tile char',
      { seat: 0, type: 'PLACE_WORD', tiles: [{ row: 7, col: 7, tile: 'AB' }] },
      { violation: 'bad_tile', field: 'tiles[0].tile' },
    ],
  ])('%s', (_name, input, details) => {
    expect(fail(input)).toEqual(details);
  });

  it('has a developer message and kind rejection', () => {
    const r = parseAction({ seat: 9, type: 'PASS' }, 2);
    expect(r).toEqual({
      ok: false,
      error: {
        kind: 'rejection',
        code: 'malformed',
        message: 'malformed action: seat_out_of_range at seat',
        details: { violation: 'seat_out_of_range', field: 'seat' },
      },
    });
    expect(parseAction(1, 2)).toMatchObject({
      error: { message: 'malformed action: unknown_type at <root>' },
    });
  });
});

describe('parseAction — canonical form (API note §8.1)', () => {
  it('PASS and RESIGN keep only seat and type', () => {
    expect(parseAction({ type: 'PASS', seat: 1 }, 2)).toEqual({
      ok: true,
      value: { seat: 1, type: 'PASS' },
    });
    expect(
      parseAction(Object.assign(Object.create(null) as object, { type: 'RESIGN', seat: 0 }), 2),
    ).toEqual({
      ok: true,
      value: { seat: 0, type: 'RESIGN' },
    });
  });

  it('sorts exchange tiles by code unit', () => {
    expect(parseAction({ seat: 0, type: 'EXCHANGE', tiles: ['Z', '?', 'A'] }, 2)).toEqual({
      ok: true,
      value: { seat: 0, type: 'EXCHANGE', tiles: ['?', 'A', 'Z'] },
    });
  });

  it('sorts placements by (row, col) and copies them', () => {
    const input = {
      seat: 0,
      type: 'PLACE_WORD',
      tiles: [
        { row: 8, col: 1, tile: 'b' },
        { col: 9, row: 7, tile: 'C' },
        { row: 7, col: 2, tile: 'A' },
      ],
    };
    const r = parseAction(input, 2);
    expect(r).toEqual({
      ok: true,
      value: {
        seat: 0,
        type: 'PLACE_WORD',
        tiles: [
          { row: 7, col: 2, tile: 'A' },
          { row: 7, col: 9, tile: 'C' },
          { row: 8, col: 1, tile: 'b' },
        ],
      },
    });
    if (r.ok && r.value.type === 'PLACE_WORD') expect(r.value.tiles[0]).not.toBe(input.tiles[2]);
  });

  it('n2: the canonical order is total: tiles on one square are ordered by tile code unit', () => {
    const tiles = [
      { row: 7, col: 7, tile: 'b' },
      { row: 7, col: 7, tile: 'B' },
      { row: 7, col: 7, tile: 'A' },
    ];
    const canonical = (order: typeof tiles): unknown => {
      const r = parseAction({ seat: 0, type: 'PLACE_WORD', tiles: order }, 2);
      return r.ok && r.value.type === 'PLACE_WORD' ? r.value.tiles.map((t) => t.tile) : r;
    };
    expect(canonical(tiles)).toEqual(['A', 'B', 'b']);
    expect(canonical([...tiles].reverse())).toEqual(['A', 'B', 'b']);
  });

  it('leaves geometry to the placement check: empty, off-board and duplicate tiles parse', () => {
    expect(parseAction({ seat: 0, type: 'PLACE_WORD', tiles: [] }, 2).ok).toBe(true);
    expect(
      parseAction(
        {
          seat: 0,
          type: 'PLACE_WORD',
          tiles: [
            { row: -1, col: 99, tile: 'A' },
            { row: -1, col: 99, tile: 'A' },
          ],
        },
        2,
      ).ok,
    ).toBe(true);
  });
});
