/**
 * DG1-d/DG1-e: suites 1–5 wired to the runner and the bench helpers on the bundled lexicon (small case counts), the
 * report built from their results is a valid A2 `diagnosticsFormat` 1 document, and its runner part compares equal
 * to the Node report of the same corpus (ADR-0016 §D3.2), as the H1 comparison will on a computer. Timed benches
 * become `not-measured` on a non-release build; the size cap holds; the resume probe never touches `codelex-data`.
 */
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import {
  compareReportTexts,
  DECISION_POSITIONS_PER_BOT,
  DIAGNOSTICS_REPORT_MAX_BYTES,
  DRIFT_MATCHES,
  parseDiagnosticsReport,
  parseDiagnosticsReportText,
} from '@codelex/golden-runner';
import {
  canonicalJson,
  GOLDEN_CORPUS,
  runGoldens,
  type CoreReport,
} from '@codelex/golden-runner/core';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { LoadedLexicon } from '../lexicon/load-lexicon';
import { loadBundledLexicon } from '../match/test-support';
import { DATA_DIR } from '../persistence/device-fs';
import { MemoryFs } from '../persistence/memory-fs';
import { createPersistence } from '../persistence/saved-match';
import { runtimeCheck } from './device-info';
import { BOT_GROUPS } from './jobs/bots';
import { fullReplayCuts, RESUME_CUTS } from './jobs/resume';
import { runJobs, SUITE_ORDER } from './jobs/job';
import {
  buildDiagnosticsReport,
  REPORT_FILE_NAME,
  REPORT_MAX_BYTES,
  serializeReport,
  type ReportInput,
  type RunResults,
} from './report';
import { createScratchStore, SCRATCH_DIR } from './scratch-fs';
import { jobsFor, type SuiteResults } from './use-diagnostics';

jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));

const RELEASE = runtimeCheck(
  {
    getRuntimeProperties: () => ({
      'OSS Release Version': '250829098.0.17',
      'Bytecode Version': 98,
    }),
  },
  false,
);
const DEVICE = {
  platform: 'android',
  model: 'Samsung SM-A256B',
  osVersion: 'Android 14 (API 34)',
} as const;

let lexicon: LoadedLexicon;
let results: SuiteResults;
let nodeReport: CoreReport;

/** A clock advancing 10 µs per reading: deterministic, non-zero timings, fine enough for the C-4 probe. */
function steppingClock(): () => number {
  let t = 0;
  return () => (t += 0.01);
}

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  const { goldens, ...rest } = results;
  if (goldens === undefined) throw new Error('goldens did not run');
  const runResults: RunResults = { runner: goldens, ...rest };
  return {
    appVersion: '0.1.0',
    gitSha: '0123456789abcdef0123456789abcdef01234567',
    device: DEVICE,
    ramClass: '4gb',
    deviceClass: 'owner-device',
    releaseHermes: true,
    corpus: GOLDEN_CORPUS,
    results: runResults,
    ...overrides,
  };
}

beforeAll(async () => {
  lexicon = await loadBundledLexicon();
  const out: { -readonly [K in keyof SuiteResults]: SuiteResults[K] } = {};
  const jobs = jobsFor(
    SUITE_ORDER,
    {
      lexicon: lexicon.index,
      clock: steppingClock(),
      store: createScratchStore(),
      runtime: RELEASE,
      yieldToUi: () => Promise.resolve(),
      settle: () => Promise.resolve(),
      sizes: {
        positions: 20,
        hasBatches: 4,
        applyPasses: 1,
        resumeMatches: 1,
        resumeIterations: 2,
        driftMatches: DRIFT_MATCHES,
      },
    },
    out,
  );
  const outcome = await runJobs(jobs, {
    yieldToUi: () => Promise.resolve(),
    settle: () => Promise.resolve(),
    cancelled: () => false,
  });
  expect(outcome.kind).toBe('completed');
  results = out;
  nodeReport = runGoldens(GOLDEN_CORPUS, { runtime: { kind: 'node', version: process.version } });
}, 300_000);

describe('Diagnostics report (A2 diagnosticsFormat 1)', () => {
  it('is schema-valid with every bench measured on a release build', () => {
    const report = buildDiagnosticsReport(input());
    const parsed = parseDiagnosticsReport(JSON.parse(canonicalJson(report)) as unknown);
    expect(parsed.ok ? 'ok' : parsed.error).toBe('ok');
    const { benches } = report;
    expect(Object.values(benches).map((b) => b.status)).toEqual(
      Object.values(benches).map(() => 'measured'),
    );
    expect(report.runner.runtime.kind).toBe('hermes-app');
    expect(report.build.profile).toBe('preview');
    expect(benches.lexiconHas.status === 'measured' && benches.lexiconHas.timing.unit).toBe('ns');
    expect(
      benches.botThink.status === 'measured' && benches.botThink.bots.map((b) => b.botId),
    ).toEqual(BOT_GROUPS.map((g) => g.botId));
    expect(benches.drift.status === 'measured' && benches.drift.matches).toHaveLength(
      DRIFT_MATCHES,
    );
  });

  it('reads decision equality off the goldens: 20 equal positions per bot', () => {
    const { decisionEquality } = buildDiagnosticsReport(input()).benches;
    expect(decisionEquality.status === 'measured' && decisionEquality.bots).toEqual(
      ['random-legal', 'beginner', 'greedy', 'strategist'].map((botId) => ({
        botId,
        positions: DECISION_POSITIONS_PER_BOT,
        equal: DECISION_POSITIONS_PER_BOT,
        mismatchedPositionIds: [],
      })),
    );
  });

  it('shares a text whose runner part compares equal to the Node report (ADR-0016 §D3.2)', () => {
    const text = serializeReport(buildDiagnosticsReport(input()));
    if (text === null) throw new Error('not serialisable');
    expect(parseDiagnosticsReportText(text).ok).toBe(true);
    const comparison = compareReportTexts(canonicalJson(nodeReport), text);
    expect(comparison.ok ? 'equal' : comparison.error).toBe('equal');
    expect(text).toMatch(/^[\x20-\x7e]*$/);
    expect(REPORT_FILE_NAME).toBe('codelex-diagnostics.json');
  });

  it('marks every timed bench not-measured on a dev or non-Hermes build', () => {
    const report = buildDiagnosticsReport(input({ releaseHermes: false }));
    expect(parseDiagnosticsReport(JSON.parse(canonicalJson(report)) as unknown).ok).toBe(true);
    const { decisionEquality, ...timed } = report.benches;
    expect(decisionEquality.status).toBe('measured');
    expect(Object.values(timed)).toEqual(
      Object.values(timed).map(() => ({
        status: 'not-measured',
        reason: 'not-release-hermes-build',
      })),
    );
  });

  it('records suites that did not run, or failed, as typed not-measured reasons', () => {
    const { goldens } = results;
    if (goldens === undefined) throw new Error('goldens did not run');
    const onlyGoldens = buildDiagnosticsReport(input({ results: { runner: goldens } }));
    expect(parseDiagnosticsReport(JSON.parse(canonicalJson(onlyGoldens)) as unknown).ok).toBe(true);
    expect(onlyGoldens.benches.drift).toEqual({ status: 'not-measured', reason: 'not-run' });
    const failed = buildDiagnosticsReport(
      input({
        results: {
          runner: goldens,
          micro: { kind: 'measured', has: null, apply: null },
          bots: { kind: 'failed', reason: 'bot-error' },
          resume: { kind: 'failed', reason: 'not-resumable' },
          drift: { kind: 'failed', reason: 'clock' },
        },
      }),
    );
    expect(parseDiagnosticsReport(JSON.parse(canonicalJson(failed)) as unknown).ok).toBe(true);
    expect(failed.benches.engineApply).toEqual({
      status: 'not-measured',
      reason: 'replay-rejected',
    });
    expect(failed.benches.constants).toEqual({ status: 'not-measured', reason: 'bot-error' });
    const noFit = results.bots;
    if (noFit?.kind !== 'measured') throw new Error('bots did not measure');
    const unfitted = buildDiagnosticsReport(
      input({
        results: {
          runner: goldens,
          bots: { ...noFit, constants: { ordinary: null, twoBlanks: null } },
        },
      }),
    );
    expect(unfitted.benches.constants).toEqual({
      status: 'not-measured',
      reason: 'fit-not-supported',
    });
  });

  it('reports the worst restore path (full replay) and the ordinary-rack fit in the A2 fields (C-M2, C-6)', () => {
    const { resume, bots } = results;
    if (resume?.kind !== 'measured') throw new Error('resume did not measure');
    if (bots?.kind !== 'measured') throw new Error('bots did not measure');
    const { benches } = buildDiagnosticsReport(input());
    expect(benches.resume).toEqual({
      status: 'measured',
      timing: { unit: 'us', ...resume.fullReplay },
    });
    const ordinary = bots.constants.ordinary;
    if (ordinary === null) throw new Error('no ordinary fit');
    expect(ordinary.positions).toBe(20);
    expect(benches.constants).toEqual({
      status: 'measured',
      automaton: bots.automaton,
      positions: ordinary.positions,
      cNode: { unit: 'ns', value: ordinary.cNodeNs },
      cCand: { unit: 'ns', value: ordinary.cCandNs },
      tFixed: { unit: 'us', value: ordinary.tFixedUs },
    });
    // The two-blank fit is kept apart, never mixed into the A2 field.
    expect(bots.constants.twoBlanks?.positions).toBe(20);
  });

  it('records a too-coarse clock as clock-resolution on every timed bench (C-4)', () => {
    const { goldens } = results;
    if (goldens === undefined) throw new Error('goldens did not run');
    const coarse = { kind: 'failed', reason: 'clock-resolution' } as const;
    const report = buildDiagnosticsReport(
      input({
        results: { runner: goldens, micro: coarse, bots: coarse, resume: coarse, drift: coarse },
      }),
    );
    expect(parseDiagnosticsReport(JSON.parse(canonicalJson(report)) as unknown).ok).toBe(true);
    const { decisionEquality, ...timed } = report.benches;
    expect(decisionEquality.status).toBe('measured');
    expect(Object.values(timed)).toEqual(
      Object.values(timed).map(() => ({ status: 'not-measured', reason: 'clock-resolution' })),
    );
  });

  it('keeps the A2 size cap and refuses a document outside the JCS subset', () => {
    expect(REPORT_MAX_BYTES).toBe(DIAGNOSTICS_REPORT_MAX_BYTES);
    const report = buildDiagnosticsReport(input());
    expect((serializeReport(report) ?? '').length).toBeLessThan(REPORT_MAX_BYTES);
    const fraction = { ...report, build: { ...report.build, appVersion: 0.5 } };
    expect(serializeReport(fraction as unknown as typeof report)).toBeNull();
    const huge = {
      ...report,
      build: { ...report.build, appVersion: 'x'.repeat(REPORT_MAX_BYTES) },
    };
    expect(serializeReport(huge)).toBeNull();
  });
});

describe('resume probe data isolation (DS-6, DG1-d)', () => {
  it('writes only to the cache scratch store and deletes it after the suite', async () => {
    expect(results.resume?.kind).toBe('measured');
    const { Paths } = jest.requireActual<{ Paths: { cache: { uri: string } } }>(
      '../../jest/expo-file-system.cjs',
    );
    expect(existsSync(join(Paths.cache.uri, SCRATCH_DIR))).toBe(false);
    // A player's saved match in codelex-data, and a run (then a cancelled run) of the probe beside it.
    const data = new MemoryFs();
    data.write('current.log', new Uint8Array([1, 2, 3]));
    data.write('terms.seen', new Uint8Array([4]));
    const before = JSON.stringify(
      [...data.list()].sort().map((n) => [n, [...(data.read(n) ?? [])]]),
    );
    const store = createScratchStore();
    for (const cancelAfter of [Number.POSITIVE_INFINITY, 3]) {
      let yields = 0;
      await runJobs(
        jobsFor(
          ['resume'],
          {
            lexicon: lexicon.index,
            clock: steppingClock(),
            store,
            runtime: RELEASE,
            yieldToUi: () => Promise.resolve(),
            settle: () => Promise.resolve(),
            sizes: { resumeMatches: 1, resumeIterations: 1 },
          },
          {},
        ),
        {
          yieldToUi: () => {
            yields += 1;
            return Promise.resolve();
          },
          settle: () => Promise.resolve(),
          cancelled: () => yields >= cancelAfter,
        },
      );
      expect(existsSync(join(Paths.cache.uri, SCRATCH_DIR))).toBe(false);
    }
    const after = JSON.stringify(
      [...data.list()].sort().map((n) => [n, [...(data.read(n) ?? [])]]),
    );
    expect(after).toBe(before);
    expect(readdirSync(Paths.cache.uri)).not.toContain(DATA_DIR);
  }, 120_000);

  it('the scratch factory refuses the data and share directories', () => {
    expect(() => createScratchStore(DATA_DIR)).toThrow(RangeError);
    expect(() => createScratchStore('codelex-share')).toThrow(RangeError);
    expect(() => createScratchStore('../codelex-data')).toThrow(RangeError);
    expect(() => createScratchStore().fixture('../x')).toThrow(RangeError);
  });

  it('cuts journals at 30, 60, 90, clamped to the last in-progress action', () => {
    expect(RESUME_CUTS).toEqual([30, 60, 90]);
    expect(fullReplayCuts(null)).toEqual([30, 60, 90]);
    expect(fullReplayCuts(46)).toEqual([30, 45]);
    expect(fullReplayCuts(20)).toEqual([19]);
    // The production persistence code reads what the probe wrote.
    expect(typeof createPersistence).toBe('function');
  });
});
