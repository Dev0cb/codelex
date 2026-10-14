/**
 * Public API of `@codelex/golden-runner` (ADR-0016 §D3), Node side: the runner report (`runnerFormat` 1), the
 * preview Diagnostics report (`diagnosticsFormat` 1) and the §D3.2 comparison, all zod-based. The pure runner core
 * and corpus are the separate, zod-free entry `@codelex/golden-runner/core` (the only one an app bundle may import);
 * the Node and Hermes CLI hosts live in `src/host/` behind `bin/` and `scripts/`.
 */
export {
  checkRunnerReportSize,
  corpusSchema,
  ERROR_CODE,
  OBSERVED_MAX_BYTES,
  OBSERVED_MAX_DEPTH,
  parseRunnerReport,
  parseRunnerReportText,
  RUNNER_FORMAT,
  RUNNER_REPORT_MAX_BYTES,
  runnerReportSchema,
  SUITE_ID,
  type RunnerCase,
  type RunnerReport,
  type RunnerRuntime,
  type RunnerSuite,
} from './runner-report.js';
export {
  DECISION_POSITIONS_PER_BOT,
  DIAGNOSTICS_FORMAT,
  DIAGNOSTICS_REPORT_MAX_BYTES,
  diagnosticsReportSchema,
  DRIFT_MATCHES,
  parseDiagnosticsReport,
  parseDiagnosticsReportText,
  type DiagnosticsBenches,
  type DiagnosticsDevice,
  type DiagnosticsReport,
} from './diagnostics-report.js';
export {
  comparableView,
  compareReports,
  compareReportTexts,
  DEFAULT_RUNTIME_EXPECTATION,
  DESCRIBED_ISSUES_MAX,
  describeComparison,
  type CompareOptions,
  type ComparisonFailure,
  type ComparisonResult,
  type ComparisonSuccess,
  type ReportLocation,
  type ReportSide,
  type RuntimeExpectation,
  type RuntimeKind,
} from './compare.js';
export type { ReportIssue } from './issues.js';
export type { JcsValue } from './jcs.js';
