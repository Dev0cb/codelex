import { describe, expect, it } from 'vitest';
import type { SMALL_VERSION } from '../../test/support/small-lexicon.js';
import { CTX, config1v1, smallLexicon } from '../../test/support/small-lexicon.js';
import { getLetterTable } from '../rules/constants.js';
import { chars } from '../tiles.js';
import type { MatchEvent, MatchState, Observation, PlaceWordAction } from '../types.js';
import { apply } from './apply.js';
import { createMatch } from './create.js';
import { eventsFor, evaluateMove, observe, previewScore } from './observe.js';

const created = createMatch(config1v1(), CTX);
if (!created.ok) throw new Error('fixture');
const START = created.value.state;
const EVENTS = created.value.events;

const state = (overrides: Partial<MatchState>, racks?: readonly string[]): MatchState => ({
  ...START,
  seatOnTurn: 0,
  seats: START.seats.map((s, i) => ({ ...s, rack: racks?.[i] ?? s.rack })),
  ...overrides,
});

const AI: PlaceWordAction = {
  seat: 0,
  type: 'PLACE_WORD',
  tiles: [
    { row: 7, col: 7, tile: 'A' },
    { row: 7, col: 8, tile: 'I' },
  ],
};

describe('observe (API note §10, P-GLOBAL-07, P-API-03)', () => {
  it('shows the own rack and only counts of the others; no seed, rng or bag order', () => {
    const o = observe(START, 0);
    expect(o.rack).toBe(START.seats[0]?.rack);
    expect(o.bagCount).toBe(86);
    expect(o.seats.map((s) => s.rackCount)).toEqual([7, 7]);
    expect(o.teamScores).toEqual([0, 0]);
    const text = JSON.stringify(o);
    expect(text).not.toContain(START.seed);
    expect(text).not.toContain(START.bag);
    expect(text).not.toContain(START.seats[1]?.rack);
    expect(Object.keys(o)).not.toEqual(expect.arrayContaining(['seed', 'rng', 'bag']));
    expect(o.result).toBeUndefined();
  });

  it('unseen = initial bag − board − own rack (27 counts, blank last)', () => {
    const o = observe(
      state({ board: START.board.map((r, i) => (i === 7 ? '.......Ai......' : r)) }, [
        '?AEINST',
        'BCDFGHJ',
      ]),
      0,
    );
    const table = getLetterTable('letters-v1');
    expect(o.unseen).toHaveLength(27);
    expect(o.unseen[26]).toBe(0); // one blank on the own rack, one on the board (the i)
    expect(o.unseen[0]).toBe((table.counts[0] ?? 0) - 2); // own A + board A
    expect(o.unseen[8]).toBe((table.counts[8] ?? 0) - 1); // own I (the board i is a blank)
    const spectator = observe(START, 'spectator');
    expect(spectator.rack).toBe('');
    expect(spectator.unseen.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('P-API-03: hidden-information changes do not change an observation', () => {
    const other: MatchState = {
      ...START,
      seed: 'ffffffffffffffff' as MatchState['seed'],
      rng: { bag: [9, 9, 9, 9] },
      bag: chars(START.bag).reverse().join(''),
      seats: START.seats.map((s, i) => (i === 1 ? { ...s, rack: 'ZZZZZZZ' } : s)),
    };
    expect(observe(other, 0)).toEqual(observe(START, 0));
    expect(observe(other, 'spectator')).toEqual(observe(START, 'spectator'));
  });

  it('R-END-003 (Q-GD-5): final racks and result are public once the match is over', () => {
    const r = apply(START, { seat: 1, type: 'RESIGN' }, CTX);
    if (!r.ok) throw new Error('resign');
    const o = observe(r.value.state, 0);
    expect(o.finalRacks).toEqual(START.seats.map((s) => s.rack));
    expect(o.result?.end).toEqual({ reason: 'resign', seat: 1 });
  });

  it('teams and team scores follow config.teams (2v2)', () => {
    const c = config1v1();
    const r = createMatch(
      {
        ...c,
        config: {
          ...c.config,
          format: 'untimed',
          seats: 4,
          teams: [
            [0, 2],
            [1, 3],
          ],
        },
      },
      CTX,
    );
    if (!r.ok) throw new Error('2v2');
    const s: MatchState = {
      ...r.value.state,
      seats: r.value.state.seats.map((x, i) => ({ ...x, score: i + 1 })),
    };
    const o = observe(s, 2);
    expect(o.seats.map((x) => x.team)).toEqual([0, 1, 0, 1]);
    expect(o.teamScores).toEqual([4, 6]);
  });

  it('throws for a seat outside the match (programmer error)', () => {
    expect(() => observe(START, 2)).toThrow(RangeError);
    expect(() => observe(START, 0.5)).toThrow(RangeError);
  });
});

describe('eventsFor (P-API-04)', () => {
  const exchange: MatchEvent = { type: 'TILES_EXCHANGED', seat: 0, count: 2, returned: 'AB' };

  it('keeps own drawn/returned tiles and strips the tiles of everybody else', () => {
    const forSeat0 = eventsFor([...EVENTS, exchange], 0);
    expect(forSeat0[1]).toMatchObject({ seat: 0, tiles: START.seats[0]?.rack });
    expect(forSeat0[2]).not.toHaveProperty('tiles');
    expect(forSeat0[4]).toEqual(exchange);
    const forSeat1 = eventsFor([...EVENTS, exchange], 1);
    expect(forSeat1[1]).not.toHaveProperty('tiles');
    expect(forSeat1[4]).toEqual({ type: 'TILES_EXCHANGED', seat: 0, count: 2 });
    const spectator = eventsFor(EVENTS, 'spectator');
    expect(JSON.stringify(spectator)).not.toContain(START.seats[0]?.rack);
    expect(spectator[0]).toBe(EVENTS[0]);
  });
});

describe('evaluateMove (API note §13.4, P-API-01)', () => {
  const s = state({}, ['AEIMNST', 'BCDFGHJ']);

  it('equals the breakdown apply produces, without the turn check', () => {
    const ev = evaluateMove(observe(s, 0), AI, CTX);
    const applied = apply(s, AI, CTX);
    if (!ev.ok || !applied.ok) throw new Error('expected ok');
    const placed = applied.value.events[0];
    expect(placed?.type === 'WORD_PLACED' && placed.breakdown).toEqual(ev.value.breakdown);
    expect(ev.value).toMatchObject({ leave: 'EMNST', goesOut: false, action: AI });
    // Seat 1 may evaluate before its turn.
    const off = evaluateMove(
      observe(state({}, ['AEIMNST', 'AIBCDFG']), 1),
      { ...AI, seat: 1 },
      CTX,
    );
    expect(off.ok).toBe(true);
  });

  it('goesOut when the leave is empty and the bag is empty', () => {
    const ev = evaluateMove(observe(state({ bag: '' }, ['AI', 'B']), 0), AI, CTX);
    expect(ev.ok && ev.value.goesOut).toBe(true);
  });

  it('rejects like apply: placement, rack, lexicon', () => {
    const o = observe(s, 0);
    const code = (a: PlaceWordAction): unknown => {
      const r = evaluateMove(o, a, CTX);
      return r.ok ? 'ok' : r.error.code;
    };
    expect(code({ ...AI, tiles: [] })).toBe('placement');
    expect(
      code({
        ...AI,
        tiles: [
          { row: 7, col: 7, tile: 'Z' },
          { row: 7, col: 8, tile: 'Z' },
        ],
      }),
    ).toBe('rack');
    expect(
      code({
        ...AI,
        tiles: [
          { row: 7, col: 7, tile: 'M' },
          { row: 7, col: 8, tile: 'E' },
        ],
      }),
    ).toBe('not_in_lexicon');
  });

  it('spectators, other seats, other action types and malformed input are malformed', () => {
    const fail = (o: Observation, a: unknown): unknown => {
      const r = evaluateMove(o, a as PlaceWordAction, CTX);
      return r.ok
        ? 'ok'
        : r.error.kind === 'rejection' && r.error.code === 'malformed'
          ? r.error.details.violation
          : r.error.code;
    };
    expect(fail(observe(s, 'spectator'), AI)).toBe('seat_out_of_range');
    expect(fail(observe(s, 1), AI)).toBe('seat_out_of_range');
    expect(fail(observe(s, 0), { seat: 0, type: 'PASS' })).toBe('unknown_type');
    expect(fail(observe(s, 0), { ...AI, score: 9 })).toBe('unknown_field');
  });

  it('engine errors and match_over come first; a resigned viewer is not active', () => {
    const o = observe(s, 0);
    expect(evaluateMove({ ...o, engineRulesVersion: 2 as 1 }, AI, CTX)).toMatchObject({
      error: { code: 'RULES_VERSION_UNSUPPORTED' },
    });
    const foreign = { lexicon: smallLexicon('eeeeeeeeeeeeeeee' as typeof SMALL_VERSION) };
    expect(evaluateMove(o, AI, foreign)).toMatchObject({ error: { code: 'LEXICON_MISMATCH' } });
    expect(evaluateMove({ ...o, status: 'finished' }, AI, CTX)).toMatchObject({
      error: { code: 'match_over' },
    });
    const resigned = {
      ...o,
      seats: o.seats.map((x) => (x.seat === 0 ? { ...x, status: 'resigned' as const } : x)),
    };
    expect(evaluateMove(resigned, AI, CTX)).toMatchObject({
      error: { code: 'not_your_turn', details: { seatInactive: true } },
    });
  });
});

describe('previewScore (R-SCORE-009, P-API-02)', () => {
  const s = state({}, ['AEIMNST', 'BCDFGHJ']);

  it('equals Σ base + Full Stack of the committed move; lexicon-free (AIM previews too)', () => {
    expect(previewScore(observe(s, 0), AI.tiles)?.total).toBe(4);
    const aim = previewScore(observe(s, 0), [...AI.tiles, { row: 7, col: 9, tile: 'M' }]);
    expect(aim).toMatchObject({ total: 10, fullStack: 0 }); // (1 + 1 + 3) × 2, invalid word, still previewed
  });

  it('is null for geometry or rack failures, malformed tiles, spectators and finished matches', () => {
    expect(
      previewScore(observe(s, 0), [
        { row: 3, col: 3, tile: 'A' },
        { row: 3, col: 4, tile: 'I' },
      ]),
    ).toBeNull();
    expect(
      previewScore(observe(s, 0), [
        { row: 7, col: 7, tile: 'Z' },
        { row: 7, col: 8, tile: 'Z' },
      ]),
    ).toBeNull();
    expect(previewScore(observe(s, 0), [{ row: 7, col: 7, tile: '?' as 'A' }])).toBeNull();
    expect(previewScore(observe(s, 'spectator'), AI.tiles)).toBeNull();
    expect(previewScore({ ...observe(s, 0), status: 'finished' }, AI.tiles)).toBeNull();
  });
});
