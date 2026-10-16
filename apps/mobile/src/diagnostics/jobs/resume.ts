/**
 * Suite 4, resume probe (DG1 note §5.2; sprint H1 row: resume p95; `game-engine-api.md` Q7 budget p95 ≤ 300 ms):
 *
 * 1. Fixtures built on the device: 3 seeded Beginner vs Beginner matches on the app's lexicon (one decision per
 *    step). Two restore paths, each with its own worst-case cuts (review C-M2):
 *    - **full replay** (no snapshot): journals cut at 30, 60 and 90 actions, clamped to the last in-progress action
 *      (matches on the shipped lexicon end after about 45–52 actions), so the longest journal is replayed;
 *    - **snapshot + tail** (the production cadence, `SNAPSHOT_EVERY` = 10): journals cut at k × 10 − 1 (29, 59, 89,
 *      clamped the same way and rounded down to that form), so every restore replays the longest tail, 9 actions.
 * 2. Written with the production `createPersistence`/`MatchJournal` code to the scratch store in the cache, never to
 *    `codelex-data` (DS-6), one fixture per step.
 * 3. 20 timed iterations per fixture, one per step: a fresh persistence object, then `openSavedMatch` from the call
 *    to the restored model (read, parse, snapshot plus tail, or full replay). The first render is not included, so
 *    the number is a lower bound of the Q7 budget. Each sample goes to the path the restore actually took.
 *    Iterations re-read the same files, so the numbers are **warm-cache** (OS page cache): a cold start after a
 *    kill can be slower.
 *
 * The two paths are reported separately; the A2 `resume` field carries the worst one, full replay. The clock is
 * probed first (review C-4). The scratch directory is deleted after the suite and on every other exit (`dispose`).
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
import { CLOCK_RESOLUTION, clockUsable, type Clock, type Job } from './job';

export const RESUME_MATCHES = 3;
export const RESUME_CUTS: readonly number[] = [30, 60, 90];
export const RESUME_ITERATIONS = 20;
/** Seeds `seedOf(9400 + match)`. */
export const RESUME_SEED_BASE = 9400;

export type ResumeResult =
  | {
      readonly kind: 'measured';
      /** Restores without a snapshot: the whole journal replayed (the A2 `resume` field, the worst path). */
      readonly fullReplay: Distribution;
      /** Restores from the last snapshot plus a 9-action tail. */
      readonly snapshotTail: Distribution;
    }
  /**
   * A fixture did not restore as a resumable match (a persistence or engine regression), no fixture of a path was
   * written, the clock is broken, or it is too coarse.
   */
  | {
      readonly kind: 'failed';
      readonly reason: 'not-resumable' | 'no-fixture' | 'clock' | typeof CLOCK_RESOLUTION;
    };

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

const clamp = (length: number | null) => (cut: number) =>
  length === null ? cut : Math.min(cut, length - 1);
const distinctPositive = (cuts: number[]): number[] => [...new Set(cuts.filter((c) => c > 0))];

/** Full-replay cuts of a match that ended after `length` actions (or did not end within the longest cut). */
export function fullReplayCuts(length: number | null): number[] {
  return distinctPositive(RESUME_CUTS.map(clamp(length)));
}

/** Snapshot cuts: the full-replay cuts minus one, clamped, rounded down to k × SNAPSHOT_EVERY − 1. */
export function snapshotCuts(length: number | null): number[] {
  return distinctPositive(
    RESUME_CUTS.map((c) => clamp(length)(c - 1)).map(
      (c) => Math.floor((c + 1) / SNAPSHOT_EVERY) * SNAPSHOT_EVERY - 1,
    ),
  );
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
  let coarse = false;
  const fullSamples: number[] = [];
  const snapshotSamples: number[] = [];
  let phase: 'probe' | 'play' | 'write' | 'measure' | 'done' = 'probe';

  const endMatch = (finishedAt: number | null): void => {
    if (current === null) return;
    const match = played.length;
    played.push(current);
    const add = (cuts: number[], snapshots: boolean): void => {
      for (const cut of cuts) {
        fixtures.push({
          name: `m${String(match)}-a${String(cut)}-${snapshots ? 's' : 'n'}`,
          match,
          cut,
          snapshots,
        });
      }
    };
    add(snapshotCuts(finishedAt), true);
    add(fullReplayCuts(finishedAt), false);
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
    if (saved.kind !== 'resumable') {
      notResumable = true;
      return;
    }
    (saved.path === 'snapshot' ? snapshotSamples : fullSamples).push((end - start) * 1000);
  };

  const totalSteps = (): number => fixtures.length * (1 + iterations);
  const plannedFixtures = matchCount * (fullReplayCuts(null).length + snapshotCuts(null).length);

  return {
    suite: 'resume',
    timed: true,
    step() {
      switch (phase) {
        case 'probe':
          if (!clockUsable(clock)) {
            coarse = true;
            phase = 'done';
            return false;
          }
          phase = 'play';
          return true;
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
      done: phase === 'probe' || phase === 'play' ? 0 : written + measured,
      total:
        phase === 'probe' || phase === 'play' ? plannedFixtures * (1 + iterations) : totalSteps(),
    }),
    result() {
      if (coarse) return { kind: 'failed', reason: CLOCK_RESOLUTION };
      if (notResumable) return { kind: 'failed', reason: 'not-resumable' };
      if (fullSamples.length === 0 || snapshotSamples.length === 0) {
        return { kind: 'failed', reason: 'no-fixture' };
      }
      const fullReplay = distribution(fullSamples);
      const snapshotTail = distribution(snapshotSamples);
      return fullReplay === null || snapshotTail === null
        ? { kind: 'failed', reason: 'clock' }
        : { kind: 'measured', fullReplay, snapshotTail };
    },
    dispose() {
      store.clear();
    },
  };
}
