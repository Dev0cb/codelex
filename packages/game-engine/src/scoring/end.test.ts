import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import classicGolden from '../../test/golden/scoring/v1/classic.json' with { type: 'json' };
import type { MatchEnd, MatchSetup, SeatState } from '../types.js';
import { endAdjustments, finishMatch, rackValue } from './end.js';

const SETUP_1V1: MatchSetup = {
  mode: 'classic',
  format: 'untimed-vs-bot',
  seats: 2,
  teams: [[0], [1]],
  layout: 'classic-v1',
  letters: 'letters-v1',
  requireWinner: 0,
};
const SETUP_2V2: MatchSetup = {
  ...SETUP_1V1,
  format: 'untimed',
  seats: 4,
  teams: [
    [0, 2],
    [1, 3],
  ],
};
const SETUP_FFA3: MatchSetup = {
  ...SETUP_1V1,
  format: 'untimed',
  seats: 3,
  teams: [[0], [1], [2]],
};

function seat(score: number, rack = '', extra: Partial<SeatState> = {}): SeatState {
  return { rack, score, chainK: 0, lastMainForm: '', bestTurnScore: 0, status: 'active', ...extra };
}

const sortedRack = (tiles: readonly string[]): string =>
  [...tiles].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('');

interface EndCase {
  readonly id: string;
  readonly seats: number;
  readonly endReason: 'going_out' | 'scoreless_turns' | 'resign';
  readonly wentOut?: number | null;
  readonly resigned?: number;
  readonly scoresBefore: readonly number[] | { readonly teamA: number; readonly teamB: number };
  readonly racks: readonly (readonly string[])[];
  readonly expected: Readonly<Record<string, unknown>>;
}

describe('golden end cases (RULE_PROPERTIES §3.1 GC-CL-E1…E5; R-SCORE-006, R-END-001…003)', () => {
  const cases = classicGolden.endCases as readonly EndCase[];

  it.each(cases.filter((c) => c.seats === 2).map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const before = c.scoresBefore as readonly number[];
    const end: MatchEnd =
      c.endReason === 'going_out'
        ? { reason: 'going_out', seat: c.wentOut ?? 0 }
        : c.endReason === 'resign'
          ? { reason: 'resign', seat: c.resigned ?? 0 }
          : { reason: 'scoreless_turns' };
    const seats = before.map((score, i) =>
      seat(score, sortedRack(c.racks[i] ?? []), {
        status: end.reason === 'resign' && end.seat === i ? 'resigned' : 'active',
      }),
    );
    const { seats: after, result } = finishMatch({ config: SETUP_1V1, firstSeat: 0, seats, end });
    expect(result.adjustments).toEqual(c.expected['adjustments']);
    expect(after.map((s) => s.score)).toEqual(c.expected['final']);
    expect(result.teamScores).toEqual(c.expected['final']);
    const places = { seat0_wins: [1, 2], seat1_wins: [2, 1], draw: [1, 1] }[
      c.expected['result'] as string
    ];
    expect(result.places).toEqual(places);
    expect(result.end).toEqual(end);
    expect(result.decidedBy).toBe(end.reason === 'resign' ? 'resign' : 'score');
  });

  it('GC-CL-E4 / GC-END-03: 2v2, A2 goes out while A1 holds L — team A nets +13, team B −13', () => {
    const c = cases.find((x) => x.id === 'GC-CL-E4') as EndCase;
    // Team totals 300/290 split arbitrarily between teammates; only sums matter.
    const seats = [seat(150, 'L'), seat(145, 'K'), seat(150, ''), seat(145, 'Q')];
    const { result } = finishMatch({
      config: SETUP_2V2,
      firstSeat: 0,
      seats,
      end: { reason: 'going_out', seat: 2 },
    });
    expect(result.adjustments).toEqual(c.expected['adjustmentsPerSeat']);
    expect(result.teamScores).toEqual([313, 277]);
    expect(result.places).toEqual([1, 2]);
  });
});

describe('R-SCORE-006 properties', () => {
  const rackArb = fc
    .array(fc.constantFrom('?', 'A', 'E', 'K', 'Q', 'Z', 'V'), { maxLength: 7 })
    .map(sortedRack);

  it('P-SCORE-006-a/b/c/d: going out is zero-sum in 1v1; scoreless subtracts; resign adjusts nothing', () => {
    fc.assert(
      fc.property(rackArb, rackArb, fc.integer({ min: 0, max: 1 }), (r0, r1, goer) => {
        const racks = goer === 0 ? ['', r1] : [r0, ''];
        const seats = racks.map((rack) => seat(100, rack));
        const out = endAdjustments({
          config: SETUP_1V1,
          firstSeat: 0,
          seats,
          end: { reason: 'going_out', seat: goer },
        });
        expect((out[0] ?? 0) + (out[1] ?? 0)).toBe(0);
        const scoreless = endAdjustments({
          config: SETUP_1V1,
          firstSeat: 0,
          seats: [seat(0, r0), seat(0, r1)],
          end: { reason: 'scoreless_turns' },
        });
        expect(scoreless).toEqual(
          [-rackValue(r0, SETUP_1V1), -rackValue(r1, SETUP_1V1)].map((x) => x + 0),
        ); // -0 → 0
        expect(
          endAdjustments({
            config: SETUP_1V1,
            firstSeat: 0,
            seats,
            end: { reason: 'resign', seat: 0 },
          }),
        ).toEqual([0, 0]);
      }),
      { seed: 6, numRuns: 300 },
    );
  });

  it('blanks count 0 in a rack (R-BAG-006)', () => {
    expect(rackValue('??', SETUP_1V1)).toBe(0);
    expect(rackValue('?QZ', SETUP_1V1)).toBe(18);
  });

  it('@ambiguous Q-GD-2: retired racks are neither added nor subtracted', () => {
    const seats = [seat(10, ''), seat(10, 'QZ', { status: 'resigned' }), seat(10, 'K')];
    expect(
      endAdjustments({
        config: SETUP_FFA3,
        firstSeat: 0,
        seats,
        end: { reason: 'going_out', seat: 0 },
      }),
    ).toEqual([5, 0, -5]);
  });
});

describe('R-END-003 result and tie-breaks (GC-END-05)', () => {
  const tie = (
    config: MatchSetup,
    best: readonly number[],
    firstSeat = 0,
  ): ReturnType<typeof finishMatch>['result'] =>
    finishMatch({
      config,
      firstSeat,
      seats: best.map((b) => seat(250, '', { bestTurnScore: b })),
      end: { reason: 'scoreless_turns' },
    }).result;

  it('equal scores draw unless a winner is required', () => {
    expect(tie(SETUP_1V1, [98, 74])).toMatchObject({ places: [1, 1], decidedBy: 'score' });
  });

  it('requireWinner: best single turn decides (98 vs 74)', () => {
    expect(tie({ ...SETUP_1V1, requireWinner: 1 }, [74, 98])).toMatchObject({
      places: [2, 1],
      decidedBy: 'tiebreak_best_turn',
    });
  });

  it('requireWinner: then the seat that did not move first', () => {
    expect(tie({ ...SETUP_1V1, requireWinner: 1 }, [80, 80], 0)).toMatchObject({
      places: [2, 1],
      decidedBy: 'tiebreak_second_mover',
    });
    expect(tie({ ...SETUP_1V1, requireWinner: 1 }, [80, 80], 1)).toMatchObject({ places: [1, 2] });
  });

  it('@ambiguous Q-GD-4: FFA three-way tie → the team whose seat moves latest from firstSeat', () => {
    // firstSeat 1 → order 1, 2, 0: seat 0 moves last.
    expect(tie({ ...SETUP_FFA3, requireWinner: 1 }, [50, 50, 50], 1).places).toEqual([1, 2, 2]);
  });

  it('2v2 tie-break uses the team best turn and the earliest-moving teammate', () => {
    const r = finishMatch({
      config: { ...SETUP_2V2, requireWinner: 1 },
      firstSeat: 0,
      seats: [seat(100), seat(100), seat(100), seat(100)],
      end: { reason: 'scoreless_turns' },
    }).result;
    // Team A's earliest seat (0) moves first; team B (1) moves later → B wins.
    expect(r).toMatchObject({ places: [2, 1], decidedBy: 'tiebreak_second_mover' });
  });

  it('only place 1 is tie-broken; other ties keep "1224" places', () => {
    const r = finishMatch({
      config: {
        ...SETUP_1V1,
        format: 'untimed',
        seats: 4,
        teams: [[0], [1], [2], [3]],
        requireWinner: 0,
      },
      firstSeat: 0,
      seats: [seat(300), seat(200), seat(200), seat(100)],
      end: { reason: 'scoreless_turns' },
    }).result;
    expect(r.places).toEqual([1, 2, 2, 4]);
  });

  it('GC-END-04: resign — resigner loses despite leading, no adjustment', () => {
    const r = finishMatch({
      config: SETUP_1V1,
      firstSeat: 0,
      seats: [seat(120, 'QZ', { status: 'resigned' }), seat(80, 'E')],
      end: { reason: 'resign', seat: 0 },
    });
    expect(r.seats.map((s) => s.score)).toEqual([120, 80]);
    expect(r.result).toMatchObject({ places: [2, 1], decidedBy: 'resign', adjustments: [0, 0] });
  });

  it('@ambiguous Q-GD-3: FFA — resigned seats rank below active ones and share that place', () => {
    const r = finishMatch({
      config: {
        ...SETUP_1V1,
        format: 'untimed',
        seats: 4,
        teams: [[0], [1], [2], [3]],
        requireWinner: 0,
      },
      firstSeat: 0,
      seats: [
        seat(300, '', { status: 'resigned' }),
        seat(10),
        seat(200, '', { status: 'resigned' }),
        seat(5, '', { status: 'resigned' }),
      ],
      end: { reason: 'resign', seat: 3 },
    }).result;
    expect(r.places).toEqual([2, 1, 2, 2]);
  });

  it('does not mutate its input', () => {
    const seats = Object.freeze([Object.freeze(seat(1, 'A')), Object.freeze(seat(2, ''))]);
    expect(() =>
      finishMatch({
        config: SETUP_1V1,
        firstSeat: 0,
        seats,
        end: { reason: 'going_out', seat: 1 },
      }),
    ).not.toThrow();
    expect(seats[0]?.score).toBe(1);
  });
});
