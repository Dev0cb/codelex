/**
 * Golden decisions (bots-api §5.6, §7; spec AC-12): 20 seeded positions of a lexicon fixture (Beginner mirror
 * games) × personality → canonical action key and budget counters. Pinned per (`BOT_VERSION`,
 * `engineRulesVersion`) in `test/golden/decisions-b<BOT_VERSION>-r<engineRulesVersion>.json`, computed on the
 * automaton the app ships (f1: the `.clxi` with its GADDAG section, lexicon P7). A change is intentional, reviewed,
 * and goes with a version bump; published files are never edited.
 *
 * `decisions-v1.json` is the frozen record of (1, 1) from before this layout; it is no longer executed (bot
 * reasoning is never replayed, ADR-0013 §D2).
 */
import { observe, type MatchState, type SeedHex } from '@codelex/game-engine';
import type { LexiconIndex } from '@codelex/lexicon/index';
import { actionKey, BOT_VERSION, chooseAction, type BotPersonalityId } from '../../src/index.js';
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

/** Layout of `decisions-v1.json` (BOT_VERSION 1, engineRulesVersion 1, reference-index tries). */
export interface GoldenFileV1 {
  readonly botVersion: number;
  readonly lexiconVersion: string;
  readonly decisions: readonly GoldenDecision[];
}

export interface GoldenFile {
  readonly botVersion: number;
  readonly engineRulesVersion: number;
  readonly lexiconVersion: string;
  /** Automaton the expected decisions were computed on: the shipped one (f1 = `gaddag`). */
  readonly automaton: 'gaddag' | 'dawg';
  /**
   * Decisions where a cap bound (`budgetExhausted`): asserted on `automaton` only, because P-BOT-03 guarantees
   * equal GADDAG/DAWG decisions only when no cap binds. Every other decision is also asserted on the other one.
   */
  readonly capBoundDecisions: number;
  readonly decisions: readonly GoldenDecision[];
}

export const GOLDEN_PERSONALITIES: readonly BotPersonalityId[] = [
  'random-legal',
  'beginner',
  'greedy',
  'strategist',
];

export interface GoldenPosition {
  readonly seed: SeedHex;
  readonly actions: number;
  readonly state: MatchState;
}

/**
 * 20 positions after 0, 2, …, 18 actions of Beginner mirror games, chosen so that no cap binds for any personality
 * on `lexicon` (bots-api §5.6, spec AC-12): a seed whose match ends earlier, or whose position makes a decision
 * exhaust a budget, is skipped.
 */
export function goldenPositions(lexicon: LexiconIndex): GoldenPosition[] {
  const positions: GoldenPosition[] = [];
  for (let i = 0; positions.length < 20; i += 1) {
    const seed = seedOf(500 + i);
    const actions = 2 * (positions.length % 10);
    const state = positionAfter(lexicon, seed, actions);
    if (i > 200) throw new Error('not enough golden positions');
    if (state === undefined) continue;
    const position = { seed, actions, state };
    if (GOLDEN_PERSONALITIES.some((p) => decisionAt(lexicon, position, p).budgetExhausted))
      continue;
    positions.push(position);
  }
  return positions;
}

export function decisionAt(
  lexicon: LexiconIndex,
  position: GoldenPosition,
  personality: BotPersonalityId,
): GoldenDecision {
  const { seed, actions, state } = position;
  const obs = observe(state, state.seatOnTurn);
  const result = chooseAction(
    obs,
    contextFor(lexicon, personality, botRng(seed, obs.seatOnTurn, obs.actionCount)),
  );
  if (!result.ok) throw new Error(result.error.code);
  const { action, nodesUsed, candidatesEvaluated, budgetExhausted } = result.value;
  if (action.type === 'RESIGN') throw new Error('bots never resign');
  return {
    seed,
    actions,
    personality,
    key: actionKey(action),
    nodesUsed,
    candidatesEvaluated,
    budgetExhausted,
  };
}

/** The golden file of the current `BOT_VERSION` for `engineRulesVersion` 1, computed on `lexicon`. */
export function computeGolden(lexicon: LexiconIndex): GoldenFile {
  const decisions: GoldenDecision[] = [];
  for (const position of goldenPositions(lexicon)) {
    for (const personality of GOLDEN_PERSONALITIES) {
      decisions.push(decisionAt(lexicon, position, personality));
    }
  }
  return {
    botVersion: BOT_VERSION,
    engineRulesVersion: 1,
    lexiconVersion: lexicon.version,
    automaton: lexicon.gaddag === undefined ? 'dawg' : 'gaddag',
    capBoundDecisions: decisions.filter((d) => d.budgetExhausted).length,
    decisions,
  };
}
