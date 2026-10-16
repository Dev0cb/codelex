/**
 * `@codelex/golden-runner/core` (ADR-0016 §D3 item 2): the pure runner core and the corpus, without zod or the
 * report schemas, so the Hermes CLI bundle and the app's Diagnostics screen (DG1) can embed it. Parsing and
 * comparison of reports stay in `@codelex/golden-runner` (Node). The bench helpers (`bench/`, DG1 note §5) are
 * pure too: the host supplies the clock.
 */
export { canonicalJson } from '@codelex/game-engine/canonical';
export {
  decisionEquality,
  EQUALITY_POSITIONS_PER_BOT,
  formsOf,
  gcDet01Fixture,
  seededNonWords,
  type DecisionEquality,
  type ReplayFixture,
} from './bench/fixtures.js';
export {
  BENCH_MAX_GAMES,
  BENCH_POSITIONS,
  BENCH_SEED_BASE,
  benchDecision,
  benchMatchConfig,
  benchRng,
  benchSeed,
  createPositionSource,
  playBenchStep,
  startBenchMatch,
  withTwoBlanks,
  type BenchPosition,
  type PositionSource,
} from './bench/positions.js';
export {
  distribution,
  fitConstants,
  MIN_FIT_SAMPLES,
  percentile,
  roundInt,
  type DecisionSample,
  type Distribution,
  type FittedConstants,
} from './bench/stats.js';
export { GOLDEN_CORPUS, type GoldenCorpus } from './corpus.js';
export { corpusDigest } from './digest.js';
export { GOLDEN_RUNNER_MARKER } from './marker.js';
export {
  engineRulesVersionsOf,
  runGoldens,
  runGoldensStepwise,
  SUITES,
  type GoldenProgress,
} from './run.js';
export type { CoreCase, CoreReport, CoreRuntime, CoreSuite, RunnerHost } from './types.js';
