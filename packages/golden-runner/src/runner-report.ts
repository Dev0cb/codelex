/**
 * Runner report, `runnerFormat` 1 (ADR-0016 §D3.1). Frozen: any change to what this schema accepts or produces is
 * a `runnerFormat` bump with a new schema next to this one, never an edit of this one.
 *
 * Rules of §D3.1 enforced here:
 * - every value is in the ADR-0013 §D3 JCS subset (printable ASCII strings, safe integers, no booleans or null);
 * - `observed` holds what the runtime computed and is at most 1 KB of canonical JSON (larger values are reported
 *   as their SHA-256 by the runner);
 * - `errorCode` exists only on `error` cases, `observed` only on `pass` and `fail` cases;
 * - suite ids and case ids are unique, summaries match the cases and the verdict matches the summaries;
 * - no unknown keys anywhere: device model, OS, install ids or user data cannot enter a runner report (they
 *   belong only to the preview Diagnostics wrapper);
 * - the canonical report is at most 256 KB.
 */
import { err, ok, type Result } from '@codelex/config/result';
import { z } from 'zod';

import { CHANGED_BY_PARSING, issuesOf, parseJsonText, type ReportIssue } from './issues.js';
import {
  canonicalOrUndefined,
  jcsCount,
  jcsPositive,
  jcsText,
  exceedsDepth,
  jcsValue,
  MAX_DEPTH,
  sameCanonical,
  SHA256_HEX,
  tooDeepMessage,
} from './jcs.js';

export const RUNNER_FORMAT = 1;

/** ADR-0016 §D3.1 / §D7: a runner report stays under 256 KB. */
export const RUNNER_REPORT_MAX_BYTES = 256 * 1024;

/** §D3.1: `observed` holds the value itself up to 1 KB, its SHA-256 above. */
export const OBSERVED_MAX_BYTES = 1024;

const ID_MAX = 128;
const VERSION_MAX = 64;
const ERROR_CODE_MAX = 64;

/**
 * Suite ids: lowercase segments separated by `/` or `-`, e.g. `rng`, `scoring/v1`, `replays/v2`,
 * `bots/decisions-b2-r1`. A pattern rather than an enum, so a new frozen rules version adds a suite without a
 * format bump (§D3 item 3).
 */
export const SUITE_ID = /^[a-z0-9]+(?:[/-][a-z0-9]+)*$/;

/** Typed error names (`RULES_VERSION_UNSUPPORTED`, `RangeError`): never a message, never a stack trace. */
export const ERROR_CODE = /^[A-Za-z][A-Za-z0-9_]*$/;

export const suiteIdSchema = jcsText(ID_MAX).regex(SUITE_ID, {
  message: 'suite id must be lowercase segments separated by "/" or "-"',
});

const caseIdSchema = jcsText(ID_MAX);

/**
 * `observed` nests at most 32 levels, so a report stays within the serialiser's 64 even inside the Diagnostics
 * wrapper (report 5 levels + wrapper 1 + observed 32).
 */
export const OBSERVED_MAX_DEPTH = 32;

const observedSchema = jcsValue.superRefine((value, ctx) => {
  if (exceedsDepth(value, OBSERVED_MAX_DEPTH)) {
    ctx.addIssue({ code: 'custom', message: `observed is ${tooDeepMessage(OBSERVED_MAX_DEPTH)}` });
    return;
  }
  const text = canonicalOrUndefined(value);
  if (text === undefined || text.length > OBSERVED_MAX_BYTES) {
    ctx.addIssue({
      code: 'custom',
      message: `observed must be at most ${String(OBSERVED_MAX_BYTES)} bytes of canonical JSON (report its SHA-256 instead)`,
    });
  }
});

export const runtimeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('node'), version: jcsText(VERSION_MAX) }),
  z.strictObject({
    kind: z.enum(['hermes-cli', 'hermes-app']),
    version: jcsText(VERSION_MAX),
    bytecodeVersion: jcsCount,
  }),
]);

export const corpusSchema = z.strictObject({
  /** SHA-256 hex of the JCS of `{ path: content }` for every corpus file. */
  digest: jcsText(64).regex(SHA256_HEX, { message: 'digest must be 64 lowercase hex chars' }),
  engineRulesVersions: z
    .array(jcsPositive)
    .min(1)
    .refine((versions) => versions.every((v, i) => i === 0 || (versions[i - 1] ?? v) < v), {
      message: 'engineRulesVersions must be strictly ascending',
    }),
  botVersion: jcsPositive,
});

export const caseSchema = z.discriminatedUnion('status', [
  z.strictObject({ id: caseIdSchema, status: z.literal('pass'), observed: observedSchema }),
  z.strictObject({ id: caseIdSchema, status: z.literal('fail'), observed: observedSchema }),
  z.strictObject({
    id: caseIdSchema,
    status: z.literal('error'),
    errorCode: jcsText(ERROR_CODE_MAX).regex(ERROR_CODE, {
      message: 'errorCode must be a typed error name',
    }),
  }),
]);

export const summarySchema = z.strictObject({ pass: jcsCount, fail: jcsCount, error: jcsCount });

export const suiteSchema = z
  .strictObject({
    id: suiteIdSchema,
    cases: z.array(caseSchema).min(1),
    summary: summarySchema,
  })
  .superRefine((suite, ctx) => {
    const seen = new Set<string>();
    suite.cases.forEach((c, i) => {
      if (seen.has(c.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cases', i, 'id'],
          message: `duplicate case id "${c.id}"`,
        });
      }
      seen.add(c.id);
    });
    const count = (status: 'pass' | 'fail' | 'error'): number =>
      suite.cases.filter((c) => c.status === status).length;
    for (const status of ['pass', 'fail', 'error'] as const) {
      if (suite.summary[status] !== count(status)) {
        ctx.addIssue({
          code: 'custom',
          path: ['summary', status],
          message: `summary.${status} is ${String(suite.summary[status])} but ${String(count(status))} cases have that status`,
        });
      }
    }
  });

export const timingsSchema = z.record(suiteIdSchema, z.strictObject({ totalMs: jcsCount }));

export const runnerReportSchema = z
  .strictObject({
    runnerFormat: z.literal(RUNNER_FORMAT),
    /** Not compared (§D3.2). */
    runtime: runtimeSchema,
    corpus: corpusSchema,
    suites: z.array(suiteSchema).min(1),
    verdict: z.enum(['pass', 'fail']),
    /** Optional and not compared (§D3.2); integer milliseconds per suite. */
    timings: timingsSchema.optional(),
  })
  .superRefine((report, ctx) => {
    const ids = new Set<string>();
    report.suites.forEach((suite, i) => {
      if (ids.has(suite.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['suites', i, 'id'],
          message: `duplicate suite id "${suite.id}"`,
        });
      }
      ids.add(suite.id);
    });
    const allPass = report.suites.every((suite) => suite.cases.every((c) => c.status === 'pass'));
    const expected = allPass ? 'pass' : 'fail';
    if (report.verdict !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['verdict'],
        message: `verdict must be "${expected}" for these cases`,
      });
    }
    for (const key of Object.keys(report.timings ?? {})) {
      if (!ids.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['timings', key],
          message: `timings for unknown suite "${key}"`,
        });
      }
    }
    const text = canonicalOrUndefined(report);
    if (text === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'report is outside the ADR-0013 §D3 subset',
      });
    } else if (text.length > RUNNER_REPORT_MAX_BYTES) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: `report is ${String(text.length)} canonical bytes, above the ${String(RUNNER_REPORT_MAX_BYTES)}-byte limit`,
      });
    }
  });

export type RunnerReport = z.infer<typeof runnerReportSchema>;
export type RunnerSuite = z.infer<typeof suiteSchema>;
export type RunnerCase = z.infer<typeof caseSchema>;
export type RunnerRuntime = z.infer<typeof runtimeSchema>;

/** Validates a runner report value (already decoded from JSON). */
export function parseRunnerReport(value: unknown): Result<RunnerReport, ReportIssue[]> {
  if (exceedsDepth(value, MAX_DEPTH))
    return err([{ path: '$', message: tooDeepMessage(MAX_DEPTH) }]);
  const parsed = runnerReportSchema.safeParse(value);
  if (!parsed.success) return err(issuesOf(parsed.error));
  return sameCanonical(value, parsed.data) ? ok(parsed.data) : err([CHANGED_BY_PARSING]);
}

/** Decodes and validates runner report text; text above 256 KB is rejected before decoding. */
export function parseRunnerReportText(text: string): Result<RunnerReport, ReportIssue[]> {
  const json = parseJsonText(text, RUNNER_REPORT_MAX_BYTES, 'runner report');
  return json.ok ? parseRunnerReport(json.value) : json;
}

/**
 * Size check of §D3.1 / §D7: the canonical size of `report` in bytes and whether it is within the 256 KB budget.
 * For runners to check before emitting; `undefined` size means the value is outside the JCS subset.
 */
export function checkRunnerReportSize(report: unknown): {
  readonly bytes: number | undefined;
  readonly withinLimit: boolean;
} {
  const text = canonicalOrUndefined(report);
  return {
    bytes: text?.length,
    withinLimit: text !== undefined && text.length <= RUNNER_REPORT_MAX_BYTES,
  };
}
