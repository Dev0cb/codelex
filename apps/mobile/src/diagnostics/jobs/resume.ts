/**
 * Suite 4, resume probe (DG1 note §5.2; sprint H1 row: resume p95; `game-engine-api.md` Q7 budget p95 ≤ 300 ms):
 *
 * 1. Fixtures built on the device: 3 seeded Beginner vs Beginner matches on the app's lexicon (one decision per
 *    step), journals cut at 30, 60 and 90 actions — clamped to the last in-progress action, because matches on the
 *    shipped lexicon end after about 45–52 actions — each with the production snapshot cadence
 *    (`SNAPSHOT_EVERY`) and without any snapshot (full replay).
 * 2. Written with the production `createPersistence`/`MatchJournal` code to the scratch store in the cache, never to
 *    `codelex-data` (DS-6), one fixture per step.
 * 3. 20 timed iterations per fixture, one per step: a fresh persistence object, then `openSavedMatch` from the call
 *    to the restored model (read, parse, snapshot plus tail, or full replay). The first render is not included, so
 *    the number is a lower bound of the Q7 budget.
 *
 * The scratch directory is deleted after the suite and on every other exit (`dispose`).
 */
import { apply, observe, stateHash, type Action, type MatchState } from '@codelex/game-engine';
import {
  benchDecision,
  benchMatchConfig,
  benchSeed,
  distribution,
  startBenchMatch,
  type Distribution,
} from '@codelex/golden-runner/core';
import type { LexiconIndex } from '@codelex/lexicon/index';

import { SNAPSHOT_EVERY } from '../../persistence/match-journal';
import { createPersistence, openSavedMatch } from '../../persistence/saved-match';
import type { ScratchStore } from '../scratch-fs';
import type { Clock, Job } from './job';

export const RESUME_MATCHES = 3;
export const RESUME_CUTS: readonly number[] = [30, 60, 90];
export const RESUME_ITERATIONS = 20;
/** Seeds `seedOf(9400 + match)`. */
export const RESUME_SEED_BASE = 9400;

export type ResumeResult =
  | { readonly kind: 'measured'; readonly timingUs: Distribution }
  /** A fixture did not restore as a resumable match (a persistence or engine regression), or a broken clock. */
  | { readonly kind: 'failed'; readonly reason: 'not-resumable' | 'clock' };

interface Fixture {
  readonly name: string;
  readonly match: number;
  readonly cut: number;
  readonly snapshots: boolean;
}

interface Played {
  readonly states: MatchState[];
  readonly actions: Action[];
}

/** The cuts of a match that ended after `length` actions (or did not end within the longest cut). */
export function cutsFor(length: number | null): number[] {
  const cuts = RESUME_CUTS.map((c) => (length === null ? c : Math.min(c, length - 1)));
  return [...new Set(cuts.filter((c) => c > 0))];
}

export interface ResumeOptions {
  readonly matches?: number;
  readonly iterations?: number;
}

export function resumeJob(
  lexicon: LexiconIndex,
  clock: Clock,
  store: ScratchStore,
  options: ResumeOptions = {},
): Job<ResumeResult> {
  const matchCount = options.matches ?? RESUME_MATCHES;
  const iterations = options.iterations ?? RESUME_ITERATIONS;
  const longest = Math.max(...RESUME_CUTS);
  const played: Played[] = [];
  const fixtures: Fixture[] = [];
  let current: Played | null = null;
  let written = 0;
  let measured = 0;
  let notResumable = false;
  const samples: number[] = [];
  // Phase totals for progress: the play phase counts matches, then fixtures and iterations.
  let phase: 'play' | 'write' | 'measure' | 'done' = 'play';

  const endMatch = (finishedAt: number | null): void => {
    if (current === null) return;
    const match = played.length;
    played.push(current);
    for (const cut of cutsFor(finishedAt)) {
      for (const snapshots of [true, false]) {
        fixtures.push({
          name: `m${String(match)}-a${String(cut)}-${snapshots ? 's' : 'n'}`,
          match,
          cut,
          snapshots,
        });
      }
    }
    current = null;
  };

  const playStep = (): void => {
    if (current === null) {
      const start = startBenchMatch(lexicon, benchSeed(RESUME_SEED_BASE + played.length));
      current = { states: [start], actions: [] };
    }
    const state = current.states.at(-1);
    if (state === undefined) throw new Error('resume: empty match');
    const decided = benchDecision(
      lexicon,
      { id: '', seed: state.seed, observation: observe(state, state.seatOnTurn) },
      'beginner',
    );
    if (!decided.ok) throw new Error(decided.error.code);
    const applied = apply(state, decided.value.action, { lexicon });
    if (!applied.ok) throw new Error(applied.error.code);
    const next = applied.value.state;
    current.states.push(next);
    current.actions.push(decided.value.action);
    if (next.status !== 'in_progress') endMatch(next.actionCount);
    else if (next.actionCount >= longest) endMatch(null);
  };

  const write = (fixture: Fixture): void => {
    const match = played[fixture.match];
    if (match === undefined) throw new Error('resume: no match');
    const persistence = createPersistence(store.fixture(fixture.name));
    const first = match.states[0];
    if (first === undefined) throw new Error('resume: no start');
    persistence.journal.start(benchMatchConfig(lexicon, first.seed));
    for (let i = 0; i < fixture.cut; i += 1) {
      const action = match.actions[i];
      const after = match.states[i + 1];
      if (action === undefined || after === undefined) throw new Error('resume: short match');
      if (!persistence.journal.commit(action, stateHash(after))) throw new Error('resume: write');
      if (fixture.snapshots && after.actionCount % SNAPSHOT_EVERY === 0) {
        persistence.journal.snapshot(after);
      }
    }
  };

  const measure = (fixture: Fixture): void => {
    const persistence = createPersistence(store.fixture(fixture.name));
    const start = clock();
    const saved = openSavedMatch(persistence, { lexicon });
    const end = clock();
    if (saved.kind !== 'resumable') notResumable = true;
    samples.push((end - start) * 1000);
  };

  const totalSteps = (): number => fixtures.length * (1 + iterations);

  return {
    suite: 'resume',
    timed: true,
    step() {
      switch (phase) {
        case 'play':
          playStep();
          if (played.length >= matchCount) phase = 'write';
          return true;
        case 'write': {
          const fixture = fixtures[written];
          if (fixture !== undefined) write(fixture);
          written += 1;
          if (written >= fixtures.length) phase = 'measure';
          return true;
        }
        case 'measure': {
          const fixture = fixtures[Math.floor(measured / iterations)];
          if (fixture !== undefined) measure(fixture);
          measured += 1;
          if (measured >= fixtures.length * iterations) {
            phase = 'done';
            store.clear();
            return false;
          }
          return true;
        }
        case 'done':
          return false;
      }
    },
    progress: () => ({
      done: phase === 'play' ? 0 : written + measured,
      total:
        phase === 'play' ? matchCount * cutsFor(null).length * 2 * (1 + iterations) : totalSteps(),
    }),
    result() {
      if (notResumable) return { kind: 'failed', reason: 'not-resumable' };
      const timingUs = distribution(samples);
      return timingUs === null
        ? { kind: 'failed', reason: 'clock' }
        : { kind: 'measured', timingUs };
    },
    dispose() {
      store.clear();
    },
  };
}
