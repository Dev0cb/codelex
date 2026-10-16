/**
 * `runGoldens` (ADR-0016 §D3 items 2–3): runs every suite of the corpus and returns the `runnerFormat` 1 report.
 * Pure: no I/O, no `Date`, no `Math.random`, no `Intl`, no `node:*`; the host injects its runtime block and,
 * optionally, a clock for `timings` (never compared). Suite order and case order are fixed (the order below and the
 * order of each golden file), so two runtimes produce byte-identical reports when they compute the same values.
 */
import { BOT_VERSION } from '@codelex/bots';

import { runCase, type CaseSpec } from './cases.js';
import {
  BOT_DECISIONS_PATH,
  REPLAY_GC_DET_01_LOG_PATH,
  SCORING_CLASSIC_PATH,
  SCORING_INFLECTIONS_PATH,
  type GoldenCorpus,
} from './corpus.js';
import { corpusDigest } from './digest.js';
import { BOTS_SUITE, botCases } from './suites/bots.js';
import { JCS_SUITE, jcsCases, SHA256_SUITE, sha256Cases } from './suites/hashing.js';
import { REPLAYS_V1_SUITE, replayCases } from './suites/replays.js';
import { RNG_SUITE, rngCases } from './suites/rng.js';
import { SCORING_V1_SUITE, scoringCases } from './suites/scoring.js';
import type { CoreCase, CoreReport, CoreSuite, RunnerHost } from './types.js';

/** Suites in report order (ADR-0016 §D3 item 3). */
export const SUITES: readonly {
  readonly id: string;
  readonly cases: (corpus: GoldenCorpus) => CaseSpec[];
}[] = [
  { id: RNG_SUITE, cases: rngCases },
  { id: SHA256_SUITE, cases: sha256Cases },
  { id: JCS_SUITE, cases: jcsCases },
  { id: SCORING_V1_SUITE, cases: scoringCases },
  { id: REPLAYS_V1_SUITE, cases: replayCases },
  { id: BOTS_SUITE, cases: botCases },
];

/** Rules versions the corpus pins (from the files themselves), ascending. */
export function engineRulesVersionsOf(corpus: GoldenCorpus): number[] {
  const versions = [
    corpus[SCORING_CLASSIC_PATH].engineRulesVersion,
    corpus[SCORING_INFLECTIONS_PATH].engineRulesVersion,
    corpus[REPLAY_GC_DET_01_LOG_PATH].header.engineRulesVersion,
    corpus[BOT_DECISIONS_PATH].engineRulesVersion,
  ];
  return [...new Set(versions)].sort((a, b) => a - b);
}

function summaryOf(cases: readonly CoreCase[]): CoreSuite['summary'] {
  const count = (status: CoreCase['status']): number =>
    cases.filter((c) => c.status === status).length;
  return { pass: count('pass'), fail: count('fail'), error: count('error') };
}

/** A suite whose case list cannot even be built (malformed file) reports one `error` case. */
function suitePlan(
  corpus: GoldenCorpus,
  build: (corpus: GoldenCorpus) => CaseSpec[],
): CaseSpec[] | CoreCase {
  let specs: CaseSpec[];
  try {
    specs = build(corpus);
  } catch {
    return { id: 'corpus', status: 'error', errorCode: 'CORPUS_MALFORMED' };
  }
  return specs.length === 0 ? { id: 'corpus', status: 'error', errorCode: 'CORPUS_EMPTY' } : specs;
}

/** Where a stepwise run is: after `done` of `total` cases, the last one in suite `suite`. */
export interface GoldenProgress {
  readonly suite: string;
  readonly done: number;
  readonly total: number;
}

/**
 * {@link runGoldens} one case at a time (ADR-0016 §D4, DG1 note §5.1): yields after every case, so an app host can
 * render progress and stop between cases (a case is never split). The generator's return value is the report;
 * {@link runGoldens} drains it, so both produce the same document. With a clock, a suite's `totalMs` is the sum
 * of its case intervals, so whatever the host does between two steps (rendering, yielding) is not counted.
 */
export function* runGoldensStepwise(
  corpus: GoldenCorpus,
  host: RunnerHost,
): Generator<GoldenProgress, CoreReport, void> {
  const plans = SUITES.map(({ id, cases: build }) => ({ id, plan: suitePlan(corpus, build) }));
  const total = plans.reduce((n, { plan }) => n + (Array.isArray(plan) ? plan.length : 1), 0);
  const timings: Record<string, { totalMs: number }> = {};
  const suites: CoreSuite[] = [];
  let done = 0;
  for (const { id, plan } of plans) {
    const cases: CoreCase[] = [];
    let elapsed = 0;
    for (const spec of Array.isArray(plan) ? plan : [null]) {
      const start = host.clock?.();
      cases.push(spec === null ? (plan as CoreCase) : runCase(spec));
      const end = host.clock?.();
      if (start !== undefined && end !== undefined) elapsed += end - start;
      done += 1;
      yield { suite: id, done, total };
    }
    if (host.clock !== undefined) timings[id] = { totalMs: Math.max(0, Math.floor(elapsed)) };
    suites.push({ id, cases, summary: summaryOf(cases) });
  }
  const verdict = suites.every((s) => s.summary.fail === 0 && s.summary.error === 0)
    ? 'pass'
    : 'fail';
  return {
    runnerFormat: 1,
    runtime: host.runtime,
    corpus: {
      digest: corpusDigest(corpus as unknown as Readonly<Record<string, unknown>>),
      engineRulesVersions: engineRulesVersionsOf(corpus),
      botVersion: BOT_VERSION,
    },
    suites,
    verdict,
    ...(host.clock === undefined ? {} : { timings }),
  };
}

/**
 * Runs the golden corpus (ADR-0016 §D3). A bad case never throws: it becomes `fail` or `error`, and a suite whose
 * file cannot be read becomes one `error` case. The corpus identity is computed outside any case, so a corpus that
 * is not JSON of safe integers (a fraction, `-0`) or lacks a rules version field throws (`RangeError` /
 * `TypeError`); hosts catch it (the Node host exits 2).
 */
export function runGoldens(corpus: GoldenCorpus, host: RunnerHost): CoreReport {
  const steps = runGoldensStepwise(corpus, host);
  for (;;) {
    const step = steps.next();
    if (step.done === true) return step.value;
  }
}
