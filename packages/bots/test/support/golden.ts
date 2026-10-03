/**
 * Golden decisions (bots-api §7): 20 seeded positions of a lexicon fixture (Beginner mirror games) × personality →
 * canonical action key and budget counters. Pinned per `BOT_VERSION`: a change is intentional and reviewed, and
 * goes with a version bump.
 */
import { observe } from '@codelex/game-engine';
import { actionKey, BOT_VERSION, chooseAction, type BotPersonalityId } from '../../src/index.js';
import type { LexiconIndex } from '@codelex/lexicon/index';
import { botRng, contextFor, positionAfter, seedOf } from './match.js';

export interface GoldenDecision {
  readonly seed: string;
  readonly actions: number;
  readonly personality: BotPersonalityId;
  readonly key: string;
  readonly nodesUsed: number;
  readonly candidatesEvaluated: number;
  readonly budgetExhausted: boolean;
}

export interface GoldenFile {
  readonly botVersion: number;
  readonly lexiconVersion: string;
  readonly decisions: readonly GoldenDecision[];
}

const PERSONALITIES: readonly BotPersonalityId[] = ['random-legal', 'beginner', 'greedy'];

export function computeGolden(lexicon: LexiconIndex): GoldenFile {
  const decisions: GoldenDecision[] = [];
  // 20 positions after 0, 2, …, 18 actions; a seed whose match ends earlier is skipped.
  for (let i = 0, positions = 0; positions < 20; i += 1) {
    const seed = seedOf(500 + i);
    const actions = 2 * (positions % 10);
    const state = positionAfter(lexicon, seed, actions);
    if (i > 200) throw new Error('not enough golden positions');
    if (state === undefined) continue;
    positions += 1;
    const obs = observe(state, state.seatOnTurn);
    for (const personality of PERSONALITIES) {
      const result = chooseAction(
        obs,
        contextFor(lexicon, personality, botRng(seed, obs.seatOnTurn, obs.actionCount)),
      );
      if (!result.ok) throw new Error(result.error.code);
      const { action, nodesUsed, candidatesEvaluated, budgetExhausted } = result.value;
      if (action.type === 'RESIGN') throw new Error('bots never resign');
      decisions.push({
        seed,
        actions,
        personality,
        key: actionKey(action),
        nodesUsed,
        candidatesEvaluated,
        budgetExhausted,
      });
    }
  }
  return { botVersion: BOT_VERSION, lexiconVersion: lexicon.version, decisions };
}
