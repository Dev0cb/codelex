/**
 * Personality policies on crafted positions (bots-api §5.2, §5.3): Beginner's vocabulary filter, top-5 weighting
 * with the short-word multiplier, missed Full Stack, attention sampling; greedy; random-legal's uniform pick and
 * redraw on an engine rejection.
 */
import { evaluateMove, type Observation, type PlaceWordAction } from '@codelex/game-engine';
import type { LexiconIndex } from '@codelex/lexicon/index';
import { describe, expect, it } from 'vitest';
import { buildGaddag, formsOf } from '../../test/support/gaddag.js';
import { generateFor } from '../../test/support/generation.js';
import { lexiconOf, term, tinyIndex } from '../../test/support/lexicons.js';
import {
  boardWith,
  botRng,
  contextFor,
  craftedObservation,
  scriptedRng,
  seedOf,
  spell,
} from '../../test/support/match.js';
import { chooseAction, PERSONALITIES, type BotDecision, type BotPersonalityId } from '../index.js';
import { actionKey, compareKeys } from '../key.js';

const TINY = tinyIndex();
const RANK: Readonly<Record<string, number>> = {
  novice: 0,
  intermediate: 1,
  advanced: 2,
  expert: 3,
};

function decide(
  obs: Observation,
  lexicon: LexiconIndex,
  personality: BotPersonalityId,
  rng: ReturnType<typeof scriptedRng> | ReturnType<typeof botRng>,
  budget = PERSONALITIES[personality].budget,
): BotDecision {
  const result = chooseAction(obs, contextFor(lexicon, personality, rng, budget));
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

interface Scored {
  readonly key: string;
  readonly total: number;
  readonly mainLength: number;
  readonly rank: number;
  readonly tiles: number;
}

/** Independent ranking: every generated candidate through evaluateMove, total desc then key. */
function rankAll(obs: Observation, lexicon: LexiconIndex): Scored[] {
  const scored: Scored[] = [];
  for (const c of generateFor(obs, lexicon).candidates) {
    const r = evaluateMove(obs, c.action, { lexicon });
    if (!r.ok) continue;
    const main = r.value.breakdown.words[0];
    scored.push({
      key: c.key,
      total: r.value.breakdown.total,
      mainLength: main?.form.length ?? 0,
      rank: RANK[main?.difficulty ?? 'expert'] ?? 3,
      tiles: r.value.breakdown.tilesPlaced,
    });
  }
  return scored.sort((a, b) => b.total - a.total || compareKeys(a.key, b.key));
}

describe('beginner vocabulary filter (§5.3 step 1)', () => {
  it('keeps novice/intermediate main words when one exists', () => {
    const obs = craftedObservation(TINY, boardWith([]), 'NOTESAI');
    const all = rankAll(obs, TINY);
    expect(all[0]?.rank).toBe(3); // NOTES (expert) is the best move
    for (let i = 0; i < 200; i += 1) {
      const d = decide(obs, TINY, 'beginner', botRng(seedOf(i), 0, 0));
      const chosen = all.find((s) => s.key === actionKey(d.action as PlaceWordAction));
      expect(chosen?.rank).toBeLessThanOrEqual(1);
    }
  });

  it('falls back to the unfiltered set when no candidate qualifies', () => {
    const obs = craftedObservation(TINY, boardWith([]), 'PODQQXZ');
    const d = decide(obs, TINY, 'beginner', botRng(seedOf(1), 0, 0));
    expect(d.action.type).toBe('PLACE_WORD');
    expect(rankAll(obs, TINY).every((s) => s.rank === 2)).toBe(true);
  });
});

describe('beginner top-5 weighting (§5.3 step 5)', () => {
  // Mid-board position with many novice/intermediate options of different lengths.
  const board = boardWith([...spell('NODE', 7, 5), ...spell('CODE', 5, 8, 'col')]);
  const obs = craftedObservation(TINY, board, 'AITPSOD');
  const top = rankAll(obs, TINY)
    .filter((s) => s.rank <= 1)
    .slice(0, 5);

  it('the crafted position has five ranked candidates and no Full Stack', () => {
    expect(top).toHaveLength(5);
    expect(top[0]?.tiles).toBeLessThan(7);
  });

  it('maps every pick draw to the rank its weight interval covers', () => {
    const weights = top.map((s, i) => [8, 5, 3, 2, 1][i]! * (s.mainLength <= 5 ? 2 : 1));
    const sum = weights.reduce((a, b) => a + b, 0);
    const counts = new Array<number>(5).fill(0);
    for (let draw = 0; draw < sum; draw += 1) {
      const rng = scriptedRng([draw]);
      const d = decide(obs, TINY, 'beginner', rng);
      expect(rng.calls).toEqual([[0, sum]]); // no sampling, no Full Stack draw: one pick draw
      const i = top.findIndex((s) => s.key === actionKey(d.action as PlaceWordAction));
      counts[i] = (counts[i] ?? 0) + 1;
    }
    expect(counts).toEqual(weights);
  });

  it('over real streams, the best move is picked about as often as its weight says', () => {
    const weights = top.map((s, i) => [8, 5, 3, 2, 1][i]! * (s.mainLength <= 5 ? 2 : 1));
    const sum = weights.reduce((a, b) => a + b, 0);
    const n = 2_000;
    let best = 0;
    for (let i = 0; i < n; i += 1) {
      const d = decide(obs, TINY, 'beginner', botRng(seedOf(i), 0, 0));
      if (actionKey(d.action as PlaceWordAction) === top[0]?.key) best += 1;
    }
    // |best − n·w0/Σ| < 4·√(n·w0/Σ), in integers: (best·Σ − n·w0)² < 16·n·w0·Σ.
    const w0 = weights[0]!;
    const diff = best * sum - n * w0;
    expect(diff * diff).toBeLessThan(16 * n * w0 * sum);
  });

  it('greedy always plays the best total (ties by key)', () => {
    const best = rankAll(obs, TINY)[0];
    for (let i = 0; i < 20; i += 1) {
      const d = decide(obs, TINY, 'greedy', botRng(seedOf(i), 0, 0));
      expect(actionKey(d.action as PlaceWordAction)).toBe(best?.key);
      expect(d.budgetExhausted).toBe(false);
    }
  });
});

describe('missed Full Stack (§5.3 step 4)', () => {
  const lexicon = lexiconOf([term('NETWORK'), term('NET'), term('WORK'), term('TO'), term('ON')]);
  const obs = craftedObservation(lexicon, boardWith([]), 'NETWORK');

  it('with a draw below 500‰ every 7-tile candidate is removed', () => {
    const rng = scriptedRng([0, 0]);
    const d = decide(obs, lexicon, 'beginner', rng);
    expect(d.action.type === 'PLACE_WORD' && d.action.tiles.length).toBeLessThan(7);
    expect(rng.calls[0]).toEqual([0, 1000]);
  });

  it('with a draw at or above 500‰ the Full Stack stays the favourite', () => {
    const rng = scriptedRng([500, 0]);
    const d = decide(obs, lexicon, 'beginner', rng);
    expect(d.action.type === 'PLACE_WORD' && d.action.tiles.length).toBe(7);
  });

  it('never turns a missed Full Stack into a voluntary exchange', () => {
    const only = lexiconOf([term('NETWORK')]);
    const o = craftedObservation(only, boardWith([]), 'NETWORK');
    const d = decide(o, only, 'beginner', scriptedRng([0, 0]));
    expect(d.action.type === 'PLACE_WORD' && d.action.tiles.length).toBe(7);
  });
});

describe('attention cap (§5.3 step 2, BOT-4)', () => {
  const obs = craftedObservation(TINY, boardWith(spell('NODE', 7, 5)), 'AITPSOD');
  const total = generateFor(obs, TINY).candidates.length;
  const budget = { maxNodes: 200_000, maxCandidates: 3 };

  it('beginner samples maxCandidates uniformly (partial Fisher–Yates) and is not exhausted', () => {
    // Sampling happens after the vocabulary filter (step 1 before step 2).
    const known = rankAll(obs, TINY).filter((c) => c.rank <= 1).length;
    expect(total).toBeGreaterThan(known);
    expect(known).toBeGreaterThan(3);
    const rng = scriptedRng([0, 0, 0, 0]);
    const d = decide(obs, TINY, 'beginner', rng, budget);
    expect(d.candidatesEvaluated).toBe(3);
    expect(d.budgetExhausted).toBe(false);
    expect(rng.calls.slice(0, 3)).toEqual([
      [0, known],
      [1, known],
      [2, known],
    ]);
  });

  it('greedy evaluates the first maxCandidates in generation order and reports exhaustion', () => {
    const d = decide(obs, TINY, 'greedy', botRng(seedOf(1), 0, 0), budget);
    expect(d.candidatesEvaluated).toBe(3);
    expect(d.budgetExhausted).toBe(true);
    const firstThree = generateFor(obs, TINY)
      .candidates.slice(0, 3)
      .map((c) => c.key);
    expect(firstThree).toContain(actionKey(d.action as PlaceWordAction));
  });
});

describe('random-legal (§5.2)', () => {
  const obs = craftedObservation(TINY, boardWith(spell('NODE', 7, 5)), 'AITPSOD');
  const sorted = generateFor(obs, TINY)
    .candidates.map((c) => c.key)
    .sort(compareKeys);

  it('picks uniformly in canonical-key order with one verification call', () => {
    for (const draw of [0, 1, sorted.length - 1]) {
      const d = decide(obs, TINY, 'random-legal', scriptedRng([draw]));
      expect(actionKey(d.action as PlaceWordAction)).toBe(sorted[draw]);
      expect(d.candidatesEvaluated).toBe(1);
      expect(d.budgetExhausted).toBe(false);
    }
  });

  // A GADDAG that knows a form the index does not: its moves are generated, then rejected by evaluateMove.
  const liar: LexiconIndex = Object.freeze({
    ...TINY,
    gaddag: buildGaddag([...formsOf(TINY), 'QI']),
  });
  const qObs = craftedObservation(liar, boardWith([]), 'QIIIIII');

  it('drops a rejected pick and redraws within maxCandidates; exhaustion when the cap drops work', () => {
    const ranks = generateFor(qObs, liar).candidates;
    expect(ranks.length).toBeGreaterThan(1);
    const d = decide(qObs, liar, 'random-legal', botRng(seedOf(2), 0, 0));
    expect(d.action.type).toBe('EXCHANGE');
    expect(d.candidatesEvaluated).toBe(Math.min(8, ranks.length));
    expect(d.budgetExhausted).toBe(ranks.length > 8);
    const capped = decide(qObs, liar, 'random-legal', botRng(seedOf(2), 0, 0), {
      maxNodes: 1_000,
      maxCandidates: 1,
    });
    expect(capped).toMatchObject({ candidatesEvaluated: 1, budgetExhausted: true });
  });

  it('ranked personalities drop rejected candidates too (the engine is authoritative)', () => {
    const d = decide(qObs, liar, 'greedy', botRng(seedOf(2), 0, 0));
    expect(d.action.type).toBe('EXCHANGE');
    expect(d.candidatesEvaluated).toBeGreaterThan(0);
  });
});
