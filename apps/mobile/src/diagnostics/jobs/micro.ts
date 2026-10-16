/**
 * Suite 2, micro-benches (DG1 note §5; sprint H1 row: `has()` p99, `apply` p95):
 * - `has()` on the app's loaded lexicon index, in batches of 1,000 calls over every bundled form and as many seeded
 *   non-words (round robin); one batch per step; the sample is the batch time / 1,000, in **ns** (a call takes about
 *   a microsecond, so integer µs would round most samples to 0 or 1);
 * - `apply` per action over the `replays/v1` log (GC-DET-01, 90 actions, on its frozen lexicon), one pass per step,
 *   each `apply` timed on its own, in µs. Match creation is outside the timed interval.
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

import type { Clock, Job } from './job';

export const HAS_BATCH = 1000;
export const HAS_BATCHES = 200;
export const APPLY_PASSES = 10;

export interface MicroResult {
  /** Per-call `has()` time in ns; null when not measurable (a broken clock). */
  readonly has: Distribution | null;
  /** Per-action `apply` time in µs; null when the replay is rejected (a fixture drift) or the clock is broken. */
  readonly apply: Distribution | null;
}

export interface MicroOptions {
  readonly hasBatches?: number;
  readonly applyPasses?: number;
  readonly corpus?: GoldenCorpus;
}

export function microJob(
  lexicon: LexiconIndex,
  clock: Clock,
  options: MicroOptions = {},
): Job<MicroResult> {
  const hasBatches = options.hasBatches ?? HAS_BATCHES;
  const applyPasses = options.applyPasses ?? APPLY_PASSES;
  const corpus = options.corpus ?? GOLDEN_CORPUS;
  let words: string[] | null = null;
  let cursor = 0;
  const hasNs: number[] = [];
  const applyUs: number[] = [];
  let applyRejected = false;
  let done = 0;
  const total = hasBatches + applyPasses;

  const hasBatch = (): void => {
    if (words === null) {
      const forms = formsOf(lexicon);
      words = [...forms, ...seededNonWords(lexicon, forms, forms.length)];
    }
    const list = words;
    let hits = 0;
    const start = clock();
    for (let i = 0; i < HAS_BATCH; i += 1) {
      if (lexicon.has(list[cursor] ?? '')) hits += 1;
      cursor = cursor + 1 === list.length ? 0 : cursor + 1;
    }
    const end = clock();
    // `hits` keeps the calls observable, so no engine can drop them as dead code.
    if (hits >= 0) hasNs.push(((end - start) * 1_000_000) / HAS_BATCH);
  };

  const applyPass = (): void => {
    const fixture = gcDet01Fixture(corpus);
    const created = createMatch(fixture.header, { lexicon: fixture.lexicon });
    if (!created.ok) {
      applyRejected = true;
      return;
    }
    let state: MatchState = created.value.state;
    for (const action of fixture.actions) {
      const start = clock();
      const applied = apply(state, action, { lexicon: fixture.lexicon });
      const end = clock();
      if (!applied.ok) {
        applyRejected = true;
        return;
      }
      applyUs.push((end - start) * 1000);
      state = applied.value.state;
    }
  };

  return {
    suite: 'micro',
    timed: true,
    step() {
      if (done >= total) return false;
      if (done < hasBatches) hasBatch();
      else applyPass();
      done += 1;
      return done < total;
    },
    progress: () => ({ done, total }),
    result: () => ({
      has: distribution(hasNs),
      apply: applyRejected ? null : distribution(applyUs),
    }),
    dispose() {
      // Memory only.
    },
  };
}
