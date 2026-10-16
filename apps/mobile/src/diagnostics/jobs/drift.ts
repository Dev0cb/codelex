/**
 * Suite 5, drift (DG1 note §5; P5 §7 item 6, thermal throttling): 10 consecutive Strategist vs Beginner matches on
 * the app's lexicon, back to back with no think delay. One decision per step; only Strategist's decisions are
 * timed. Output per match: decisions, compute p50 and p95 in µs (drift = last match vs first).
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

import type { Clock, Job } from './job';

/** A2 `DRIFT_MATCHES`. */
export const DRIFT_MATCH_COUNT = 10;
/** Seeds `seedOf(9500 + match)`, away from the P5 §2 positions (9000+) and the resume fixtures (9400+). */
export const DRIFT_SEED_BASE = 9500;
/** Strategist's seat; Beginner plays seat 0. */
export const DRIFT_STRATEGIST_SEAT = 1;

export interface DriftMatch {
  readonly decisions: number;
  readonly computeP50: number;
  readonly computeP95: number;
}

export type DriftResult =
  | { readonly kind: 'measured'; readonly matches: readonly DriftMatch[] }
  | { readonly kind: 'failed'; readonly reason: 'no-decision' | 'clock' };

export function driftJob(
  lexicon: LexiconIndex,
  clock: Clock,
  matchCount: number = DRIFT_MATCH_COUNT,
): Job<DriftResult> {
  const perMatch: number[][] = [];
  let match = 0;
  let state: MatchState | null = null;
  let current: number[] = [];

  const step = (): void => {
    state ??= startBenchMatch(lexicon, benchSeed(DRIFT_SEED_BASE + match));
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
      if (match >= matchCount) return false;
      step();
      return match < matchCount;
    },
    progress: () => ({ done: match, total: matchCount }),
    result() {
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
