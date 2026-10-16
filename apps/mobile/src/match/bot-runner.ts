/**
 * The bot seam of the P5 spike (docs/architecture/notes/bots-off-ui-thread.md §4.1): inputs and outputs are plain
 * data, so the JS-thread runner of slice S1 (option A) can be swapped for a worker runtime (option B) without
 * touching the match. The host derives the RNG state of the `bot:<seat>:<n>` stream (ADR-0013 §D1); the seed never
 * crosses the seam (E-1.5 AC-8, BOT-2).
 */
import {
  chooseAction,
  PERSONALITIES,
  type BotDecision,
  type BotError,
  type BotPersonalityId,
} from '@codelex/bots';
import type { Result } from '@codelex/config/result';
import {
  createRng,
  deriveStreamState,
  observe,
  type MatchState,
  type Observation,
  type RngState,
  type Seat,
} from '@codelex/game-engine';
import type { LexiconIndex } from '@codelex/lexicon/index';

export interface BotRequest {
  /** Plain data, the bot seat's legal observation only. */
  readonly observation: Observation;
  /** Derived by the host from `bot:<seat>:<n>`; the seed never leaves the host. */
  readonly rngState: RngState;
  readonly personality: BotPersonalityId;
}

export interface BotRunner {
  /**
   * `onStart` (optional, analytics only): called right before the search starts, after any wait of the runner, so the
   * caller can time the compute alone (`bot_decision_made.compute_ms_bucket`).
   */
  decide(request: BotRequest, onStart?: () => void): Promise<Result<BotDecision, BotError>>;
}

/** The request for `seat` on `state`: its observation and a fresh `bot:<seat>:<actionCount>` stream state. */
export function botRequestFor(
  state: MatchState,
  seat: Seat,
  personality: BotPersonalityId,
): BotRequest {
  return {
    observation: observe(state, seat),
    rngState: deriveStreamState(state.seed, `bot:${String(seat)}:${String(state.actionCount)}`),
    personality,
  };
}

export interface JsThreadBotRunnerOptions {
  /** Resolves once the next frame is committed. Default: `requestAnimationFrame`. */
  readonly nextFrame?: () => Promise<void>;
}

const nextAnimationFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

/**
 * Option A of P5: `chooseAction` runs synchronously on the JS thread after the next frame, so the thinking
 * indicator's first frame is on screen; gestures and the indicator run as UI-thread worklets meanwhile. Search is
 * bounded by the personality's node and candidate budget, never by wall-clock time (BOT-3).
 */
export function createJsThreadBotRunner(
  lexicon: LexiconIndex,
  options: JsThreadBotRunnerOptions = {},
): BotRunner {
  const nextFrame = options.nextFrame ?? nextAnimationFrame;
  return {
    async decide(request, onStart) {
      await nextFrame();
      onStart?.();
      return chooseAction(request.observation, {
        lexicon,
        rng: createRng(request.rngState),
        personality: request.personality,
        budget: PERSONALITIES[request.personality].budget,
      });
    },
  };
}
