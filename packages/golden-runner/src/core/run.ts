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
function suiteCases(corpus: GoldenCorpus, build: (corpus: GoldenCorpus) => CaseSpec[]): CoreCase[] {
  let specs: CaseSpec[];
  try {
    specs = build(corpus);
  } catch {
    return [{ id: 'corpus', status: 'error', errorCode: 'CORPUS_MALFORMED' }];
  }
  return specs.length === 0
    ? [{ id: 'corpus', status: 'error', errorCode: 'CORPUS_EMPTY' }]
    : specs.map(runCase);
}

/**
 * Runs the golden corpus (ADR-0016 §D3). A bad case never throws: it becomes `fail` or `error`, and a suite whose
 * file cannot be read becomes one `error` case. The corpus identity is computed outside any case, so a corpus that
 * is not JSON of safe integers (a fraction, `-0`) or lacks a rules version field throws (`RangeError` /
 * `TypeError`); hosts catch it (the Node host exits 2).
 */
export function runGoldens(corpus: GoldenCorpus, host: RunnerHost): CoreReport {
  const timings: Record<string, { totalMs: number }> = {};
  const suites: CoreSuite[] = SUITES.map(({ id, cases: build }) => {
    const start = host.clock?.();
    const cases = suiteCases(corpus, build);
    const end = host.clock?.();
    if (start !== undefined && end !== undefined) {
      timings[id] = { totalMs: Math.max(0, Math.floor(end - start)) };
    }
    return { id, cases, summary: summaryOf(cases) };
  });
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
