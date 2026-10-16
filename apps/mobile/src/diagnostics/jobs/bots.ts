/**
 * Suite 3, bot compute (DG1 note §5; P5 §7 items 1–2; sprint H1 row: bot think p95): the 200 P5 §2 positions
 * (`createPositionSource`, one Beginner decision per step while they are generated) on the app's loaded lexicon
 * and shipped automaton, each decided by Beginner and Strategist with the frozen `BOT_VERSION` budgets, then again
 * with two blanks forced into the rack. One decision per step; each decision is timed on its own.
 *
 * Output per bot and rack type: compute µs, nodes, candidates (p50/p95/p99/max) and the cap-bound count; and the
 * bots-api §6 constants fitted over Strategist's decisions (both rack types).
 */
import { BOT_VERSION, type BotPersonalityId } from '@codelex/bots';
import {
  benchDecision,
  BENCH_POSITIONS,
  createPositionSource,
  distribution,
  fitConstants,
  withTwoBlanks,
  type DecisionSample,
  type Distribution,
  type FittedConstants,
} from '@codelex/golden-runner/core';
import type { LexiconIndex } from '@codelex/lexicon/index';

import type { Clock, Job } from './job';

/** Report bot ids: one entry per personality and rack type (the A2 `botThink` list has no rack-type field). */
export const BOT_GROUPS = [
  { botId: 'beginner', personality: 'beginner', twoBlanks: false },
  { botId: 'strategist', personality: 'strategist', twoBlanks: false },
  { botId: 'beginner-two-blanks', personality: 'beginner', twoBlanks: true },
  { botId: 'strategist-two-blanks', personality: 'strategist', twoBlanks: true },
] as const satisfies readonly {
  botId: string;
  personality: BotPersonalityId;
  twoBlanks: boolean;
}[];

export interface BotGroupResult {
  readonly botId: string;
  readonly botVersion: number;
  readonly timingUs: Distribution;
  readonly nodes: Distribution;
  readonly candidates: Distribution;
  readonly capBound: number;
}

export type BotsResult =
  | {
      readonly kind: 'measured';
      readonly automaton: 'gaddag' | 'dawg';
      readonly groups: readonly BotGroupResult[];
      /** Fitted over Strategist's decisions; null when the data does not support a fit. */
      readonly constants: FittedConstants | null;
    }
  /** No position could be generated, a bot failed, or the clock is broken. */
  | { readonly kind: 'failed'; readonly reason: 'no-positions' | 'bot-error' | 'clock' };

export function botsJob(
  lexicon: LexiconIndex,
  clock: Clock,
  positionCount: number = BENCH_POSITIONS,
): Job<BotsResult> {
  const source = createPositionSource(lexicon, positionCount);
  const samples = BOT_GROUPS.map(() => [] as DecisionSample[]);
  const capBound = BOT_GROUPS.map(() => 0);
  let generating = true;
  let decision = 0;
  let botError = false;

  const decisions = (): number => source.positions.length * BOT_GROUPS.length;

  const decide = (): void => {
    const group = BOT_GROUPS[decision % BOT_GROUPS.length];
    const base = source.positions[Math.floor(decision / BOT_GROUPS.length)];
    decision += 1;
    if (group === undefined || base === undefined) return;
    const position = group.twoBlanks ? withTwoBlanks(base) : base;
    const start = clock();
    const decided = benchDecision(lexicon, position, group.personality);
    const end = clock();
    if (!decided.ok) {
      botError = true;
      return;
    }
    const index = BOT_GROUPS.indexOf(group);
    samples[index]?.push({
      micros: (end - start) * 1000,
      nodes: decided.value.nodesUsed,
      candidates: decided.value.candidatesEvaluated,
    });
    if (decided.value.budgetExhausted) capBound[index] = (capBound[index] ?? 0) + 1;
  };

  const result = (): BotsResult => {
    if (source.positions.length === 0) return { kind: 'failed', reason: 'no-positions' };
    if (botError) return { kind: 'failed', reason: 'bot-error' };
    const groups: BotGroupResult[] = [];
    for (const [i, group] of BOT_GROUPS.entries()) {
      const list = samples[i] ?? [];
      const timingUs = distribution(list.map((s) => s.micros));
      const nodes = distribution(list.map((s) => s.nodes));
      const candidates = distribution(list.map((s) => s.candidates));
      if (timingUs === null || nodes === null || candidates === null) {
        return { kind: 'failed', reason: 'clock' };
      }
      groups.push({
        botId: group.botId,
        botVersion: BOT_VERSION,
        timingUs,
        nodes,
        candidates,
        capBound: capBound[i] ?? 0,
      });
    }
    const strategist = BOT_GROUPS.flatMap((g, i) =>
      g.personality === 'strategist' ? (samples[i] ?? []) : [],
    );
    return {
      kind: 'measured',
      automaton: lexicon.gaddag === undefined ? 'dawg' : 'gaddag',
      groups,
      constants: fitConstants(strategist),
    };
  };

  return {
    suite: 'bots',
    timed: true,
    step() {
      if (generating) {
        generating = source.step();
        return generating || decisions() > 0;
      }
      if (decision >= decisions()) return false;
      decide();
      return decision < decisions();
    },
    progress: () => ({
      done: generating ? source.positions.length : positionCount + decision,
      total: positionCount * (1 + BOT_GROUPS.length),
    }),
    result,
    dispose() {
      // Memory only.
    },
  };
}
