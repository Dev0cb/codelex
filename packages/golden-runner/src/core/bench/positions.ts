/**
 * Bench positions of the P5 §2 harness (bots-off-ui-thread note §2 and §7 items 1–2; DG1 note §5 "Bench
 * positions"), built with public `@codelex/game-engine` and `@codelex/bots` APIs only: on-turn observations from
 * Beginner mirror games (every observation from action 2 on), seeds `seedOf(9000 + game)`, the same generator as
 * `packages/bots/test/qa2.bench.ts`, plus the two-blank variant of each position (worst case).
 *
 * Stepwise: {@link createPositionSource} advances one bot decision per `step()`, so an app host can yield between
 * steps (DG1 note §5.1: a case is never split, the UI is never blocked for more than one decision). Fixture code,
 * not rules (CLAUDE.md §1.2). Owner of the shared copy: ai-engineer (BN1); the Node harness moves to it in BN1.
 */
import {
  apply,
  createMatch,
  observe,
  type MatchConfig,
  type MatchState,
  type Observation,
  type SeedHex,
} from '@codelex/game-engine';
import { deriveRng, type Rng } from '@codelex/game-engine/rng';
import { chooseAction, PERSONALITIES, type BotPersonalityId } from '@codelex/bots';
import type { LexiconIndex } from '@codelex/lexicon/index';

import { unwrap } from '../cases.js';

/** P5 §2: 200 positions. */
export const BENCH_POSITIONS = 200;
/** P5 §2: the first mirror game is `seedOf(9000)`. */
export const BENCH_SEED_BASE = 9000;
/** Bound on mirror games, as in `qa2.bench.ts` (a lexicon so small that games end at once cannot loop forever). */
export const BENCH_MAX_GAMES = 2000;

/** `seedOf(i)` of `packages/bots/test/support/match.ts`: a 64-bit seed as 16 lowercase hex chars. */
export function benchSeed(i: number): SeedHex {
  return ((i * 0x9e3779b1 + 0x5eed) >>> 0).toString(16).padStart(16, '0') as SeedHex;
}

/** The Classic 1v1 header of the bench games (`configFor` of the bots' test support). */
export function benchMatchConfig(lexicon: LexiconIndex, seed: SeedHex): MatchConfig {
  return {
    seed,
    engineRulesVersion: 1,
    lexiconVersion: lexicon.version,
    profileId: lexicon.profile.id,
    definitionHash: lexicon.profile.definitionHash,
    config: {
      mode: 'classic',
      format: 'untimed-vs-bot',
      seats: 2,
      teams: [[0], [1]],
      layout: 'classic-v1',
      letters: 'letters-v1',
      requireWinner: 0,
    },
  };
}

/** The host's per-decision stream `bot:<seat>:<actionCount>` (ADR-0013 §D1, BOT-2). */
export function benchRng(seed: SeedHex, seat: number, actionCount: number): Rng {
  return deriveRng(seed, `bot:${String(seat)}:${String(actionCount)}`);
}

/** A bench position: the observation and the seed its decision stream derives from. */
export interface BenchPosition {
  /** `<seed>/<actionCount>`: stable, names the position in a report or a diff. */
  readonly id: string;
  readonly seed: SeedHex;
  readonly observation: Observation;
}

/** The same position with two blanks forced into the rack (`withTwoBlanks` of `qa2.bench.ts`). */
export function withTwoBlanks(position: BenchPosition): BenchPosition {
  const { observation } = position;
  return {
    ...position,
    observation: { ...observation, rack: `??${observation.rack.replace(/\?/g, '').slice(2)}` },
  };
}

/** One decision of the bench: `chooseAction` with the personality's frozen `BOT_VERSION` budget. */
export function benchDecision(
  lexicon: LexiconIndex,
  position: BenchPosition,
  personality: BotPersonalityId,
): ReturnType<typeof chooseAction> {
  const { observation, seed } = position;
  return chooseAction(observation, {
    lexicon,
    rng: benchRng(seed, observation.seatOnTurn, observation.actionCount),
    personality,
    budget: PERSONALITIES[personality].budget,
  });
}

/** A new match of `seed` on `lexicon`. */
export function startBenchMatch(lexicon: LexiconIndex, seed: SeedHex): MatchState {
  return unwrap(createMatch(benchMatchConfig(lexicon, seed), { lexicon })).state;
}

/**
 * The state after the seat on turn plays its `personality` decision (the bots' `play` loop, one step). Throws a
 * typed error if the bot fails or the engine rejects its action (P-BOT-01).
 */
export function playBenchStep(
  lexicon: LexiconIndex,
  state: MatchState,
  personality: BotPersonalityId,
): MatchState {
  const seat = state.seatOnTurn;
  const observation = observe(state, seat);
  const decided = unwrap(
    chooseAction(observation, {
      lexicon,
      rng: benchRng(state.seed, seat, observation.actionCount),
      personality,
      budget: PERSONALITIES[personality].budget,
    }),
  );
  return unwrap(apply(state, decided.action, { lexicon })).state;
}

export interface PositionSource {
  /** Plays one Beginner decision; false once `count` positions are collected (or the game bound is reached). */
  step(): boolean;
  readonly positions: readonly BenchPosition[];
}

/**
 * The P5 §2 positions, one decision per `step()`. Collects the on-turn observation before each decision from
 * action 2 on, game after game, until `count` positions.
 */
export function createPositionSource(
  lexicon: LexiconIndex,
  count: number = BENCH_POSITIONS,
): PositionSource {
  const positions: BenchPosition[] = [];
  let game = 0;
  let state: MatchState | null = null;
  return {
    positions,
    step() {
      if (positions.length >= count || game >= BENCH_MAX_GAMES) return false;
      state ??= startBenchMatch(lexicon, benchSeed(BENCH_SEED_BASE + game));
      const observation = observe(state, state.seatOnTurn);
      if (observation.actionCount >= 2) {
        positions.push({
          id: `${state.seed}/${String(observation.actionCount)}`,
          seed: state.seed,
          observation,
        });
      }
      const next = playBenchStep(lexicon, state, 'beginner');
      if (next.status === 'in_progress') {
        state = next;
      } else {
        state = null;
        game += 1;
      }
      return positions.length < count && game < BENCH_MAX_GAMES;
    },
  };
}
