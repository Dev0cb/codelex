/**
 * Tagged assertions for Phase-1 rules and global properties that the traceability gate (sprint Q4,
 * `tools/traceability/check.mjs`) found without one: R-CORE-002 (a), R-SCORE-007 (a), P-GLOBAL-05, P-GLOBAL-06, and
 * R-MODE-CLASSIC-002 (a)(b)(d). Moves come from the harness's brute-force generator (`test/support/play.ts`) on
 * its synthetic lexicon; the real-lexicon, bot-driven version of the same properties is in `@codelex/bots`
 * (`test/real-lexicon-matches.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/match/apply.js';
import { createMatch } from '../../src/match/create.js';
import { observe } from '../../src/match/observe.js';
import { getLetterTable } from '../../src/rules/constants.js';
import { serializeState, stateHash } from '../../src/state/state.js';
import { replay, newActionLog } from '../../src/replay/log.js';
import type { Action, MatchState } from '../../src/types.js';
import { chooseAction, harnessRng, SIM_CTX, simConfig } from '../support/play.js';

const A = 'A'.charCodeAt(0);

/** Independent conservation counter: board + racks + bag against the letter table (26 letters, then blanks). */
function counts(state: MatchState): number[] {
  const out = new Array<number>(27).fill(0);
  const add = (tiles: string): void => {
    for (const tile of tiles) {
      if (tile === '.') continue;
      const code = tile.charCodeAt(0);
      const slot = code >= A && code < A + 26 ? code - A : 26;
      out[slot] = (out[slot] ?? 0) + 1;
    }
  };
  add(state.bag);
  for (const seat of state.seats) add(seat.rack);
  for (const row of state.board) add(row);
  return out;
}

const TABLE = getLetterTable('letters-v1');
const INITIAL = [...Array.from({ length: 26 }, (_, i) => TABLE.counts[i] ?? 0), TABLE.blanks];

function start(seed: string, seats: number): MatchState {
  const created = createMatch(simConfig(seed, seats), SIM_CTX);
  if (!created.ok) throw new Error(created.error.code);
  return created.value.state;
}

interface Run {
  readonly states: MatchState[];
  readonly actions: Action[];
  readonly scores: number[];
}

function playOut(seed: string, seats: number): Run {
  let state = start(seed, seats);
  const rng = harnessRng(seed);
  const states = [state];
  const actions: Action[] = [];
  const scores: number[] = [];
  for (let guard = 0; state.status === 'in_progress' && guard < 500; guard += 1) {
    const action = chooseAction(state, rng);
    const r = apply(state, action, SIM_CTX);
    if (!r.ok) throw new Error(`legal action rejected: ${r.error.code}`);
    for (const e of r.value.events) if (e.type === 'WORD_PLACED') scores.push(e.breakdown.total);
    state = r.value.state;
    states.push(state);
    actions.push(r.value.action);
  }
  return { states, actions, scores };
}

const SEEDS = ['00000000000000a1', '00000000000000b2', '00000000000000c3', '00000000000000d4'];

describe('P-GLOBAL-05 tile conservation after every accepted action (R-BAG-004)', () => {
  it('P-GLOBAL-05: board + racks + bag equals the letters-v1 bag after every action, 1v1 to 4 seats', () => {
    let checked = 0;
    for (const [i, seed] of SEEDS.entries()) {
      const run = playOut(seed, 2 + (i % 3));
      expect(run.states[run.states.length - 1]?.status).toBe('finished');
      for (const state of run.states) {
        expect(counts(state)).toEqual(INITIAL);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('P-GLOBAL-06 integer, non-negative scores', () => {
  it('P-GLOBAL-06: every turn score is a safe integer >= 0; running scores too until the match ends', () => {
    let turns = 0;
    for (const [i, seed] of SEEDS.entries()) {
      const run = playOut(seed, 2 + (i % 3));
      for (const total of run.scores) {
        expect(Number.isSafeInteger(total) && total >= 0).toBe(true);
        turns += 1;
      }
      for (const state of run.states.filter((s) => s.status === 'in_progress')) {
        expect(state.seats.every((s) => Number.isSafeInteger(s.score) && s.score >= 0)).toBe(true);
      }
    }
    expect(turns).toBeGreaterThan(20);
  });
});

describe('R-SCORE-007 integer scores', () => {
  it('P-SCORE-007-a R-SCORE-007: every breakdown component and every final score is a safe integer', () => {
    let words = 0;
    for (const [i, seed] of SEEDS.entries()) {
      let state = start(seed, 2 + (i % 3));
      const rng = harnessRng(seed);
      for (let guard = 0; state.status === 'in_progress' && guard < 500; guard += 1) {
        const r = apply(state, chooseAction(state, rng), SIM_CTX);
        if (!r.ok) throw new Error(r.error.code);
        for (const e of r.value.events) {
          if (e.type !== 'WORD_PLACED') continue;
          const b = e.breakdown;
          for (const n of [b.total, b.fullStack, b.chain, b.chainKAfter, b.tilesPlaced]) {
            expect(Number.isSafeInteger(n)).toBe(true);
          }
          for (const w of b.words) {
            expect(Number.isSafeInteger(w.total)).toBe(true);
            words += 1;
          }
        }
        state = r.value.state;
      }
      expect(state.seats.every((s) => Number.isSafeInteger(s.score))).toBe(true);
    }
    expect(words).toBeGreaterThan(20);
  });
});

describe('R-CORE-002 server authority', () => {
  it('P-CORE-002-a R-CORE-002: an action carrying a client-supplied score, validity, timer or power is rejected, state unchanged', () => {
    const state = start(SEEDS[0] ?? '', 2);
    const before = serializeState(state);
    const seat = state.seatOnTurn;
    for (const extra of [{ score: 999 }, { valid: true }, { timer: 0 }, { power: 'COMPILE' }]) {
      const r = apply(state, { seat, type: 'PASS', ...extra } as unknown as Action, SIM_CTX);
      expect(r.ok).toBe(false);
      expect(r.ok ? undefined : r.error.code).toBe('malformed');
      expect(serializeState(state)).toBe(before);
    }
    // The same action without the extra field is accepted: the rejection is about the field, nothing else.
    expect(apply(state, { seat, type: 'PASS' }, SIM_CTX).ok).toBe(true);
  });
});

describe('R-MODE-CLASSIC-002 Classic vs bot, untimed', () => {
  const seed = SEEDS[1] ?? '';

  it('P-MODE-CLASSIC-002-a R-MODE-CLASSIC-002: the untimed-vs-bot state has no clock, deadline or timer field', () => {
    const state = start(seed, 2);
    expect(state.config.format).toBe('untimed-vs-bot');
    const keys = Object.keys(state).concat(
      Object.keys(state.config),
      Object.keys(observe(state, 0)),
    );
    expect(keys.filter((k) => /clock|deadline|timer|time|competitive/i.test(k))).toEqual([]);
  });

  it('P-MODE-CLASSIC-002-b R-MODE-CLASSIC-002: USE_POWER is rejected in a Classic vs bot match, state unchanged', () => {
    const state = start(seed, 2);
    const before = serializeState(state);
    const r = apply(
      state,
      { seat: state.seatOnTurn, type: 'USE_POWER', power: 'COMPILE' } as unknown as Action,
      SIM_CTX,
    );
    expect(r.ok).toBe(false);
    expect(serializeState(state)).toBe(before);
  });

  it('P-MODE-CLASSIC-002-d R-MODE-CLASSIC-002: replaying the action log (no bot think delay anywhere) reproduces the hash', () => {
    const run = playOut(seed, 2);
    const final = run.states[run.states.length - 1];
    if (final === undefined) throw new Error('no states');
    const replayed = replay({ ...newActionLog(simConfig(seed, 2)), actions: run.actions }, SIM_CTX);
    expect(replayed.ok).toBe(true);
    expect(replayed.ok ? replayed.value.finalHash : '').toBe(stateHash(final));
  });
});
