/**
 * Suite 2, micro-benches (DG1 note §5; sprint H1 row: `has()` p99, `apply` p95):
 * - `has()` on the app's loaded lexicon index, in batches of 1,000 calls over every bundled form interleaved with as
 *   many seeded non-words (true round robin: a hit, a miss, a hit…); one batch per step. The sample is the batch
 *   time / 1,000 in **ns**: a **batch mean** per call, so its p50/p99 are percentiles of batch means, not per-call
 *   percentiles (as the `game-engine-api.md` §18 footnote 1 reads the `apply` average). A call takes about a
 *   microsecond, so a per-call reading would be below the clock's resolution;
 * - `apply` per action over the `replays/v1` log (GC-DET-01, 90 actions, on its frozen lexicon), one pass per step,
 *   each `apply` timed on its own, in µs. Match creation is outside the timed interval.
 *
 * The first step probes the clock (review C-4: `not-measured` above 50 µs) and runs one discarded, untimed batch;
 * one discarded, untimed `apply` pass precedes the timed passes (inline caches, lazily compiled functions and the
 * allocator are warm before the first sample).
 */
import { apply, createMatch, type MatchState } from '@codelex/game-engine';
import {
  distribution,
  formsOf,
  gcDet01Fixture,
  GOLDEN_CORPUS,
  seededNonWords,
  type Distribution,
  type GoldenCorpus,
} from '@codelex/golden-runner/core';
import type { LexiconIndex } from '@codelex/lexicon/index';

import { CLOCK_RESOLUTION, clockUsable, type Clock, type Job } from './job';

export const HAS_BATCH = 1000;
export const HAS_BATCHES = 200;
export const APPLY_PASSES = 10;

export type MicroResult =
  | {
      readonly kind: 'measured';
      /** Per-call `has()` time in ns, as a batch mean (see the module comment); null on a broken clock. */
      readonly has: Distribution | null;
      /** Per-action `apply` time in µs; null when the replay is rejected (a fixture drift) or the clock is broken. */
      readonly apply: Distribution | null;
    }
  /** The clock is too coarse to time anything (review C-4). */
  | { readonly kind: 'failed'; readonly reason: typeof CLOCK_RESOLUTION };

export interface MicroOptions {
  readonly hasBatches?: number;
  readonly applyPasses?: number;
  readonly corpus?: GoldenCorpus;
}

/** `a[0], b[0], a[1], b[1], …`, then the rest of the longer list. */
export function interleave<T>(a: readonly T[], b: readonly T[]): T[] {
  const out: T[] = [];
  a.forEach((x, i) => {
    out.push(x, ...b.slice(i, i + 1));
  });
  out.push(...b.slice(a.length));
  return out;
}

/** The `has()` words: every bundled form, interleaved with as many seeded non-words. */
export function hasWords(lexicon: LexiconIndex): string[] {
  const forms = formsOf(lexicon);
  return interleave(forms, seededNonWords(lexicon, forms, forms.length));
}

export function microJob(
  lexicon: LexiconIndex,
  clock: Clock,
  options: MicroOptions = {},
): Job<MicroResult> {
  const hasBatches = options.hasBatches ?? HAS_BATCHES;
  const applyPasses = options.applyPasses ?? APPLY_PASSES;
  const corpus = options.corpus ?? GOLDEN_CORPUS;
  let words: string[] = [];
  let cursor = 0;
  const hasNs: number[] = [];
  const applyUs: number[] = [];
  let applyRejected = false;
  let coarse = false;
  let done = 0;
  // Steps: the probe and the `has()` warm-up, the timed batches, the `apply` warm-up, the timed passes.
  const total = 1 + hasBatches + 1 + applyPasses;

  /** 1,000 calls; the hit count keeps them observable, so no engine can drop them as dead code. */
  const batch = (): number => {
    let hits = 0;
    for (let i = 0; i < HAS_BATCH; i += 1) {
      if (lexicon.has(words[cursor] ?? '')) hits += 1;
      cursor = cursor + 1 === words.length ? 0 : cursor + 1;
    }
    return hits;
  };

  const hasBatch = (): void => {
    const start = clock();
    const hits = batch();
    const end = clock();
    if (hits >= 0) hasNs.push(((end - start) * 1_000_000) / HAS_BATCH);
  };

  const applyPass = (timed: boolean): void => {
    const fixture = gcDet01Fixture(corpus);
    const created = createMatch(fixture.header, { lexicon: fixture.lexicon });
    if (!created.ok) {
      applyRejected = true;
      return;
    }
    let state: MatchState = created.value.state;
    for (const action of fixture.actions) {
      const start = timed ? clock() : 0;
      const applied = apply(state, action, { lexicon: fixture.lexicon });
      const end = timed ? clock() : 0;
      if (!applied.ok) {
        applyRejected = true;
        return;
      }
      if (timed) applyUs.push((end - start) * 1000);
      state = applied.value.state;
    }
  };

  const step = (): void => {
    if (done === 0) {
      if (!clockUsable(clock)) {
        coarse = true;
        return;
      }
      words = hasWords(lexicon);
      batch();
    } else if (done <= hasBatches) {
      hasBatch();
    } else {
      applyPass(done > hasBatches + 1);
    }
  };

  return {
    suite: 'micro',
    timed: true,
    step() {
      if (done >= total || coarse) return false;
      step();
      done += 1;
      return done < total && !coarse;
    },
    progress: () => ({ done, total }),
    result: () =>
      coarse
        ? { kind: 'failed', reason: CLOCK_RESOLUTION }
        : {
            kind: 'measured',
            has: distribution(hasNs),
            apply: applyRejected ? null : distribution(applyUs),
          },
    dispose() {
      // Memory only.
    },
  };
}
