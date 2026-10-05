/**
 * `chooseAction` contract: P-BOT-08 (error order), P-BOT-02 (determinism, frozen inputs, hidden information),
 * P-BOT-05 (budgets reported), P-BOT-06 (fallback), BOT-1.
 */
import fc from 'fast-check';
import { apply, getLayout, observe, type MatchState, type Observation } from '@codelex/game-engine';
import { describe, expect, it } from 'vitest';
import { generateFor, observeOnTurn } from '../test/support/generation.js';
import { lexiconOf, realIndex, tinyIndex, TINY_TERMS } from '../test/support/lexicons.js';
import {
  boardWith,
  botRng,
  contextFor,
  craftedObservation,
  deepFreeze,
  positionAfter,
  seedOf,
  spell,
} from '../test/support/match.js';
import { boardView } from './board.js';
import { mainDifficultyRank } from './main-word.js';
import {
  BOT_VERSION,
  chooseAction,
  PERSONALITIES,
  type BotContext,
  type BotPersonalityId,
} from './index.js';

const REAL = realIndex();
const TINY = tinyIndex();
const PERSONALITY_IDS: readonly BotPersonalityId[] = [
  'random-legal',
  'beginner',
  'greedy',
  'strategist',
];

function midGame(seed = 11, actions = 8): MatchState {
  const state = positionAfter(REAL, seedOf(seed), actions, ['beginner', 'greedy']);
  if (state === undefined) throw new Error('fixture match ended early');
  return state;
}

function ctxFor(obs: Observation, personality: BotPersonalityId = 'beginner'): BotContext {
  return contextFor(REAL, personality, botRng(seedOf(11), obs.seatOnTurn, obs.actionCount));
}

describe('P-BOT-08 error order', () => {
  const state = midGame();
  const onTurn = observeOnTurn(state);
  const offTurn = observe(state, 1 - state.seatOnTurn);
  const spectator = observe(state, 'spectator');
  const finished: Observation = { ...onTurn, status: 'finished' };
  const foreign = lexiconOf(TINY_TERMS, 'aaaaaaaaaaaaaaaa');

  const code = (obs: Observation, ctx: Partial<BotContext> = {}): string => {
    const result = chooseAction(obs, { ...ctxFor(onTurn), ...ctx });
    return result.ok ? 'ok' : result.error.code;
  };
  const badBudget = { maxNodes: 0, maxCandidates: 1 };

  it('reports the earliest violated guard', () => {
    const all = { lexicon: foreign, budget: badBudget };
    expect(code({ ...spectator, status: 'finished' }, all)).toBe('NOT_A_SEAT');
    expect(code(finished, all)).toBe('MATCH_OVER');
    expect(code(offTurn, all)).toBe('NOT_ON_TURN');
    expect(code(onTurn, all)).toBe('LEXICON_MISMATCH');
    expect(code(onTurn, { budget: badBudget })).toBe('INVALID_BUDGET');
    expect(code(onTurn)).toBe('ok');
  });

  it('checks every half of the lexicon identity', () => {
    expect(code({ ...onTurn, profileId: 'season-x' })).toBe('LEXICON_MISMATCH');
    expect(code({ ...onTurn, definitionHash: '0000000000000000' })).toBe('LEXICON_MISMATCH');
  });

  it('rejects non-integer, unsafe or < 1 caps', () => {
    for (const budget of [
      { maxNodes: 1.5, maxCandidates: 1 },
      { maxNodes: 1, maxCandidates: 0 },
      { maxNodes: Number.MAX_SAFE_INTEGER + 1, maxCandidates: 1 },
      { maxNodes: Number.NaN, maxCandidates: 1 },
      { maxNodes: 1 } as unknown as BotContext['budget'],
    ]) {
      expect(code(onTurn, { budget })).toBe('INVALID_BUDGET');
    }
    const result = chooseAction(onTurn, { ...ctxFor(onTurn), budget: badBudget });
    expect(result).toMatchObject({ ok: false, error: { kind: 'bot', code: 'INVALID_BUDGET' } });
  });
});

describe('P-BOT-02 determinism', () => {
  it('same observation, context and stream ⇒ deep-equal decision; inputs untouched', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 0, max: 20 }),
        fc.constantFrom(...PERSONALITY_IDS),
        (seed, actions, personality) => {
          const state = positionAfter(REAL, seedOf(seed), actions);
          if (state === undefined) return;
          const obs = deepFreeze(observeOnTurn(state));
          const make = (): BotContext =>
            contextFor(REAL, personality, botRng(seedOf(seed), obs.seatOnTurn, obs.actionCount));
          const first = chooseAction(obs, make());
          const second = chooseAction(obs, make());
          expect(first.ok).toBe(true);
          expect(second).toEqual(first);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('is invariant under hidden-information changes (other rack, bag order)', () => {
    const state = midGame(21, 6);
    const other = 1 - state.seatOnTurn;
    const otherRack = state.seats[other]?.rack ?? '';
    // Swap the opponent's rack with the first tiles of the bag and reverse the rest: same unseen counts.
    const swapped = state.bag.slice(0, otherRack.length);
    const hidden: MatchState = {
      ...state,
      bag: otherRack + Array.from(state.bag.slice(otherRack.length)).reverse().join(''),
      seats: state.seats.map((s, i) =>
        i === other
          ? {
              ...s,
              rack: Array.from(swapped)
                .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
                .join(''),
            }
          : s,
      ),
    };
    const a = observeOnTurn(state);
    const b = observeOnTurn(hidden);
    expect(b).toEqual(a);
    for (const personality of PERSONALITY_IDS) {
      const rng = (): BotContext['rng'] => botRng(seedOf(21), a.seatOnTurn, a.actionCount);
      expect(chooseAction(b, contextFor(REAL, personality, rng()))).toEqual(
        chooseAction(a, contextFor(REAL, personality, rng())),
      );
    }
  });
});

describe('P-BOT-05 budgets', () => {
  it('nodesUsed ≤ maxNodes, candidatesEvaluated ≤ maxCandidates, exhausted ⇔ a cap dropped work', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 0, max: 16 }),
        fc.constantFrom(...PERSONALITY_IDS),
        fc.integer({ min: 1, max: 3_000 }),
        fc.integer({ min: 1, max: 12 }),
        (seed, actions, personality, maxNodes, maxCandidates) => {
          const state = positionAfter(REAL, seedOf(seed), actions);
          if (state === undefined) return;
          const obs = observeOnTurn(state);
          const budget = { maxNodes, maxCandidates };
          const ctx = contextFor(
            REAL,
            personality,
            botRng(seedOf(seed), obs.seatOnTurn, obs.actionCount),
            budget,
          );
          const result = chooseAction(obs, ctx);
          if (!result.ok) throw new Error(result.error.code);
          const d = result.value;
          expect(d.nodesUsed).toBeLessThanOrEqual(maxNodes);
          expect(d.candidatesEvaluated).toBeLessThanOrEqual(maxCandidates);
          expect(apply(state, d.action, { lexicon: REAL }).ok).toBe(true);

          const full = generateFor(obs, REAL);
          const nodeCapHit = full.nodesUsed > maxNodes;
          const candidates = generateFor(obs, REAL, maxNodes).candidates;
          const generated = candidates.length;
          // Strategist shortlists after its vocabulary filter (rank ≤ 2, empty ⇒ unfiltered).
          const view = boardView(obs, getLayout(obs.config.layout), REAL);
          const known = candidates.filter(
            (c) => mainDifficultyRank(view, c.action.tiles, REAL) <= 2,
          );
          const pool = known.length > 0 ? known.length : generated;
          const capDroppedEvaluations =
            personality === 'greedy'
              ? generated > maxCandidates
              : personality === 'strategist'
                ? pool > maxCandidates
                : personality === 'random-legal'
                  ? d.action.type !== 'PLACE_WORD' && generated > 0
                  : false;
          expect(d.budgetExhausted).toBe(nodeCapHit || capDroppedEvaluations);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('reports the default budgets and BOT_VERSION (2: bots-api §5.6, §6.1)', () => {
    expect(BOT_VERSION).toBe(2);
    expect(PERSONALITIES.beginner.budget).toEqual({ maxNodes: 70_000, maxCandidates: 300 });
    expect(PERSONALITIES.strategist.budget).toEqual({ maxNodes: 70_000, maxCandidates: 500 });
    expect(PERSONALITIES['random-legal'].budget).toEqual({ maxNodes: 200_000, maxCandidates: 8 });
    expect(PERSONALITIES.greedy.budget).toEqual({ maxNodes: 400_000, maxCandidates: 2_000 });
    for (const data of Object.values(PERSONALITIES)) {
      const numbers = [
        data.budget.maxNodes,
        data.budget.maxCandidates,
        data.maxDifficultyRank,
        data.sampleWhenOver,
        data.shortLength,
        data.shortMultiplier,
        data.skipFullStackPermille,
        ...data.topWeights,
        ...(data.strategy === null
          ? []
          : Object.values(data.strategy).flatMap((v: number | readonly number[]) =>
              typeof v === 'number' ? [Math.abs(v)] : v,
            )),
      ];
      expect(numbers.every((n) => Number.isSafeInteger(n) && n >= 0)).toBe(true);
      expect(Object.isFrozen(data)).toBe(true);
    }
  });
});

describe('P-BOT-06 fallback', () => {
  // No tiny-lexicon word uses a Q, V, W, X, Y or Z: with one blank at most, nothing is playable here.
  const dead = boardWith(spell('QQQQQQQQQQQQQQQ', 0, 7, 'col'));
  const plain = tinyIndex(false);

  it('exchanges the rack minus blanks when no word exists and the bag holds ≥ 7', () => {
    for (const personality of PERSONALITY_IDS) {
      const obs = craftedObservation(TINY, dead, 'QXZ?VWY', 7);
      const result = chooseAction(obs, contextFor(TINY, personality, botRng(seedOf(1), 0, 0)));
      expect(result).toEqual({
        ok: true,
        value: {
          action: { seat: 0, type: 'EXCHANGE', tiles: ['Q', 'V', 'W', 'X', 'Y', 'Z'] },
          nodesUsed: expect.any(Number) as number,
          candidatesEvaluated: 0,
          budgetExhausted: false,
        },
      });
    }
  });

  it('exchanges an all-blank rack whole, passes when the bag holds < 7 or the rack is empty', () => {
    const ctx = contextFor(plain, 'beginner', botRng(seedOf(1), 0, 0));
    const noWord = craftedObservation(TINY, dead, '??', 7);
    expect(chooseAction(noWord, ctx)).toMatchObject({
      ok: true,
      value: { action: { type: 'EXCHANGE', tiles: ['?', '?'] } },
    });
    expect(chooseAction({ ...noWord, bagCount: 6 }, ctx)).toMatchObject({
      ok: true,
      value: { action: { seat: 0, type: 'PASS' } },
    });
    expect(chooseAction({ ...noWord, rack: '' }, ctx)).toMatchObject({
      ok: true,
      value: { action: { type: 'PASS' } },
    });
  });

  it('never resigns; without a GADDAG the DAWG fallback decides like the GADDAG path (BOT-8)', () => {
    const plain = realIndex({ gaddag: false });
    const kinds = new Set<string>();
    for (const [seed, actions] of [
      [31, 4],
      [32, 6],
    ] as const) {
      const state = midGame(seed, actions);
      const obs = observeOnTurn(state);
      for (const personality of PERSONALITY_IDS) {
        const decide = (lexicon: typeof REAL) => {
          const rng = botRng(seedOf(seed), obs.seatOnTurn, obs.actionCount);
          const result = chooseAction(obs, contextFor(lexicon, personality, rng));
          if (!result.ok) throw new Error(result.error.code);
          return result.value;
        };
        const viaDawg = decide(plain);
        const viaGaddag = decide(REAL);
        // Node counts differ by automaton (BOT-3); the decision does not (P-BOT-03).
        expect(viaDawg.action).toEqual(viaGaddag.action);
        expect(viaDawg.candidatesEvaluated).toBe(viaGaddag.candidatesEvaluated);
        expect(viaDawg.action.type).not.toBe('RESIGN');
        expect(apply(state, viaDawg.action, { lexicon: REAL }).ok).toBe(true);
        kinds.add(viaDawg.action.type);
      }
    }
    expect(kinds).toContain('PLACE_WORD');
  });
});
