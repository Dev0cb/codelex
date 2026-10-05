/**
 * Host-supplied context plumbing (sprint 3 B3, T-2; bots-api §5.4 V2-5):
 * - `ctx.draft` reaches every `evaluateMove` call, so bots play a draft rules version (ADR-0014 §D4) with the same
 *   candidate as the host's `createMatch` / `apply`;
 * - `ctx.data` overrides the personality data for a simulator yardstick (BG-2a: greedy with `maxDifficultyRank` 1)
 *   without a new public id.
 * Neither changes a decision when absent (bot goldens are pinned elsewhere and stay untouched).
 */
import {
  apply,
  createMatch,
  evaluateMove,
  observe,
  type Action,
  type DraftContext,
  type MatchConfig,
  type MatchState,
  type Observation,
  type SeedHex,
} from '@codelex/game-engine';
import { ALLOW_DRAFT_RULES } from '@codelex/game-engine/draft';
import { deriveRng } from '@codelex/game-engine/rng';
import { describe, expect, it } from 'vitest';
import { realIndex } from '../test/support/lexicons.js';
import {
  actionKey,
  chooseAction,
  PERSONALITIES,
  type BotContext,
  type BotPersonalityId,
} from './index.js';

const REAL = realIndex();
const DIFFICULTY_RANK = { novice: 0, intermediate: 1, advanced: 2, expert: 3 } as const;

function seedOf(i: number): SeedHex {
  return ((i * 0x2545f491 + 0xb3) >>> 0).toString(16).padStart(16, '0') as SeedHex;
}

function v2Config(seed: SeedHex): MatchConfig {
  return {
    seed,
    engineRulesVersion: 2,
    lexiconVersion: REAL.version,
    profileId: REAL.profile.id,
    definitionHash: REAL.profile.definitionHash,
    config: {
      mode: 'classic',
      format: 'untimed-vs-bot',
      seats: 2,
      teams: [[0], [1]],
      layout: 'classic-v2',
      letters: 'letters-v2',
      requireWinner: 0,
    },
  };
}

function ctx(
  obs: Observation,
  seed: SeedHex,
  personality: BotPersonalityId,
  extra: Partial<BotContext> = {},
): BotContext {
  return {
    lexicon: REAL,
    rng: deriveRng(seed, `bot:${String(obs.seatOnTurn)}:${String(obs.actionCount)}`),
    personality,
    budget: PERSONALITIES[personality].budget,
    ...extra,
  };
}

function decide(obs: Observation, context: BotContext): Action {
  const decided = chooseAction(obs, context);
  if (!decided.ok) throw new Error(decided.error.code);
  return decided.value.action;
}

describe('ctx.draft: bots play a draft rules version with the host candidate', () => {
  for (const candidate of ['tb-0-2-4-8', 'tb-0-3-6-12']) {
    it(`${candidate}: every personality's move is accepted by apply under the same draft`, () => {
      const draft: DraftContext = { optIn: ALLOW_DRAFT_RULES, candidate };
      const seed = seedOf(candidate.length);
      const created = createMatch(v2Config(seed), { lexicon: REAL, draft });
      if (!created.ok) throw new Error(created.error.code);
      let state: MatchState = created.value.state;
      let words = 0;
      for (let n = 0; n < 12 && state.status === 'in_progress'; n += 1) {
        const obs = observe(state, state.seatOnTurn);
        const personality = (['beginner', 'greedy', 'random-legal'] as const)[n % 3] ?? 'greedy';
        const action = decide(obs, ctx(obs, seed, personality, { draft }));
        if (action.type === 'PLACE_WORD') {
          words += 1;
          expect(evaluateMove(obs, action, { lexicon: REAL, draft }).ok).toBe(true);
        }
        const applied = apply(state, action, { lexicon: REAL, draft });
        if (!applied.ok) throw new Error(applied.error.code);
        state = applied.value.state;
      }
      expect(words).toBeGreaterThan(6);
    });
  }

  it('without ctx.draft the engine refuses every evaluation of a draft observation (fallback only)', () => {
    const draft: DraftContext = { optIn: ALLOW_DRAFT_RULES };
    const seed = seedOf(3);
    const created = createMatch(v2Config(seed), { lexicon: REAL, draft });
    if (!created.ok) throw new Error(created.error.code);
    const obs = observe(created.value.state, created.value.state.seatOnTurn);
    const decided = chooseAction(obs, ctx(obs, seed, 'greedy'));
    expect(decided.ok && decided.value.action.type).toBe('EXCHANGE');
    expect(decided.ok && decided.value.candidatesEvaluated).toBeGreaterThan(0);
    // Every evaluation was an engine refusal, and the decision says so (the I-2 signal).
    expect(decided.ok && decided.value.candidatesRefused).toBe(
      decided.ok && decided.value.candidatesEvaluated,
    );
    expect(decide(obs, ctx(obs, seed, 'greedy', { draft })).type).toBe('PLACE_WORD');
    for (const personality of ['greedy', 'beginner', 'random-legal'] as const) {
      const ok = chooseAction(obs, ctx(obs, seed, personality, { draft }));
      expect(ok.ok && ok.value.candidatesRefused).toBe(0);
      const refused = chooseAction(obs, ctx(obs, seed, personality));
      expect(refused.ok && refused.value.candidatesRefused).toBeGreaterThan(0);
    }
  });
});

describe('ctx.data: simulator-side personality override (BG-2a yardstick)', () => {
  const matched = { ...PERSONALITIES.greedy, maxDifficultyRank: 1 as const };

  function positions(): Observation[] {
    const out: Observation[] = [];
    for (let i = 0; i < 6; i += 1) {
      const seed = seedOf(100 + i);
      const base = v2Config(seed);
      const v1: MatchConfig = {
        ...base,
        engineRulesVersion: 1,
        config: { ...base.config, layout: 'classic-v1', letters: 'letters-v1' },
      };
      const created = createMatch(v1, { lexicon: REAL });
      if (!created.ok) throw new Error(created.error.code);
      let state = created.value.state;
      for (let n = 0; n < 10 && state.status === 'in_progress'; n += 1) {
        const obs = observe(state, state.seatOnTurn);
        out.push(obs);
        const applied = apply(state, decide(obs, ctx(obs, seed, 'greedy')), { lexicon: REAL });
        if (!applied.ok) throw new Error(applied.error.code);
        state = applied.value.state;
      }
    }
    return out;
  }

  it('absent ⇒ the table data; present ⇒ the override drives the policy', () => {
    let differs = 0;
    for (const obs of positions()) {
      const seed = seedOf(7);
      const plain = decide(obs, ctx(obs, seed, 'greedy'));
      expect(decide(obs, ctx(obs, seed, 'greedy', { data: PERSONALITIES.greedy }))).toEqual(plain);
      const filtered = decide(obs, ctx(obs, seed, 'greedy', { data: matched }));
      if (filtered.type !== 'PLACE_WORD') continue;
      const scored = evaluateMove(obs, filtered, { lexicon: REAL });
      if (!scored.ok) throw new Error(scored.error.code);
      const main = scored.value.breakdown.words.find((w) => w.main);
      // The filter keeps novice/intermediate main words unless that would empty the candidate set.
      if (main !== undefined && DIFFICULTY_RANK[main.difficulty] > 1) continue;
      if (plain.type !== 'PLACE_WORD' || actionKey(filtered) !== actionKey(plain)) differs += 1;
    }
    expect(differs).toBeGreaterThan(0);
  });
});
