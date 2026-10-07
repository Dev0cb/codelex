/**
 * Public API of `@codelex/golden-runner` (ADR-0016 §D3). This release holds the contracts only: the runner report
 * (`runnerFormat` 1), the preview Diagnostics report (`diagnosticsFormat` 1) and the §D3.2 comparison. The runner
 * core (`runGoldens`) and its Node and Hermes hosts follow in the next task.
 */
export {
  checkRunnerReportSize,
  corpusSchema,
  ERROR_CODE,
  OBSERVED_MAX_BYTES,
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
  describeComparison,
  type ComparisonFailure,
  type ComparisonResult,
  type ComparisonSuccess,
  type ReportLocation,
  type ReportSide,
} from './compare.js';
export type { ReportIssue } from './issues.js';
export type { JcsValue } from './jcs.js';
