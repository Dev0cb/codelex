/**
 * `@codelex/golden-runner/core` (ADR-0016 §D3 item 2): the pure runner core and the corpus, without zod or the
 * report schemas, so the Hermes CLI bundle and the app's Diagnostics screen (DG1) can embed it. Parsing and
 * comparison of reports stay in `@codelex/golden-runner` (Node).
 */
export { canonicalJson } from '@codelex/game-engine/canonical';
export { GOLDEN_CORPUS, type GoldenCorpus } from './corpus.js';
export { corpusDigest } from './digest.js';
export { engineRulesVersionsOf, runGoldens, SUITES } from './run.js';
export type { CoreCase, CoreReport, CoreRuntime, CoreSuite, RunnerHost } from './types.js';
