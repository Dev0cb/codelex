/**
 * Strategist on crafted positions (docs/specs/E-1.3-bots/strategist.md S-1..S-5): leave (AC-4), voluntary exchange
 * X-1..X-5 and the forced keep (AC-5, P-BOT-06 Strategist reading, P-BOT-09), lane blocking (AC-6), chain
 * preference (AC-7), overflow shortlist, the single weighted draw (S-3), and the ST-2 ablation.
 */
import fc from 'fast-check';
import { getLayout, type Observation } from '@codelex/game-engine';
import type { LexiconIndex } from '@codelex/lexicon/index';
import { describe, expect, it } from 'vitest';
import { generateFor, observeOnTurn } from '../../test/support/generation.js';
import { lexiconOf, realIndex, term } from '../../test/support/lexicons.js';
import {
  boardWith,
  botRng,
  contextFor,
  craftedObservation,
  positionAfter,
  scriptedRng,
  seedOf,
} from '../../test/support/match.js';
import { boardView } from '../board.js';
import { decide, type DecideOptions } from '../choose.js';
import { actionKey } from '../key.js';
import { PERSONALITIES, STRATEGIST_STRATEGY } from '../personalities.js';
import type { PersonalityData, StrategyData } from '../types.js';
import { leadOf, rankStrategist, strategistFallback, type Scored } from './strategist.js';
import type { PolicyInput } from './types.js';
import type { Rng } from '@codelex/game-engine/rng';

const DATA = PERSONALITIES.strategist;

function withStrategy(
  patch: Partial<StrategyData>,
  top: readonly number[] = DATA.topWeights,
): PersonalityData {
  return { ...DATA, topWeights: top, strategy: { ...STRATEGIST_STRATEGY, ...patch } };
}

function run(
  obs: Observation,
  lexicon: LexiconIndex,
  rng: Rng = scriptedRng([0]),
  options: DecideOptions = {},
  budget = DATA.budget,
): {
  readonly action: string;
  readonly voluntary: boolean;
  readonly draws: number;
  readonly exhausted: boolean;
  readonly evaluated: number;
} {
  const result = decide(obs, contextFor(lexicon, 'strategist', rng, budget), options);
  if (!result.ok) throw new Error(result.error.code);
  const { action, budgetExhausted, candidatesEvaluated } = result.value.decision;
  if (action.type === 'RESIGN') throw new Error('never resigns');
  return {
    action: actionKey(action),
    voluntary: result.value.voluntaryExchange,
    draws: 'calls' in rng && Array.isArray(rng.calls) ? rng.calls.length : -1,
    exhausted: budgetExhausted,
    evaluated: candidatesEvaluated,
  };
}

function ranking(obs: Observation, lexicon: LexiconIndex, ablated = false): Scored[] {
  const input: PolicyInput = {
    obs,
    lexicon,
    rng: scriptedRng([]),
    budget: DATA.budget,
    data: DATA,
    view: boardView(obs, getLayout(obs.config.layout), lexicon),
    candidates: generateFor(obs, lexicon).candidates,
  };
  return rankStrategist(input, input.candidates, STRATEGIST_STRATEGY, { ablated });
}

const keyOf = (s: Scored): string => s.key;

describe('S-4 voluntary exchange (AC-5, GD-3 worked example)', () => {
  // Only ERA exists: every candidate spends the blank, E and R and leaves KUVW (raw −100); best total 4.
  const ERA = lexiconOf([term('ERA')]);
  const obs = craftedObservation(ERA, boardWith([]), '?EKRUVW', 50);

  it('exchanges KUVW and keeps the blank when X-1..X-5 hold, without any random draw', () => {
    const r = run(obs, ERA);
    expect(r).toMatchObject({ action: 'XKUVW', voluntary: true, draws: 0 });
  });

  it('plays a word as soon as one condition fails, at its exact boundary', () => {
    const word = (o: Observation, data?: PersonalityData): ReturnType<typeof run> =>
      run(o, ERA, scriptedRng([0]), data === undefined ? {} : { data });
    // X-1 bag ≥ 7.
    expect(word({ ...obs, bagCount: 7 }).action).toBe('XKUVW');
    expect(word({ ...obs, bagCount: 6 })).toMatchObject({ voluntary: false, draws: 1 });
    // X-2 scorelessTurns ≤ 2 (P-BOT-09: never with ≥ 3).
    expect(word({ ...obs, scorelessTurns: 2 }).action).toBe('XKUVW');
    expect(word({ ...obs, scorelessTurns: 3 }).voluntary).toBe(false);
    // X-3 best total (4) ≤ exchangeMaxScore.
    expect(word(obs, withStrategy({ exchangeMaxScore: 4 })).action).toBe('XKUVW');
    expect(word(obs, withStrategy({ exchangeMaxScore: 3 })).voluntary).toBe(false);
    // X-4 raw(leave) (−100) ≤ exchangePoorLeaveDp.
    expect(word(obs, withStrategy({ exchangePoorLeaveDp: -100 })).action).toBe('XKUVW');
    expect(word(obs, withStrategy({ exchangePoorLeaveDp: -101 })).voluntary).toBe(false);
    // X-5 raw(K*) − raw(leave) = 170 + 100 = 270 ≥ exchangeGainDp.
    expect(word(obs, withStrategy({ exchangeGainDp: 270 })).action).toBe('XKUVW');
    expect(word(obs, withStrategy({ exchangeGainDp: 271 })).voluntary).toBe(false);
    expect(word({ ...obs, bagCount: 6 }).action).toMatch(/^P/);
  });

  it('the ablated Strategist (ST-2) never exchanges voluntarily and ranks by 10 · total only', () => {
    expect(run(obs, ERA, scriptedRng([0]), { ablated: true })).toMatchObject({
      voluntary: false,
      draws: 1,
    });
    for (const s of ranking(obs, ERA, true)) {
      expect([s.l, s.c, s.d]).toEqual([0, 0, 0]);
      expect(s.u).toBe(10 * s.total);
    }
  });
});

describe('forced exchange keeps K* (P-BOT-06, Strategist reading)', () => {
  const NONE = lexiconOf([term('QQQQQQQQ')]);
  const obs = craftedObservation(NONE, boardWith([]), '?EKRUVW', 7);

  it('no word and bag ≥ 7 ⇒ EXCHANGE of rack − K* (≥ 1 tile); bag < 7 or empty rack ⇒ PASS; never RESIGN', () => {
    expect(run(obs, NONE)).toMatchObject({
      action: 'XKUVW',
      voluntary: false,
      draws: 0,
      evaluated: 0,
    });
    expect(run({ ...obs, bagCount: 6 }, NONE).action).toBe('S');
    expect(run({ ...obs, rack: '' }, NONE).action).toBe('S');
    expect(run({ ...obs, rack: 'S' }, NONE).action).toBe('XS');
    expect(strategistFallback({ ...obs, rack: '??' }, 0, STRATEGIST_STRATEGY)).toEqual({
      seat: 0,
      type: 'EXCHANGE',
      tiles: ['?'],
    });
  });
});

describe('S-2 leave term L (AC-4)', () => {
  const LEX = lexiconOf([term('AS'), term('AT')]);

  it('with equal totals, the better leave ranks first (AT keeps the S)', () => {
    // scorelessTurns 3 rules out a voluntary exchange (X-2): this test is about the ranking.
    const obs = craftedObservation(LEX, boardWith([]), 'ASTQQXZ', 50, { scorelessTurns: 3 });
    const ranked = ranking(obs, LEX);
    const best = ranked[0];
    expect(best?.key).toMatch(/T/);
    const worst = ranked[ranked.length - 1];
    expect(worst?.key).toMatch(/S/);
    expect(best?.total).toBe(worst?.total);
    expect((best?.l ?? 0) - (worst?.l ?? 0)).toBe(30);
    expect(run(obs, LEX, scriptedRng([0]), { data: withStrategy({}, [1]) }).action).toMatch(/T/);
  });

  it('weights the leave 400 ‰ with 1–6 tiles in the bag', () => {
    const obs = craftedObservation(LEX, boardWith([]), 'ASTQQXZ', 3);
    for (const s of ranking(obs, LEX)) expect(s.l).toBe(Math.floor((s.leaveRaw * 400) / 1000));
  });

  it('bag empty: −20 dp per point left on the rack, or +20 dp per unseen point when going out', () => {
    const unseen = new Array<number>(27).fill(0);
    unseen[25] = 1; // Z, 10 points
    unseen[0] = 2; // A A, 2 points
    const out = craftedObservation(LEX, boardWith([]), 'AT', 0, { unseen });
    const [goesOut] = ranking(out, LEX);
    expect(goesOut?.l).toBe(20 * 12);
    expect(goesOut?.c).toBe(0); // no chain term with the bag empty
    const stuck = craftedObservation(LEX, boardWith([]), 'ATZ', 0, { unseen });
    for (const s of ranking(stuck, LEX)) expect(s.l).toBe(-20 * 10);
  });
});

describe('S-2 lane blocking D (AC-6)', () => {
  // A at (3, 5). TA across puts T on (3, 4): TW (3, 0) and DW (1, 4) become hot (+80). AT across: nothing.
  // AT down (T on (4, 5)) and TA down (T on (2, 5)) each make a DW hot (+20). All totals are 2.
  const LEX = lexiconOf([term('AT'), term('TA')]);
  const board = boardWith([[3, 5, 'A']]);
  const at = (teamScores: readonly number[], bag = 50): Observation =>
    craftedObservation(LEX, board, 'TQQXXZZ', bag, { teamScores, scorelessTurns: 3 });
  const dOf = (obs: Observation): Record<string, number> =>
    Object.fromEntries(ranking(obs, LEX).map((s) => [keyOf(s), s.d]));

  it('leading by ≥ 30: the move that keeps the TW lane closed ranks first; opening it costs 1500 ‰', () => {
    const ranked = ranking(at([30, 0]), LEX);
    expect(ranked.map((s) => s.total)).toEqual([2, 2, 2, 2]);
    expect(ranked[0]?.key).toBe('P0306T');
    expect(dOf(at([30, 0]))).toEqual({ P0306T: 0, P0405T: -30, P0205T: -30, P0304T: -120 });
    expect(run(at([30, 0]), LEX, scriptedRng([0])).action).toBe('P0306T');
  });

  it('even: 1000 ‰; trailing by ≥ 50: 400 ‰; bag empty: even whatever the score', () => {
    expect(dOf(at([29, 0]))['P0304T']).toBe(-80);
    expect(dOf(at([0, 50]))['P0304T']).toBe(-32);
    expect(dOf(at([0, 49]))['P0304T']).toBe(-80);
    expect(dOf(at([100, 0], 0))['P0304T']).toBe(-80);
  });

  it('lead = own team − best other team', () => {
    expect(leadOf(at([10, 40]))).toBe(-30);
    expect(leadOf({ ...at([10, 40]), viewer: 1, seatOnTurn: 1 })).toBe(30);
  });
});

describe('S-2 chain preference C (AC-7)', () => {
  const LEX = lexiconOf([
    { ...term('DNS'), relations: [{ type: 'part_of', target: 'at' }] },
    term('AT'),
    term('TA'),
  ]);
  const base = craftedObservation(LEX, boardWith([]), 'ATQQXXZ', 50);
  const obs: Observation = {
    ...base,
    seats: base.seats.map((s, i) => (i === 0 ? { ...s, lastMainForm: 'DNS', chainK: 0 } : s)),
  };

  it('values keeping the chain (25 dp per k) and the main term degree (3 dp each, cap 8)', () => {
    const ranked = ranking(obs, LEX);
    for (const s of ranked) {
      if (s.chainKAfter > 0) expect(s.c).toBe(25 * s.chainKAfter + 3 * 1);
      else expect(s.c).toBe(0);
    }
    // Every AT placement links (chain points in the total and in C) and ranks above every TA placement.
    const firstTa = ranked.findIndex((s) => s.chainKAfter === 0);
    expect(firstTa).toBeGreaterThan(0);
    expect(ranked.slice(0, firstTa).every((s) => s.chainKAfter === 1)).toBe(true);
  });

  it('caps the degree term at chainDegreeCap neighbours', () => {
    const others = Array.from('BCDEFGHIJK', (l) => term(`Q${l}`));
    const hub = lexiconOf([
      { ...term('AT'), relations: others.map((o) => ({ type: 'part_of', target: o.id })) },
      ...others,
    ]);
    const plain = craftedObservation(hub, boardWith([]), 'ATQQXXZ', 50);
    for (const s of ranking(plain, hub)) expect(s.c).toBe(3 * 8);
  });
});

describe('S-1 overflow shortlist and S-3 draw', () => {
  const REAL = realIndex();

  it('over maxCandidates keeps the highest attention keys (no random draw) and reports exhaustion', () => {
    const state = positionAfter(REAL, seedOf(41), 6, ['strategist', 'beginner']);
    if (state === undefined) throw new Error('fixture ended early');
    const obs = observeOnTurn(state);
    const rng = scriptedRng([0]);
    const r = run(obs, REAL, rng, {}, { maxNodes: 70_000, maxCandidates: 2 });
    expect(r.evaluated).toBe(2);
    expect(r.exhausted).toBe(true);
    expect(r.draws).toBeLessThanOrEqual(1);
  });

  it('maps each draw to its rank with topWeights [10, 6, 3, 1] (one draw per word decision)', () => {
    const LEX = lexiconOf([term('AT'), term('TA')]);
    const obs = craftedObservation(LEX, boardWith([[3, 5, 'A']]), 'TQQXXZZ', 50, {
      teamScores: [30, 0],
      scorelessTurns: 3,
    });
    const order = ranking(obs, LEX).map(keyOf);
    const picks: string[] = [];
    for (const draw of [0, 9, 10, 15, 16, 18, 19]) {
      const rng = scriptedRng([draw]);
      const r = run(obs, LEX, rng);
      expect(rng.calls).toEqual([[0, 20]]);
      picks.push(r.action);
    }
    expect(picks).toEqual([order[0], order[0], order[1], order[1], order[2], order[2], order[3]]);
  });

  it('a data set without weights plays the best-U move', () => {
    const LEX = lexiconOf([term('AT'), term('TA')]);
    const obs = craftedObservation(LEX, boardWith([[3, 5, 'A']]), 'TQQXXZZ', 50, {
      teamScores: [30, 0],
      scorelessTurns: 3,
    });
    expect(run(obs, LEX, scriptedRng([]), { data: withStrategy({}, []) }).action).toBe('P0306T');
  });
});

describe('P-BOT-09 no voluntary exchange past the scoreless guard or below the exchange threshold', () => {
  const REAL = realIndex();

  it('holds on seeded real positions with scorelessTurns and bagCount forced', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 3, max: 5 }),
        fc.integer({ min: 0, max: 6 }),
        (seed, actions, scoreless, smallBag) => {
          const state = positionAfter(REAL, seedOf(seed), actions, ['strategist', 'strategist']);
          if (state === undefined) return;
          const obs = observeOnTurn(state);
          const rng = (): ReturnType<typeof botRng> =>
            botRng(seedOf(seed), obs.seatOnTurn, obs.actionCount);
          expect(run({ ...obs, scorelessTurns: scoreless }, REAL, rng()).voluntary).toBe(false);
          expect(run({ ...obs, bagCount: smallBag }, REAL, rng()).voluntary).toBe(false);
        },
      ),
      { numRuns: 25 },
    );
  });
});
