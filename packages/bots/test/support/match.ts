/**
 * Host-side harness (B2/S1 role, test-only): creates matches with the real engine, derives the bot stream
 * `bot:<seat>:<actionCount>` from the match seed (ADR-0013 §D1) and checks every decision with `apply`.
 * Tests may import `createMatch`, `apply`, `observe` and the stream derivation; `src/` may not (BOT-2).
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
import type { LexiconIndex } from '@codelex/lexicon/index';
import { chooseAction, PERSONALITIES } from '../../src/index.js';
import type { BotBudget, BotContext, BotDecision, BotPersonalityId } from '../../src/index.js';

export function seedOf(i: number): SeedHex {
  return ((i * 0x9e3779b1 + 0x5eed) >>> 0).toString(16).padStart(16, '0') as SeedHex;
}

export function configFor(lexicon: LexiconIndex, seed: SeedHex, seats = 2): MatchConfig {
  return {
    seed,
    engineRulesVersion: 1,
    lexiconVersion: lexicon.version,
    profileId: lexicon.profile.id,
    definitionHash: lexicon.profile.definitionHash,
    config: {
      mode: 'classic',
      format: seats === 2 ? 'untimed-vs-bot' : 'untimed',
      seats,
      teams: Array.from({ length: seats }, (_, s) => [s]),
      layout: 'classic-v1',
      letters: 'letters-v1',
      requireWinner: 0,
    },
  };
}

export function startMatch(lexicon: LexiconIndex, seed: SeedHex, seats = 2): MatchState {
  const created = createMatch(configFor(lexicon, seed, seats), { lexicon });
  if (!created.ok) throw new Error(`createMatch failed: ${created.error.code}`);
  return created.value.state;
}

/** The host's derivation of the per-decision stream (BOT-2). */
export function botRng(seed: SeedHex, seat: number, actionCount: number): Rng {
  return deriveRng(seed, `bot:${String(seat)}:${String(actionCount)}`);
}

export function contextFor(
  lexicon: LexiconIndex,
  personality: BotPersonalityId,
  rng: Rng,
  budget: BotBudget = PERSONALITIES[personality].budget,
): BotContext {
  return { lexicon, rng, personality, budget };
}

export interface Step {
  readonly observation: Observation;
  readonly decision: BotDecision;
  readonly state: MatchState;
}

export interface PlayOptions {
  readonly lexicon: LexiconIndex;
  readonly seed: SeedHex;
  /** Personality per seat. */
  readonly personalities: readonly BotPersonalityId[];
  /** Stop after this many accepted actions (default: until the match ends). */
  readonly maxActions?: number;
  readonly budget?: BotBudget;
  /** Called before each decision is applied. */
  readonly onStep?: (step: Step) => void;
}

/**
 * Plays bots against each other through `apply`. Throws if a decision fails or `apply` rejects it (P-BOT-01).
 * Returns the final (or truncated) state.
 */
export function play(options: PlayOptions): MatchState {
  const { lexicon, seed, personalities } = options;
  let state = startMatch(lexicon, seed, personalities.length);
  const limit = options.maxActions ?? Number.MAX_SAFE_INTEGER;
  while (state.status === 'in_progress' && state.actionCount < limit) {
    const seat = state.seatOnTurn;
    const personality = personalities[seat] ?? 'random-legal';
    const observation = observe(state, seat);
    const ctx = contextFor(
      lexicon,
      personality,
      botRng(seed, seat, observation.actionCount),
      options.budget ?? PERSONALITIES[personality].budget,
    );
    const decided = chooseAction(observation, ctx);
    if (!decided.ok) throw new Error(`chooseAction failed: ${decided.error.code}`);
    options.onStep?.({ observation, decision: decided.value, state });
    const applied = apply(state, decided.value.action, { lexicon });
    if (!applied.ok) {
      throw new Error(
        `apply rejected a bot action (${personality}, seed ${seed}, action ${String(state.actionCount)}): ${applied.error.code}`,
      );
    }
    state = applied.value.state;
  }
  return state;
}

/**
 * Seeded mid-game positions: plays `personalities` from `seed` for `actions` accepted actions and returns the
 * state (or undefined if the match ended first).
 */
export function positionAfter(
  lexicon: LexiconIndex,
  seed: SeedHex,
  actions: number,
  personalities: readonly BotPersonalityId[] = ['beginner', 'beginner'],
): MatchState | undefined {
  const state = play({ lexicon, seed, personalities, maxActions: actions });
  return state.status === 'in_progress' ? state : undefined;
}

/** A 15×15 board from sparse `(row, col, tile)` entries. */
export function boardWith(entries: readonly (readonly [number, number, string])[]): string[] {
  const rows = new Array<string>(15).fill('.'.repeat(15));
  for (const [row, col, tile] of entries) {
    const line = rows[row] ?? '';
    rows[row] = line.slice(0, col) + tile + line.slice(col + 1);
  }
  return rows;
}

/** Board entries spelling `word` from `(row, col)` along a direction. */
export function spell(
  word: string,
  row: number,
  col: number,
  direction: 'row' | 'col' = 'row',
): [number, number, string][] {
  return Array.from(word, (tile, i) =>
    direction === 'row' ? [row, col + i, tile] : [row + i, col, tile],
  );
}

/**
 * A crafted observation for seat 0 on turn: an in-progress match pinned to `lexicon` with the given board, rack
 * and bag count. Built from a real `createMatch` observation so every other field is consistent.
 */
export function craftedObservation(
  lexicon: LexiconIndex,
  board: readonly string[],
  rack: string,
  bagCount = 50,
): Observation {
  const base = observe(startMatch(lexicon, seedOf(1)), 0);
  return {
    ...base,
    seatOnTurn: 0,
    board,
    rack: Array.from(rack)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .join(''),
    bagCount,
  };
}

/** A fixed Rng whose `int` returns queued offsets (clamped into range); for exact weighting tests. */
export function scriptedRng(
  draws: readonly number[],
): Rng & { readonly calls: [number, number][] } {
  const queue = [...draws];
  const calls: [number, number][] = [];
  return {
    calls,
    next: () => 0,
    int(lo: number, hi: number): number {
      calls.push([lo, hi]);
      const d = queue.shift() ?? 0;
      return Math.min(hi - 1, lo + d);
    },
    shuffle: <T>(items: readonly T[]): T[] => [...items],
    state: () => [1, 0, 0, 0] as const,
  };
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
