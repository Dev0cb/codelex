/**
 * Report comparison of ADR-0016 §D3.2. Parses both reports with the `runnerFormat` 1 schema (a Diagnostics report
 * is accepted on either side and contributes its embedded runner report), removes `runtime` and `timings`, and
 * compares the bytes of the engine's own JCS serialiser (`@codelex/game-engine/canonical`, ADR-0013 §D3).
 *
 * Pass means: both parse, the canonical bytes are equal and the verdict is `pass`. Failures are typed and name
 * the first differing suite and case (or the first case that did not pass), with both values as canonical JSON.
 */
import { err, ok, type Result } from '@codelex/config/result';
import { canonicalJson } from '@codelex/game-engine/canonical';

import { DIAGNOSTICS_REPORT_MAX_BYTES, parseDiagnosticsReport } from './diagnostics-report.js';
import { formatPath, parseJsonText, type ReportIssue } from './issues.js';
import { parseRunnerReport, type RunnerReport } from './runner-report.js';

export type ReportSide = 'reference' | 'candidate';

/** Where two reports first differ. `suiteId` / `caseId` are set when the difference is inside one. */
export interface ReportLocation {
  readonly path: string;
  readonly suiteId?: string;
  readonly caseId?: string;
}

export type ComparisonFailure =
  | {
      readonly kind: 'invalid-report';
      readonly side: ReportSide;
      readonly issues: readonly ReportIssue[];
    }
  | {
      readonly kind: 'mismatch';
      readonly location: ReportLocation;
      /** Canonical JSON of the reference value at `location.path`, `null` when absent there. */
      readonly reference: string | null;
      /** Canonical JSON of the candidate value at `location.path`, `null` when absent there. */
      readonly candidate: string | null;
    }
  | {
      /** Both reports are equal but a case did not pass (the same case on both runtimes). */
      readonly kind: 'not-passing';
      readonly location: ReportLocation;
      readonly status: 'fail' | 'error';
    };

export interface ComparisonSuccess {
  /** The compared canonical bytes (identical for both reports). */
  readonly canonical: string;
  readonly suites: number;
  readonly cases: number;
}

export type ComparisonResult = Result<ComparisonSuccess, ComparisonFailure>;

/** The part of a runner report that is compared: everything but `runtime` and `timings`. */
export function comparableView(report: RunnerReport): Omit<RunnerReport, 'runtime' | 'timings'> {
  return {
    runnerFormat: report.runnerFormat,
    corpus: report.corpus,
    suites: report.suites,
    verdict: report.verdict,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A Diagnostics report (it has `diagnosticsFormat`) or a bare runner report, reduced to its runner report. */
function runnerReportOf(value: unknown, side: ReportSide): Result<RunnerReport, ComparisonFailure> {
  const parsed =
    isRecord(value) && 'diagnosticsFormat' in value
      ? mapOk(parseDiagnosticsReport(value), (d) => d.runner)
      : parseRunnerReport(value);
  return parsed.ok ? parsed : err({ kind: 'invalid-report', side, issues: parsed.error });
}

function mapOk<T, U, E>(result: Result<T, E>, f: (value: T) => U): Result<U, E> {
  return result.ok ? ok(f(result.value)) : result;
}

type Path = (string | number)[];

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Path to the first difference between two documents of the JCS subset, in canonical order (object keys by code
 * unit, array items by index), or `undefined` if they are equal.
 */
function firstDifference(a: unknown, b: unknown, path: Path): Path | undefined {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (i >= a.length || i >= b.length) return [...path, i];
      const found = firstDifference(a[i], b[i], [...path, i]);
      if (found) return found;
    }
    return undefined;
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(byCodeUnit);
    for (const key of keys) {
      if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) return [...path, key];
      const found = firstDifference(a[key], b[key], [...path, key]);
      if (found) return found;
    }
    return undefined;
  }
  return a === b ? undefined : path;
}

function valueAt(document: unknown, path: Path): unknown {
  let current: unknown = document;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === 'number') current = current[segment];
    else if (isRecord(current) && typeof segment === 'string' && Object.hasOwn(current, segment))
      current = current[segment];
    else return undefined;
  }
  return current;
}

function canonicalAt(document: unknown, path: Path): string | null {
  const value = valueAt(document, path);
  return value === undefined ? null : canonicalJson(value);
}

/** Names the suite and case of `path` (`$.suites[i].cases[j]…`), from whichever report has them. */
function locate(path: Path, ...reports: readonly RunnerReport[]): ReportLocation {
  const [root, suiteIndex, casesKey, caseIndex] = path;
  let suiteId: string | undefined;
  let caseId: string | undefined;
  if (root === 'suites' && typeof suiteIndex === 'number') {
    for (const report of reports) {
      const suite = report.suites[suiteIndex];
      suiteId ??= suite?.id;
      if (casesKey === 'cases' && typeof caseIndex === 'number')
        caseId ??= suite?.cases[caseIndex]?.id;
    }
  }
  return {
    path: formatPath(path),
    ...(suiteId === undefined ? {} : { suiteId }),
    ...(caseId === undefined ? {} : { caseId }),
  };
}

/**
 * Compares two decoded reports (runner or Diagnostics). `reference` is normally the Node report of the same
 * commit; `candidate` the Hermes CLI report or a device Diagnostics report.
 */
export function compareReports(reference: unknown, candidate: unknown): ComparisonResult {
  const ref = runnerReportOf(reference, 'reference');
  if (!ref.ok) return ref;
  const cand = runnerReportOf(candidate, 'candidate');
  if (!cand.ok) return cand;

  const refView = comparableView(ref.value);
  const candView = comparableView(cand.value);
  const refBytes = canonicalJson(refView);
  const candBytes = canonicalJson(candView);

  if (refBytes !== candBytes) {
    // Canonical texts differ, so the documents differ somewhere; `[]` (the root) is a defensive fallback only.
    const path = firstDifference(refView, candView, []) ?? [];
    return err({
      kind: 'mismatch',
      location: locate(path, ref.value, cand.value),
      reference: canonicalAt(refView, path),
      candidate: canonicalAt(candView, path),
    });
  }

  let cases = 0;
  for (const [s, suite] of ref.value.suites.entries()) {
    for (const [c, testCase] of suite.cases.entries()) {
      cases += 1;
      if (testCase.status !== 'pass') {
        return err({
          kind: 'not-passing',
          location: locate(['suites', s, 'cases', c], ref.value),
          status: testCase.status,
        });
      }
    }
  }
  return ok({ canonical: refBytes, suites: ref.value.suites.length, cases });
}

/**
 * Compares two report texts. Each text is decoded within the Diagnostics size budget, then read as a Diagnostics
 * report if its top level has `diagnosticsFormat` and as a runner report otherwise (whose schema enforces the
 * 256 KB runner budget on the canonical bytes).
 */
export function compareReportTexts(referenceText: string, candidateText: string): ComparisonResult {
  const ref = decode(referenceText, 'reference');
  if (!ref.ok) return ref;
  const cand = decode(candidateText, 'candidate');
  if (!cand.ok) return cand;
  return compareReports(ref.value, cand.value);
}

function decode(text: string, side: ReportSide): Result<unknown, ComparisonFailure> {
  const parsed = parseJsonText(text, DIAGNOSTICS_REPORT_MAX_BYTES, `${side} report`);
  return parsed.ok ? parsed : err({ kind: 'invalid-report', side, issues: parsed.error });
}

/** One line per failure, for CI logs (§D3.2: "prints the first differing suite and case and both values"). */
export function describeComparison(result: ComparisonResult): string {
  if (result.ok) {
    return `golden reports equal: ${String(result.value.suites)} suites, ${String(result.value.cases)} cases, verdict pass`;
  }
  const failure = result.error;
  switch (failure.kind) {
    case 'invalid-report':
      return `${failure.side} report is invalid: ${failure.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`;
    case 'mismatch':
      return `reports differ at ${where(failure.location)}: reference ${failure.reference ?? '(absent)'}, candidate ${failure.candidate ?? '(absent)'}`;
    case 'not-passing':
      return `reports are equal but ${where(failure.location)} has status ${failure.status} on both runtimes`;
  }
}

function where(location: ReportLocation): string {
  const named = [
    location.suiteId === undefined ? '' : `suite "${location.suiteId}"`,
    location.caseId === undefined ? '' : `case "${location.caseId}"`,
  ].filter((part) => part !== '');
  return named.length === 0 ? location.path : `${named.join(' ')} (${location.path})`;
}
