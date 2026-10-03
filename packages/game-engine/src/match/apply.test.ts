import { describe, expect, it } from 'vitest';
import type { SMALL_VERSION } from '../../test/support/small-lexicon.js';
import { CTX, config1v1, smallLexicon } from '../../test/support/small-lexicon.js';
import type { Action, MatchConfig, MatchState, SeatState } from '../types.js';
import { apply } from './apply.js';
import { createMatch } from './create.js';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

function created(config: MatchConfig = config1v1()): MatchState {
  const r = createMatch(config, CTX);
  if (!r.ok) throw new Error(r.error.code);
  return r.value.state;
}

/** A frozen fixture state: seat 0 on turn, chosen racks and bag (hand-built, P-GLOBAL-01 via freezing). */
function fixture(
  seats: readonly Partial<SeatState>[],
  overrides: Partial<MatchState> = {},
  config: MatchConfig = config1v1(),
): MatchState {
  const base = created(config);
  return deepFreeze({
    ...base,
    seatOnTurn: 0,
    seats: base.seats.map((s, i) => ({ ...s, ...(seats[i] ?? {}) })),
    ...overrides,
  });
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
    { row: 7, col: 8, tile: 'I' },
    { row: 7, col: 7, tile: 'A' },
  ],
};
const FFA3: MatchConfig = {
  ...config1v1(),
  config: { ...config1v1().config, format: 'untimed', seats: 3, teams: [[0], [1], [2]] },
};

describe('apply PLACE_WORD (R-TURN-002/003/006, R-SCORE-*, R-BAG-003)', () => {
  it('places, scores, refills from the head of the bag and passes the turn', () => {
    const s = fixture([{ rack: 'AEIMNST', chainK: 2, lastMainForm: 'TCP' }, {}], {
      bag: 'XYZQRSTUV',
    });
    const { value } = run(s, AI);
    const next = value.state;
    expect(value.action).toEqual({
      seat: 0,
      type: 'PLACE_WORD',
      tiles: [
        { row: 7, col: 7, tile: 'A' },
        { row: 7, col: 8, tile: 'I' },
      ],
    });
    expect(next.board[7]).toBe('.......AI......');
    expect(next.board[0]).toBe(s.board[0]);
    expect(next.seats[0]).toEqual({
      rack: 'EMNSTXY',
      score: 4, // (A1 + I1) × start DW
      chainK: 0,
      lastMainForm: 'AI',
      bestTurnScore: 4,
      status: 'active',
    });
    expect(next.seats[1]).toBe(s.seats[1]);
    expect(next.bag).toBe('ZQRSTUV');
    expect([next.turnNumber, next.actionCount, next.scorelessTurns, next.seatOnTurn]).toEqual([
      1, 1, 0, 1,
    ]);
    expect(value.events.map((e) => e.type)).toEqual(['WORD_PLACED', 'TILES_DRAWN', 'TURN_STARTED']);
    expect(value.events[1]).toEqual({
      type: 'TILES_DRAWN',
      seat: 0,
      cause: 'refill',
      count: 2,
      tiles: 'XY',
      bagCount: 7,
    });
    expect(value.events[2]).toEqual({ type: 'TURN_STARTED', seat: 1, turnNumber: 1 });
  });

  it('GC-TURN-04: an all-blank zero-point word is accepted and resets the scoreless counter', () => {
    const s = fixture([{ rack: '??BCDFG' }], { scorelessTurns: 4 });
    const blanks: Action = {
      seat: 0,
      type: 'PLACE_WORD',
      tiles: [
        { row: 7, col: 7, tile: 'a' },
        { row: 7, col: 8, tile: 'i' },
      ],
    };
    const next = run(s, blanks).value.state;
    expect(next.seats[0]?.score).toBe(0);
    expect(next.scorelessTurns).toBe(0);
    expect(next.board[7]).toBe('.......ai......');
  });

  it('R-END-001: emptying the rack with an empty bag ends the match (no draw, no next turn)', () => {
    const s = fixture(
      [
        { rack: 'AI', score: 50 },
        { rack: 'EQZ', score: 40 },
      ],
      { bag: '' },
    );
    const { value } = run(s, AI);
    expect(value.events.map((e) => e.type)).toEqual(['WORD_PLACED', 'MATCH_ENDED']);
    const next = value.state;
    expect(next.status).toBe('finished');
    expect(next.seatOnTurn).toBe(0);
    expect(next.result).toEqual({
      end: { reason: 'going_out', seat: 0 },
      adjustments: [19, -19],
      teamScores: [73, 21],
      places: [1, 2],
      decidedBy: 'score',
    });
    expect(value.events[1]).toMatchObject({ finalRacks: ['', 'EQZ'] });
  });

  it('P-END-001-b: an empty bag with a non-empty rack does not end the match', () => {
    const s = fixture([{ rack: 'AIZ' }], { bag: '' });
    expect(run(s, AI).value.state.status).toBe('in_progress');
  });
});

describe('apply EXCHANGE and PASS (R-BAG-005, R-TURN-004)', () => {
  it('exchange: same rack size, bag reshuffled with the persisted stream, scoreless +1', () => {
    const s = fixture([{ rack: 'AEIMNST' }], { scorelessTurns: 1 });
    const { value } = run(s, { seat: 0, type: 'EXCHANGE', tiles: ['M', 'A'] });
    const next = value.state;
    expect(next.seats[0]?.rack).toHaveLength(7);
    expect(next.bag).toHaveLength(s.bag.length);
    expect(next.rng.bag).not.toEqual(s.rng.bag);
    expect(next.scorelessTurns).toBe(2);
    expect(value.events.map((e) => e.type)).toEqual([
      'TILES_EXCHANGED',
      'TILES_DRAWN',
      'TURN_STARTED',
    ]);
    expect(value.events[0]).toEqual({ type: 'TILES_EXCHANGED', seat: 0, count: 2, returned: 'AM' });
    expect(value.events[1]).toMatchObject({ cause: 'exchange', count: 2, bagCount: s.bag.length });
  });

  it('GC-TURN-05 / GC-END-02: the 6th consecutive scoreless turn ends the match; nobody adds', () => {
    let s = fixture(
      [
        { rack: 'AB', score: 150 },
        { rack: 'X', score: 154 },
      ],
      { scorelessTurns: 5 },
    );
    s = run(s, { seat: 0, type: 'PASS' }).value.state;
    expect(s.status).toBe('finished');
    expect(s.result).toMatchObject({
      end: { reason: 'scoreless_turns' },
      adjustments: [-4, -8],
      teamScores: [146, 146],
      places: [1, 1],
    });
  });

  it('PASSED carries the counter; 5 scoreless turns do not end a 1v1', () => {
    const s = fixture([], { scorelessTurns: 4 });
    const { value } = run(s, { seat: 0, type: 'PASS' });
    expect(value.events[0]).toEqual({ type: 'PASSED', seat: 0, scorelessTurns: 5 });
    expect(value.state.status).toBe('in_progress');
  });
});

describe('apply RESIGN (R-END-002)', () => {
  it('GC-TURN-01 / GC-END-04: out-of-turn resign ends a 1v1, no adjustment, seat on turn unchanged', () => {
    const s = fixture([{ score: 120 }, { score: 80 }]);
    const { value } = run(s, { seat: 1, type: 'RESIGN' });
    expect(value.events.map((e) => e.type)).toEqual(['RESIGNED', 'MATCH_ENDED']);
    expect(value.state).toMatchObject({
      status: 'finished',
      seatOnTurn: 0,
      turnNumber: 0,
      actionCount: 1,
    });
    expect(value.state.result).toMatchObject({
      places: [1, 2],
      decidedBy: 'resign',
      adjustments: [0, 0],
    });
  });

  it('FFA: the match continues, the resigned seat is skipped and its rack retired (P-END-002-b)', () => {
    const s = fixture([], {}, FFA3);
    const r1 = run(s, { seat: 0, type: 'RESIGN' }).value;
    expect(r1.events.map((e) => e.type)).toEqual(['RESIGNED', 'TURN_STARTED']);
    expect(r1.state.seatOnTurn).toBe(1);
    expect(r1.state.seats[0]?.rack).toBe(s.seats[0]?.rack);
    const r2 = run(r1.state, { seat: 1, type: 'PASS' }).value;
    const r3 = run(r2.state, { seat: 2, type: 'PASS' }).value;
    expect(r3.state.seatOnTurn).toBe(1);
    // Out-of-turn resign by an FFA seat: no TURN_STARTED.
    const r4 = run(fixture([], {}, FFA3), { seat: 2, type: 'RESIGN' }).value;
    expect(r4.events.map((e) => e.type)).toEqual(['RESIGNED']);
  });

  it('R-TURN-004 (Q-GD-1): after a resignation the scoreless limit is 3 × active seats', () => {
    let s = run(fixture([], {}, FFA3), { seat: 0, type: 'RESIGN' }).value.state;
    for (let i = 0; i < 5; i += 1) s = run(s, { seat: s.seatOnTurn, type: 'PASS' }).value.state;
    expect(s.status).toBe('in_progress');
    s = run(s, { seat: s.seatOnTurn, type: 'PASS' }).value.state;
    expect(s.result?.end).toEqual({ reason: 'scoreless_turns' });
  });

  it('FFA: the last resignation that leaves one seat ends the match', () => {
    let s = run(fixture([], {}, FFA3), { seat: 0, type: 'RESIGN' }).value.state;
    s = run(s, { seat: 2, type: 'RESIGN' }).value.state;
    expect(s.result).toMatchObject({ end: { reason: 'resign', seat: 2 }, places: [2, 1, 2] });
  });
});

describe('apply failures (P-GLOBAL-03, P-GLOBAL-08, R-TURN-005, P-API-09)', () => {
  it('GC-SCORE-04: a rejected attempt is invisible; the next accepted move equals a direct one', () => {
    const s = fixture([{ rack: 'AIMPRST' }], {
      board: created().board.map((row, r) => (r === 7 ? '......AI.......' : row)),
    });
    const aim = apply(
      s,
      { seat: 0, type: 'PLACE_WORD', tiles: [{ row: 7, col: 8, tile: 'M' }] },
      CTX,
    );
    expect(aim.ok ? undefined : aim.error).toMatchObject({
      code: 'not_in_lexicon',
      details: { words: [{ form: 'AIM', main: true }] },
    });
    const ip: Action = { seat: 0, type: 'PLACE_WORD', tiles: [{ row: 8, col: 7, tile: 'P' }] };
    const direct = run(s, ip).value;
    expect(direct.state.seats[0]?.score).toBe(3);
    expect(run(s, ip).value).toEqual(direct);
  });

  it('P-GLOBAL-08: a finished match rejects every action with match_over', () => {
    const s = run(fixture([]), { seat: 1, type: 'RESIGN' }).value.state;
    for (const action of [
      { seat: 0, type: 'PASS' },
      { seat: 0, type: 'RESIGN' },
    ] as const) {
      const r = apply(s, action, CTX);
      expect(r.ok ? undefined : r.error.code).toBe('match_over');
    }
  });

  it('P-API-09: LEXICON_MISMATCH with a foreign index; state unchanged', () => {
    const foreign = { lexicon: smallLexicon('dddddddddddddddd' as typeof SMALL_VERSION) };
    const r = apply(fixture([]), { seat: 0, type: 'PASS' }, foreign);
    expect(r.ok ? undefined : r.error).toMatchObject({ kind: 'engine', code: 'LEXICON_MISMATCH' });
  });

  it('P-GLOBAL-01: equal inputs give deep-equal outputs', () => {
    const s = fixture([{ rack: 'AEIMNST' }]);
    expect(run(s, AI).value).toEqual(run(s, AI).value);
  });
});
