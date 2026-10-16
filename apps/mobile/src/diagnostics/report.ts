/**
 * The Diagnostics report (DG1 note §6; A2 `diagnosticsFormat` 1, `@codelex/golden-runner`): the `hermes-app` runner
 * report plus the H1 benches, the build and the device block (note §7). Held in memory only and serialised with the
 * engine's canonical JSON (ADR-0013 §D4; printable ASCII, no fractions) when the owner taps "Share report…".
 *
 * Validation: the app never imports zod at runtime (S6a bundle rule, `analytics/no-runtime-zod.test.ts`), and the
 * schema module would bring it into the preview bundle (+555 KB). So the report is built by this typed function,
 * whose output type is the A2 schema's own type, and serialised by the canonical serialiser (which throws on any
 * value outside the JCS subset); the tests parse what it builds with `parseDiagnosticsReport` (A2), and the Node
 * comparison script parses the shared file again as untrusted input (ADR-0016 §D3.2).
 */
import type { DiagnosticsReport } from '@codelex/golden-runner';
import {
  canonicalJson,
  decisionEquality,
  type CoreReport,
  type Distribution,
  type GoldenCorpus,
} from '@codelex/golden-runner/core';

import type { BotsResult } from './jobs/bots';
import type { DriftResult } from './jobs/drift';
import type { MicroResult } from './jobs/micro';
import type { ResumeResult } from './jobs/resume';
import type { DeviceFields } from './device-info';

/** A2 `DIAGNOSTICS_REPORT_MAX_BYTES` (256 KB runner budget + 64 KB); a test pins it to the package's value. */
export const REPORT_MAX_BYTES = 256 * 1024 + 64 * 1024;

/** Fixed visible file name (TM-04, note §6). */
export const REPORT_FILE_NAME = 'codelex-diagnostics.json';

export const RAM_CLASSES = ['le-2gb', '3gb', '4gb', '6gb', '8gb', 'ge-12gb'] as const;
export type RamClass = (typeof RAM_CLASSES)[number];
export const DEVICE_CLASSES = ['owner-device', 'reference-class'] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/** What the run produced; a suite that did not run is absent. */
export interface RunResults {
  readonly runner: CoreReport;
  readonly micro?: MicroResult;
  readonly bots?: BotsResult;
  readonly resume?: ResumeResult;
  readonly drift?: DriftResult;
}

export interface ReportInput {
  readonly appVersion: string;
  readonly gitSha: string;
  readonly device: DeviceFields;
  /** Picked by the owner on the screen: RAM is not readable without a new native dependency (OQ-DG-3). */
  readonly ramClass: RamClass;
  readonly deviceClass: DeviceClass;
  /** False on a dev or non-Hermes build: every timed bench is `not-measured` (note §2, §9). */
  readonly releaseHermes: boolean;
  readonly corpus: GoldenCorpus;
  readonly results: RunResults;
}

type Benches = DiagnosticsReport['benches'];
type Timing = Extract<Benches['lexiconHas'], { status: 'measured' }>['timing'];

const notMeasured = (reason: string): { status: 'not-measured'; reason: string } => ({
  status: 'not-measured',
  reason,
});

const timing = (unit: 'ns' | 'us', d: Distribution): Timing => ({
  unit,
  samples: d.samples,
  p50: d.p50,
  p95: d.p95,
  p99: d.p99,
  max: d.max,
});

const counts = (d: Distribution): { p50: number; p95: number; p99: number; max: number } => ({
  p50: d.p50,
  p95: d.p95,
  p99: d.p99,
  max: d.max,
});

const NOT_RUN = 'not-run';
const NOT_RELEASE = 'not-release-hermes-build';

function timedBenches(input: ReportInput): Omit<Benches, 'decisionEquality'> {
  const { micro, bots, resume, drift } = input.results;
  if (!input.releaseHermes) {
    const invalid = notMeasured(NOT_RELEASE);
    return {
      lexiconHas: invalid,
      engineApply: invalid,
      resume: invalid,
      botThink: invalid,
      constants: invalid,
      drift: invalid,
    };
  }
  return {
    // A batch mean per call in ns (micro.ts): its percentiles are over batch means, not over single calls.
    lexiconHas:
      micro === undefined
        ? notMeasured(NOT_RUN)
        : micro.kind === 'failed'
          ? notMeasured(micro.reason)
          : micro.has === null
            ? notMeasured('clock')
            : { status: 'measured', timing: timing('ns', micro.has) },
    engineApply:
      micro === undefined
        ? notMeasured(NOT_RUN)
        : micro.kind === 'failed'
          ? notMeasured(micro.reason)
          : micro.apply === null
            ? notMeasured('replay-rejected')
            : { status: 'measured', timing: timing('us', micro.apply) },
    // The worst restore path (review C-M2): full replay. Snapshot + tail has no A2 field (shown on the screen).
    resume:
      resume === undefined
        ? notMeasured(NOT_RUN)
        : resume.kind === 'failed'
          ? notMeasured(resume.reason)
          : { status: 'measured', timing: timing('us', resume.fullReplay) },
    botThink:
      bots === undefined
        ? notMeasured(NOT_RUN)
        : bots.kind === 'failed'
          ? notMeasured(bots.reason)
          : {
              status: 'measured',
              bots: bots.groups.map((g) => ({
                botId: g.botId,
                botVersion: g.botVersion,
                automaton: bots.automaton,
                timing: timing('us', g.timingUs),
                nodes: counts(g.nodes),
                candidates: counts(g.candidates),
                capBound: g.capBound,
              })),
            },
    // Ordinary racks only (review C-6): the two-blank fit has no A2 field (shown on the screen).
    constants:
      bots === undefined
        ? notMeasured(NOT_RUN)
        : bots.kind === 'failed'
          ? notMeasured(bots.reason)
          : bots.constants.ordinary === null
            ? notMeasured('fit-not-supported')
            : {
                status: 'measured',
                automaton: bots.automaton,
                positions: bots.constants.ordinary.positions,
                cNode: { unit: 'ns', value: bots.constants.ordinary.cNodeNs },
                cCand: { unit: 'ns', value: bots.constants.ordinary.cCandNs },
                tFixed: { unit: 'us', value: bots.constants.ordinary.tFixedUs },
              },
    drift:
      drift === undefined
        ? notMeasured(NOT_RUN)
        : drift.kind === 'failed'
          ? notMeasured(drift.reason)
          : { status: 'measured', botId: 'strategist', unit: 'us', matches: [...drift.matches] },
  };
}

/** The A2 document. Pure: the inputs carry every device, build and timing value. */
export function buildDiagnosticsReport(input: ReportInput): DiagnosticsReport {
  const equality = decisionEquality(input.results.runner, input.corpus);
  return {
    diagnosticsFormat: 1,
    build: { appVersion: input.appVersion, gitSha: input.gitSha, profile: 'preview' },
    device: { ...input.device, ramClass: input.ramClass, deviceClass: input.deviceClass },
    // Same document as the runner schema describes; `observed` is typed `unknown` in the zod-free core.
    runner: input.results.runner as unknown as DiagnosticsReport['runner'],
    benches: {
      ...timedBenches(input),
      decisionEquality:
        equality === null
          ? notMeasured('not-twenty-positions')
          : {
              status: 'measured',
              bots: equality.map((b) => ({
                botId: b.botId,
                positions: 20 as const,
                equal: b.equal,
                mismatchedPositionIds: [...b.mismatchedPositionIds],
              })),
            },
    },
  };
}

/** Canonical JSON of the report, or null when it cannot be serialised or is above the A2 size cap. */
export function serializeReport(report: DiagnosticsReport): string | null {
  let text: string;
  try {
    text = canonicalJson(report);
  } catch {
    return null;
  }
  return text.length <= REPORT_MAX_BYTES ? text : null;
}
