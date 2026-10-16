/**
 * Suite 1, goldens (DG1 note §5; ADR-0016 §D3/§D4): the runner core on the app's Hermes, one golden case per step
 * (`runGoldensStepwise`), with the `hermes-app` runtime block. The report part is compared on a computer with the
 * Node report of the same commit and `corpus.digest` (§D3.2). Decision equality (P5 §7 item 4) is read off its
 * `bots/decisions-b2-r1` cases, so it costs no extra decision.
 */
import {
  GOLDEN_CORPUS,
  runGoldensStepwise,
  type CoreReport,
  type CoreRuntime,
  type GoldenCorpus,
} from '@codelex/golden-runner/core';

import type { Clock, Job } from './job';

export function goldensJob(
  runtime: CoreRuntime,
  clock: Clock,
  corpus: GoldenCorpus = GOLDEN_CORPUS,
): Job<CoreReport> {
  const steps = runGoldensStepwise(corpus, { runtime, clock });
  let done = 0;
  let total = 0;
  let report: CoreReport | null = null;
  return {
    suite: 'goldens',
    timed: false,
    step() {
      if (report !== null) return false;
      const next = steps.next();
      if (next.done === true) {
        report = next.value;
        return false;
      }
      ({ done, total } = next.value);
      return true;
    },
    progress: () => ({ done, total }),
    result() {
      if (report === null) throw new Error('goldens: not finished');
      return report;
    },
    dispose() {
      // Memory only.
    },
  };
}
