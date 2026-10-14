/**
 * Node hosts (ADR-0016 §D3 item 2, §D3.2). Node-only; exempt from the core's purity lint (`src/host/**`, documented
 * in `@codelex/config` eslint, GOLDEN_RUNNER_HOST_FILES).
 *
 * - `runNodeHost`: runs the core on Node, validates the report with the `runnerFormat` 1 schema and prints its
 *   canonical JSON to stdout. Exit 0 = verdict pass, 1 = verdict fail (the report is still printed), 2 = the runner
 *   threw (a corpus outside JSON integers) or the report does not parse (a runner bug): one line on stderr with a
 *   typed error name, nothing on stdout.
 * - `runCompareCli`: `<reference.json> <candidate.json>` → `describeComparison` on stdout. Exit 0 = equal and
 *   passing, 1 = any comparison failure, 2 = usage or unreadable file.
 */
import { canonicalJson } from '@codelex/game-engine/canonical';

import { compareReportTexts, describeComparison } from '../compare.js';
import { GOLDEN_CORPUS, runGoldens, type GoldenCorpus } from '../core/index.js';
import { parseRunnerReport } from '../runner-report.js';

export interface HostIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export interface NodeHostOptions {
  readonly version: string;
  /** Integer milliseconds, monotonic (the bin passes `Math.floor(performance.now())`). */
  readonly clock?: () => number;
  /** For tests; defaults to the published corpus. */
  readonly corpus?: GoldenCorpus;
}

export function runNodeHost(io: HostIo, options: NodeHostOptions): number {
  let report: unknown;
  try {
    report = runGoldens(options.corpus ?? GOLDEN_CORPUS, {
      runtime: { kind: 'node', version: options.version },
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });
  } catch (error) {
    io.stderr(`golden runner crashed: ${error instanceof Error ? error.name : 'unknown error'}\n`);
    return 2;
  }
  const parsed = parseRunnerReport(report);
  if (!parsed.ok) {
    io.stderr(
      `golden runner produced an invalid report: ${parsed.error.map((i) => `${i.path}: ${i.message}`).join('; ')}\n`,
    );
    return 2;
  }
  io.stdout(`${canonicalJson(parsed.value)}\n`);
  return parsed.value.verdict === 'pass' ? 0 : 1;
}

export const COMPARE_USAGE =
  'usage: golden-compare <reference-report.json> <candidate-report.json>';

export function runCompareCli(
  args: readonly string[],
  io: HostIo,
  readText: (path: string) => string,
): number {
  const [referencePath, candidatePath, ...rest] = args;
  if (referencePath === undefined || candidatePath === undefined || rest.length > 0) {
    io.stderr(`${COMPARE_USAGE}\n`);
    return 2;
  }
  let texts: [string, string];
  try {
    texts = [readText(referencePath), readText(candidatePath)];
  } catch (error) {
    io.stderr(`cannot read report: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    return 2;
  }
  const result = compareReportTexts(texts[0], texts[1]);
  io.stdout(`${describeComparison(result)}\n`);
  return result.ok ? 0 : 1;
}
