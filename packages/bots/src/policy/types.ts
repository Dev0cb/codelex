import type {
  EngineContext,
  ExchangeAction,
  Observation,
  PassAction,
  PlaceWordAction,
} from '@codelex/game-engine';
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
  /**
   * Canonical action returned by `evaluateMove`, or undefined ⇒ fallback (BOT-6). Strategist also returns its own
   * EXCHANGE (voluntary, or forced with the keep `K*`) or PASS (spec S-4).
   */
  readonly action: PlaceWordAction | ExchangeAction | PassAction | undefined;
  readonly candidatesEvaluated: number;
  /** `evaluateMove` calls the engine refused (instrumentation, `BotDecision.candidatesRefused`). */
  readonly refused: number;
  /** True iff `maxCandidates` dropped work (BOT-4). */
  readonly exhausted: boolean;
  /** True iff the action is a voluntary EXCHANGE (Strategist X-1..X-5); simulator readout only. */
  readonly voluntaryExchange?: boolean;
}
