import type { EngineContext, Observation, PlaceWordAction } from '@codelex/game-engine';
import type { Rng } from '@codelex/game-engine/rng';
import type { LexiconIndex } from '@codelex/lexicon/index';
import type { BoardView } from '../board.js';
import type { Candidate } from '../movegen/index.js';
import type { BotBudget, PersonalityData } from '../types.js';

export interface PolicyInput {
  readonly obs: Observation;
  readonly lexicon: LexiconIndex;
  /** Context of every `evaluateMove` call: the lexicon and, for a draft rules version, the host's `draft`. */
  readonly engine: EngineContext;
  readonly rng: Rng;
  readonly budget: BotBudget;
  readonly data: PersonalityData;
  readonly view: BoardView;
  /** Deduplicated, in generation order. */
  readonly candidates: readonly Candidate[];
}

export interface PolicyResult {
  /** Canonical action returned by `evaluateMove`, or undefined ⇒ fallback (BOT-6). */
  readonly action: PlaceWordAction | undefined;
  readonly candidatesEvaluated: number;
  /** `evaluateMove` calls the engine refused (instrumentation, `BotDecision.candidatesRefused`). */
  readonly refused: number;
  /** True iff `maxCandidates` dropped work (BOT-4). */
  readonly exhausted: boolean;
}
