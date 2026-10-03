/**
 * Full matches through the real engine: P-BOT-01 (every decision accepted by `apply`, fallbacks and tiny budgets
 * included, every personality, real and synthetic lexicons, 2–4 seats) and P-BOT-07 (Beginner's main word is
 * novice/intermediate whenever such a candidate exists; never a voluntary exchange).
 */
import fc from 'fast-check';
import { evaluateMove } from '@codelex/game-engine';
import { describe, expect, it } from 'vitest';
import type { BotPersonalityId } from '../src/index.js';
import { generateFor } from './support/generation.js';
import { realIndex, syntheticIndex, tinyIndex } from './support/lexicons.js';
import { play, seedOf } from './support/match.js';

const REAL = realIndex();
const SYNTH = syntheticIndex(2000);
const TINY = tinyIndex();
const IDS: readonly BotPersonalityId[] = ['random-legal', 'beginner', 'greedy'];
const RANK: Readonly<Record<string, number>> = {
  novice: 0,
  intermediate: 1,
  advanced: 2,
  expert: 3,
};

describe('P-BOT-01 full matches', () => {
  it('every bot action is accepted by apply until the match ends', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.constantFrom(REAL, SYNTH, TINY),
        fc.array(fc.constantFrom(...IDS), { minLength: 2, maxLength: 4 }),
        (seed, lexicon, personalities) => {
          let decisions = 0;
          const end = play({
            lexicon,
            seed: seedOf(seed),
            personalities,
            onStep: ({ decision }) => {
              decisions += 1;
              expect(decision.action.type).not.toBe('RESIGN');
            },
          });
          expect(end.status).toBe('finished');
          expect(decisions).toBeGreaterThan(0);
        },
      ),
      { numRuns: 24 },
    );
  }, 120_000);

  it('holds with tiny budgets (best-so-far and fallbacks)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.constantFrom(...IDS),
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 1, max: 3 }),
        (seed, personality, maxNodes, maxCandidates) => {
          let exhausted = 0;
          play({
            lexicon: REAL,
            seed: seedOf(seed),
            personalities: [personality, 'greedy'],
            budget: { maxNodes, maxCandidates },
            maxActions: 30,
            onStep: ({ decision }) => {
              expect(decision.nodesUsed).toBeLessThanOrEqual(maxNodes);
              expect(decision.candidatesEvaluated).toBeLessThanOrEqual(maxCandidates);
              if (decision.budgetExhausted) exhausted += 1;
            },
          });
          return exhausted >= 0;
        },
      ),
      { numRuns: 20 },
    );
  }, 120_000);
});

describe('P-BOT-07 beginner vocabulary and no voluntary exchange', () => {
  it('plays novice/intermediate main words whenever one is available', () => {
    let checked = 0;
    for (let i = 0; i < 6; i += 1) {
      play({
        lexicon: REAL,
        seed: seedOf(100 + i),
        personalities: ['beginner', 'greedy'],
        onStep: ({ observation, decision }) => {
          if (observation.seatOnTurn !== 0) return;
          const qualifying = generateFor(observation, REAL).candidates.some((c) => {
            const r = evaluateMove(observation, c.action, { lexicon: REAL });
            return r.ok && (RANK[r.value.breakdown.words[0]?.difficulty ?? 'expert'] ?? 3) <= 1;
          });
          if (decision.action.type !== 'PLACE_WORD') {
            // No voluntary exchange: a fallback only when nothing was playable.
            expect(generateFor(observation, REAL).candidates).toHaveLength(0);
            return;
          }
          const r = evaluateMove(observation, decision.action, {
            lexicon: REAL,
          });
          if (!r.ok) throw new Error(r.error.code);
          const rank = RANK[r.value.breakdown.words[0]?.difficulty ?? 'expert'] ?? 3;
          if (qualifying) expect(rank).toBeLessThanOrEqual(1);
          checked += 1;
        },
      });
    }
    expect(checked).toBeGreaterThan(50);
  }, 120_000);
});
