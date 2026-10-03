/**
 * Public contract of `@codelex/bots` (docs/architecture/notes/bots-api.md §3, §5.1). Bots see an `Observation`
 * and a context; never a `MatchState`, the seed or the bag (BOT-2, ADR-0013 §D9).
 */
import type { Action } from '@codelex/game-engine';
import type { Rng } from '@codelex/game-engine/rng';
import type { LexiconIndex } from '@codelex/lexicon/index';

/** `random-legal` is internal (simulator floor, fuzzing); never offered to players. `greedy` is a simulator yardstick. */
export type BotPersonalityId = 'random-legal' | 'beginner' | 'greedy';

export interface BotBudget {
  /** Max automaton transitions (BOT-3). Safe integer ≥ 1. */
  readonly maxNodes: number;
  /** Max `evaluateMove` calls per decision. Safe integer ≥ 1. */
  readonly maxCandidates: number;
}

export interface BotContext {
  /** Same artefact the match is pinned to (version, profile, definitionHash). */
  readonly lexicon: LexiconIndex;
  /** Fresh per decision, derived by the host from `bot:<seat>:<obs.actionCount>`; consumed by this call only. */
  readonly rng: Rng;
  readonly personality: BotPersonalityId;
  /** Default: `PERSONALITIES[personality].budget`; hosts override only in tests and benchmarks. */
  readonly budget: BotBudget;
}

export interface BotDecision {
  /** Always accepted by `apply` on the state `obs` was observed from (P-BOT-01). Canonical form. */
  readonly action: Action;
  readonly nodesUsed: number;
  readonly candidatesEvaluated: number;
  readonly budgetExhausted: boolean;
}

/** Checked in this order (bots-api §3, P-BOT-08). */
export type BotErrorCode =
  'NOT_A_SEAT' | 'MATCH_OVER' | 'NOT_ON_TURN' | 'LEXICON_MISMATCH' | 'INVALID_BUDGET';

export interface BotError {
  readonly kind: 'bot';
  readonly code: BotErrorCode;
  readonly message: string;
}

/** Personality data: integers only (BOT-7, ADR-0013 §D4.1). */
export interface PersonalityData {
  readonly budget: BotBudget;
  /** Hardest main-word difficulty kept (0 novice … 3 expert); ignored if it empties the candidate set. */
  readonly maxDifficultyRank: 0 | 1 | 2 | 3;
  /** Candidates kept before evaluation when generation yields more than budget.maxCandidates: uniform sample with ctx.rng. */
  readonly sampleWhenOver: 0 | 1;
  /** Integer weights for the top-N after ranking by breakdown.total; length = N. [1] = always the best. */
  readonly topWeights: readonly number[];
  /** Weight multiplier for main words of length ≤ shortLength (1 = neutral). */
  readonly shortLength: number;
  readonly shortMultiplier: number;
  /** Permille chance to ignore every Full Stack (7-tile) candidate in a decision. */
  readonly skipFullStackPermille: number;
}
