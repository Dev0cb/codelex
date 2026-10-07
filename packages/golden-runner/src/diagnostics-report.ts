/**
 * Diagnostics report, `diagnosticsFormat` 1: the wrapper the preview-only Diagnostics screen (DG1) shares
 * (ADR-0016 §D3.2, §D4; E-1.5 spec "Device timings (H1)"; bots-off-ui-thread note §7). Frozen like the runner
 * report: changes are a `diagnosticsFormat` bump.
 *
 * Privacy (CLAUDE.md §1.7, sprint 4 A2): the device block names only what an H1 result must name (phone model, RAM,
 * OS version; spec "Device timings (H1)") plus the device-class label. No install id, user id, serial, IMEI,
 * advertising id, locale, time zone or timestamp: the spec does not need them, the report is shared by the owner
 * through the OS share sheet, and the runner report is compared by commit and `corpus.digest`, never by device.
 * Unknown keys are rejected everywhere. `build.profile` is the literal `preview`: device data is allowed only in
 * preview builds.
 *
 * Timings: integers with an explicit `unit` (`ns`, `us` or `ms`), so the document stays in the ADR-0013 §D3 JCS
 * subset (no fractions); a host converts a float reading with `Math.round` in the unit it picked.
 */
import { err, ok, type Result } from '@codelex/config/result';
import { z } from 'zod';

import { CHANGED_BY_PARSING, issuesOf, parseJsonText, type ReportIssue } from './issues.js';
import { jcsCount, jcsPositive, jcsText, sameCanonical } from './jcs.js';
import { RUNNER_REPORT_MAX_BYTES, runnerReportSchema } from './runner-report.js';

export const DIAGNOSTICS_FORMAT = 1;

/**
 * Text budget of a Diagnostics report, checked before decoding: the runner report budget plus 64 KB. The schema
 * bounds every wrapper field and list, so a valid wrapper is a few kilobytes and the runner report keeps its own
 * 256 KB limit. ASSUMPTION (ADR-0016 sets only the runner budget): the 64 KB margin also covers pretty-printing.
 */
export const DIAGNOSTICS_REPORT_MAX_BYTES = RUNNER_REPORT_MAX_BYTES + 64 * 1024;

/** Positions per bot in the decision-equality bench (note §7.4: 20 golden positions per bot). */
export const DECISION_POSITIONS_PER_BOT = 20;

/** Consecutive matches of the sustained-play bench (note §7.6). */
export const DRIFT_MATCHES = 10;

/** Bound on per-bot lists (four personalities today: random-legal, greedy, beginner, strategist). */
const MAX_BOTS = 16;

export const timeUnitSchema = z.enum(['ns', 'us', 'ms']);

const GIT_SHA = /^[0-9a-f]{40}$/;
const BOT_ID = /^[a-z][a-z0-9-]*$/;

const botIdSchema = jcsText(32).regex(BOT_ID, { message: 'bot id must be a personality id' });

function ordered(d: { p50: number; p95: number; p99: number; max: number }): boolean {
  return d.p50 <= d.p95 && d.p95 <= d.p99 && d.p99 <= d.max;
}
const ORDER_MESSAGE = 'percentiles must satisfy p50 <= p95 <= p99 <= max';

/** Percentiles of a count (nodes, candidates). */
export const countDistributionSchema = z
  .strictObject({ p50: jcsCount, p95: jcsCount, p99: jcsCount, max: jcsCount })
  .refine(ordered, { message: ORDER_MESSAGE });

/** Percentiles of a duration, integer values in `unit`, over `samples` measurements. */
export const timingDistributionSchema = z
  .strictObject({
    unit: timeUnitSchema,
    samples: jcsPositive,
    p50: jcsCount,
    p95: jcsCount,
    p99: jcsCount,
    max: jcsCount,
  })
  .refine(ordered, { message: ORDER_MESSAGE });

/** One constant, integer `value` in `unit`. */
export const timingValueSchema = z.strictObject({ unit: timeUnitSchema, value: jcsCount });

/** A bench that did not run (no fixture, aborted, not applicable); `reason` is a short code, not free text. */
const notMeasured = z.strictObject({
  status: z.literal('not-measured'),
  reason: jcsText(64).regex(/^[a-z][a-z0-9-]*$/, { message: 'reason must be a kebab-case code' }),
});

function bench<T extends z.core.$ZodLooseShape>(shape: T) {
  return z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('measured'), ...shape }),
    notMeasured,
  ]);
}

const decisionEqualityBot = z
  .strictObject({
    botId: botIdSchema,
    positions: z.literal(DECISION_POSITIONS_PER_BOT),
    equal: jcsCount,
    /** Golden position ids whose device decision key differs from the Node golden decision. */
    mismatchedPositionIds: z.array(jcsText(128)).max(DECISION_POSITIONS_PER_BOT),
  })
  .refine((b) => b.equal + b.mismatchedPositionIds.length === b.positions, {
    message: 'equal + mismatchedPositionIds.length must equal positions',
  });

export const benchesSchema = z.strictObject({
  /** `LexiconIndex.has()` latency (sprint H1 row: `has()` p99). */
  lexiconHas: bench({ timing: timingDistributionSchema }),
  /** Engine `apply` latency (H1 row: `apply` p95). */
  engineApply: bench({ timing: timingDistributionSchema }),
  /** Resume probe (DG1 row; H1 row: resume p95). */
  resume: bench({ timing: timingDistributionSchema }),
  /** Bot think time per bot (note §7.2; H1 row: bot think p95), with nodes, candidates and cap-bound count. */
  botThink: bench({
    bots: z
      .array(
        z.strictObject({
          botId: botIdSchema,
          botVersion: jcsPositive,
          automaton: z.enum(['gaddag', 'dawg']),
          timing: timingDistributionSchema,
          nodes: countDistributionSchema,
          candidates: countDistributionSchema,
          /** Decisions that stopped on the node or candidate cap (`budgetExhausted`). */
          capBound: jcsCount,
        }),
      )
      .min(1)
      .max(MAX_BOTS),
  }),
  /** bots-api §6 constants measured on device (note §7.1). */
  constants: bench({
    automaton: z.enum(['gaddag', 'dawg']),
    positions: jcsPositive,
    cNode: timingValueSchema,
    cCand: timingValueSchema,
    tFixed: timingValueSchema,
  }),
  /** Device decisions equal the Node golden decisions (note §7.4). */
  decisionEquality: bench({ bots: z.array(decisionEqualityBot).min(1).max(MAX_BOTS) }),
  /** Sustained play: compute p95 per match over consecutive matches (note §7.6). */
  drift: bench({
    botId: botIdSchema,
    unit: timeUnitSchema,
    matches: z
      .array(z.strictObject({ decisions: jcsPositive, computeP50: jcsCount, computeP95: jcsCount }))
      .length(DRIFT_MATCHES),
  }),
});

export const deviceSchema = z.strictObject({
  platform: z.enum(['android', 'ios']),
  /** Marketing or model name as reported by the OS, printable ASCII (hosts transliterate). */
  model: jcsText(64),
  osVersion: jcsText(32),
  /** Total RAM rounded to a class, never the exact byte count. */
  ramClass: z.enum(['le-2gb', '3gb', '4gb', '6gb', '8gb', 'ge-12gb']),
  /** E-1.5 "Device timings (H1)": only a reference-class phone can pass or fail a reference threshold. */
  deviceClass: z.enum(['owner-device', 'reference-class']),
});

export const buildSchema = z.strictObject({
  appVersion: jcsText(32),
  gitSha: jcsText(40).regex(GIT_SHA, { message: 'gitSha must be 40 lowercase hex chars' }),
  profile: z.literal('preview'),
});

export const diagnosticsReportSchema = z
  .strictObject({
    diagnosticsFormat: z.literal(DIAGNOSTICS_FORMAT),
    build: buildSchema,
    device: deviceSchema,
    runner: runnerReportSchema,
    benches: benchesSchema,
  })
  .superRefine((report, ctx) => {
    if (report.runner.runtime.kind !== 'hermes-app') {
      ctx.addIssue({
        code: 'custom',
        path: ['runner', 'runtime', 'kind'],
        message: 'a Diagnostics report wraps a runner report from the app ("hermes-app")',
      });
    }
  });

export type DiagnosticsReport = z.infer<typeof diagnosticsReportSchema>;
export type DiagnosticsBenches = z.infer<typeof benchesSchema>;
export type DiagnosticsDevice = z.infer<typeof deviceSchema>;

export function parseDiagnosticsReport(value: unknown): Result<DiagnosticsReport, ReportIssue[]> {
  const parsed = diagnosticsReportSchema.safeParse(value);
  if (!parsed.success) return err(issuesOf(parsed.error));
  return sameCanonical(value, parsed.data) ? ok(parsed.data) : err([CHANGED_BY_PARSING]);
}

export function parseDiagnosticsReportText(text: string): Result<DiagnosticsReport, ReportIssue[]> {
  const json = parseJsonText(text, DIAGNOSTICS_REPORT_MAX_BYTES, 'Diagnostics report');
  return json.ok ? parseDiagnosticsReport(json.value) : json;
}
