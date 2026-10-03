/**
 * Decision tests for GAME_RULES v0.3.1 (sprint G1, API note §16 Q-GD-1..4): each decided reading is pinned end to
 * end through `apply`, citing its rule ID. Q-GD-5 (final racks public) is pinned in `observe.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { CTX, config1v1 } from '../../test/support/small-lexicon.js';
import type { Action, MatchConfig, MatchState, SeatState } from '../types.js';
import { apply } from './apply.js';
import { createMatch } from './create.js';

const FFA = (seats: 3 | 4, requireWinner: 0 | 1 = 0): MatchConfig => ({
  ...config1v1(),
  config: {
    ...config1v1().config,
    format: 'untimed',
    seats,
    teams: Array.from({ length: seats }, (_, i) => [i]),
    requireWinner,
  },
});

/** A hand-built in-progress state of `config` with seat 0 on turn. */
function fixture(
  config: MatchConfig,
  seats: readonly Partial<SeatState>[],
  overrides: Partial<MatchState> = {},
): MatchState {
  const r = createMatch(config, CTX);
  if (!r.ok) throw new Error(r.error.code);
  const base = r.value.state;
  return {
    ...base,
    seatOnTurn: 0,
    seats: base.seats.map((s, i) => ({ ...s, ...(seats[i] ?? {}) })),
    ...overrides,
  };
}

function run(state: MatchState, action: Action): ReturnType<typeof apply> & { ok: true } {
  const r = apply(state, action, CTX);
  if (!r.ok) throw new Error(`rejected: ${JSON.stringify(r.error)}`);
  return r;
}

const AI: Action = {
  seat: 0,
  type: 'PLACE_WORD',
  tiles: [
    { row: 7, col: 7, tile: 'A' },
    { row: 7, col: 8, tile: 'I' },
  ],
};

describe('Q-GD-1 · R-TURN-004: the scoreless limit counts active seats; a RESIGN never triggers it', () => {
  // FFA 4: limit 12. Nine scoreless turns, then seat 3 resigns out of turn: the limit drops to 9.
  const before = fixture(FFA(4), [{ rack: 'AEINRST' }], { scorelessTurns: 9 });
  const resigned = run(before, { seat: 3, type: 'RESIGN' }).value.state;

  it('the resignation itself neither ends the match nor resets the counter', () => {
    expect(resigned.status).toBe('in_progress');
    expect(resigned.scorelessTurns).toBe(9);
  });

  it('the next scoreless turn ends the match on the lowered limit (3 × 3 active seats)', () => {
    const next = run(resigned, { seat: 0, type: 'PASS' }).value.state;
    expect(next.status).toBe('finished');
    expect(next.scorelessTurns).toBe(10);
    expect(next.result?.end).toEqual({ reason: 'scoreless_turns' });
  });

  it('an accepted PLACE_WORD still resets the counter', () => {
    const next = run(resigned, AI).value.state;
    expect(next.status).toBe('in_progress');
    expect(next.scorelessTurns).toBe(0);
  });
});

describe('Q-GD-2 · R-SCORE-006: retired racks are neither added nor subtracted', () => {
  it('going out in FFA after a resignation ignores the retired rack', () => {
    const s = fixture(
      FFA(3),
      [
        { rack: 'AI', score: 20 },
        { rack: 'QZ', score: 50 },
        { rack: 'K', score: 30 },
      ],
      { bag: '' },
    );
    const resigned = run(s, { seat: 1, type: 'RESIGN' }).value.state;
    const { value } = run(resigned, AI);
    expect(value.state.result).toMatchObject({
      end: { reason: 'going_out', seat: 0 },
      // Seat 0 adds only the active seat 2's K (5); seat 1 keeps its frozen 50, QZ (18) is out of play.
      adjustments: [5, 0, -5],
      teamScores: [20 + 4 + 5, 50, 30 - 5],
    });
    // Q-GD-5: the retired rack is still public at the end.
    expect(value.events.at(-1)).toMatchObject({ type: 'MATCH_ENDED', finalRacks: ['', 'QZ', 'K'] });
  });
});

describe('Q-GD-3 · R-END-002: resigned seats share the place below every active seat', () => {
  const s = fixture(
    FFA(4),
    [{ score: 300 }, { score: 10 }, { score: 200 }, { score: 5 }].map((x) => ({ ...x, rack: '' })),
    { scorelessTurns: 5 },
  );
  const finish = (order: readonly [number, number]): MatchState => {
    let state = s;
    for (const seat of order) state = run(state, { seat, type: 'RESIGN' }).value.state;
    // Two active seats left (1 and 3): limit 6, the next PASS ends the match.
    return run(state, { seat: state.seatOnTurn, type: 'PASS' }).value.state;
  };

  it('4-seat FFA, two resigned with the top scores: places 1, 2, 3, 3', () => {
    const end = finish([0, 2]);
    expect(end.result).toMatchObject({
      end: { reason: 'scoreless_turns' },
      teamScores: [300, 10, 200, 5],
      places: [3, 1, 3, 2],
      decidedBy: 'score',
    });
  });

  it('the order of departure is not recorded and ranks nobody', () => {
    const a = finish([0, 2]);
    const b = finish([2, 0]);
    expect(b.result).toEqual(a.result);
    expect(b.seats).toEqual(a.seats);
    for (const seat of a.seats) {
      expect(Object.keys(seat).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))).toEqual([
        'bestTurnScore',
        'chainK',
        'lastMainForm',
        'rack',
        'score',
        'status',
      ]);
    }
  });
});

describe('Q-GD-4 · R-END-003: ≥ 3 teams tied after the best turn → the latest earliest-mover wins', () => {
  it('4-way tie with a mandatory winner: firstSeat 1 → seat 0 moves last and wins; the rest share 2', () => {
    const s = fixture(
      FFA(4, 1),
      [0, 1, 2, 3].map(() => ({ rack: '', score: 100, bestTurnScore: 40 })),
      { firstSeat: 1, scorelessTurns: 11 },
    );
    const end = run(s, { seat: 0, type: 'PASS' }).value.state;
    expect(end.result).toMatchObject({
      end: { reason: 'scoreless_turns' },
      teamScores: [100, 100, 100, 100],
      places: [1, 2, 2, 2],
      decidedBy: 'tiebreak_second_mover',
    });
  });

  it('without a mandatory winner the 4-way tie is a draw', () => {
    const s = fixture(
      FFA(4, 0),
      [0, 1, 2, 3].map(() => ({ rack: '', score: 100, bestTurnScore: 40 })),
      { firstSeat: 1, scorelessTurns: 11 },
    );
    const end = run(s, { seat: 0, type: 'PASS' }).value.state;
    expect(end.result).toMatchObject({ places: [1, 1, 1, 1], decidedBy: 'score' });
  });
});
