/**
 * Suite 5, drift (DG1 note §5; P5 §7 item 6, thermal throttling): 10 consecutive Strategist vs Beginner matches on
 * the app's lexicon, back to back with no think delay. One decision per step; only Strategist's decisions are
 * timed. Output per match: decisions, compute p50 and p95 in µs (drift = last match vs first).
 *
 * Every match is played from the same seed (review C-5): the bots are deterministic, so the 10 matches make the same
 * decisions and any change of p95 between them is the device (heat, throttling, GC), not the positions. "Run all"
 * runs this suite first, right after the settle delay (`RUN_ALL_ORDER`). The clock is probed first (review C-4).
 */
import { apply, observe, type MatchState } from '@codelex/game-engine';
import {
  benchDecision,
  benchSeed,
  distribution,
  playBenchStep,
  startBenchMatch,
} from '@codelex/golden-runner/core';
import type { LexiconIndex } from '@codelex/lexicon/index';

import { CLOCK_RESOLUTION, clockUsable, type Clock, type Job } from './job';

/** A2 `DRIFT_MATCHES`. */
export const DRIFT_MATCH_COUNT = 10;
/** Seed `seedOf(9500)` for every match, away from the P5 §2 positions (9000+) and the resume fixtures (9400+). */
export const DRIFT_SEED = 9500;
/** Strategist's seat; Beginner plays seat 0. */
export const DRIFT_STRATEGIST_SEAT = 1;

export interface DriftMatch {
  readonly decisions: number;
  readonly computeP50: number;
  readonly computeP95: number;
}

export type DriftResult =
  | { readonly kind: 'measured'; readonly matches: readonly DriftMatch[] }
  | {
      readonly kind: 'failed';
      readonly reason: 'no-decision' | 'clock' | typeof CLOCK_RESOLUTION;
    };

export function driftJob(
  lexicon: LexiconIndex,
  clock: Clock,
  matchCount: number = DRIFT_MATCH_COUNT,
): Job<DriftResult> {
  const perMatch: number[][] = [];
  let match = 0;
  let state: MatchState | null = null;
  let current: number[] = [];
  let probed = false;
  let coarse = false;

  const step = (): void => {
    state ??= startBenchMatch(lexicon, benchSeed(DRIFT_SEED));
    if (state.seatOnTurn === DRIFT_STRATEGIST_SEAT) {
      const position = {
        id: `${state.seed}/${String(state.actionCount)}`,
        seed: state.seed,
        observation: observe(state, state.seatOnTurn),
      };
      const start = clock();
      const decided = benchDecision(lexicon, position, 'strategist');
      const end = clock();
      if (!decided.ok) throw new Error(decided.error.code);
      current.push((end - start) * 1000);
      const applied = apply(state, decided.value.action, { lexicon });
      if (!applied.ok) throw new Error(applied.error.code);
      state = applied.value.state;
    } else {
      state = playBenchStep(lexicon, state, 'beginner');
    }
    if (state.status !== 'in_progress') {
      perMatch.push(current);
      current = [];
      state = null;
      match += 1;
    }
  };

  return {
    suite: 'drift',
    timed: true,
    step() {
      if (match >= matchCount || coarse) return false;
      if (!probed) {
        probed = true;
        coarse = !clockUsable(clock);
        if (coarse) return false;
      }
      step();
      return match < matchCount;
    },
    progress: () => ({ done: match, total: matchCount }),
    result() {
      if (coarse) return { kind: 'failed', reason: CLOCK_RESOLUTION };
      const matches: DriftMatch[] = [];
      for (const times of perMatch) {
        const d = distribution(times);
        if (times.length === 0) return { kind: 'failed', reason: 'no-decision' };
        if (d === null) return { kind: 'failed', reason: 'clock' };
        matches.push({ decisions: d.samples, computeP50: d.p50, computeP95: d.p95 });
      }
      return { kind: 'measured', matches };
    },
    dispose() {
      // Memory only.
    },
  };
}
