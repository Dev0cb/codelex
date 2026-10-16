import { canonicalJson } from '@codelex/game-engine/canonical';
import { describe, expect, it } from 'vitest';

import { parseRunnerReport } from '../runner-report.js';
import {
  BOT_DECISIONS_PATH,
  GOLDEN_CORPUS,
  JCS_PATH,
  REPLAY_GC_DET_01_LOG_PATH,
  REPLAY_GC_DET_01_PATH,
  RNG_PATH,
  SCORING_CLASSIC_PATH,
  SCORING_INFLECTIONS_PATH,
  SHA256_PATH,
  type GoldenCorpus,
} from './corpus.js';
import { corpusDigest } from './digest.js';
import { runGoldens, runGoldensStepwise, SUITES, type GoldenProgress } from './run.js';
import type { CoreReport, RunnerHost } from './types.js';

const NODE: RunnerHost = { runtime: { kind: 'node', version: 'v22.0.0' } };

/** A deep copy of the corpus with one change applied (the published values are never modified). */
function corrupted(change: (corpus: Record<string, unknown>) => void): GoldenCorpus {
  const copy = JSON.parse(canonicalJsonSafe(GOLDEN_CORPUS)) as Record<string, unknown>;
  change(copy);
  return copy as unknown as GoldenCorpus;
}

/** JSON text of the corpus (test only: the corpus has booleans, so not canonicalJson). */
function canonicalJsonSafe(value: unknown): string {
  return JSON.stringify(value);
}

/** Sets `doc[k0][k1]…` (test helper for corrupting a copy of a golden file). */
function setAt(doc: unknown, keys: readonly (string | number)[], value: unknown): void {
  let target = doc as Record<string | number, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
  target[keys[keys.length - 1] ?? ''] = value;
}

/** `[suite, case, status]` of every case that did not pass, in report order. */
function notPassing(report: CoreReport): (readonly string[])[] {
  return report.suites.flatMap((s) =>
    s.cases.filter((c) => c.status !== 'pass').map((c) => [s.id, c.id, c.status]),
  );
}

function caseOf(
  report: CoreReport,
  suite: string,
  id: string,
): CoreReport['suites'][number]['cases'][number] {
  const found = report.suites.find((s) => s.id === suite)?.cases.find((c) => c.id === id);
  if (found === undefined) throw new Error(`${suite} ${id} missing`);
  return found;
}

let reference: CoreReport | undefined;
function realReport(): CoreReport {
  reference ??= runGoldens(GOLDEN_CORPUS, NODE);
  return reference;
}

describe(
  'runGoldens on the published corpus (ADR-0016 §D3 items 2–3)',
  { timeout: 120_000 },
  () => {
    it('passes every case on Node', () => {
      const report = realReport();
      const notPassing = report.suites.flatMap((s) =>
        s.cases
          .filter((c) => c.status !== 'pass')
          .map((c) => `${s.id} ${c.id} ${canonicalJson(c)}`),
      );
      expect(notPassing).toEqual([]);
      expect(report.verdict).toBe('pass');
    });

    it('has the suites of §D3 item 3 in order, with the expected case counts', () => {
      const report = realReport();
      expect(report.suites.map((s) => [s.id, s.cases.length])).toEqual([
        ['rng', 9],
        ['sha256', 5],
        ['jcs', expect.any(Number) as number],
        ['scoring/v1', 27],
        ['replays/v1', 5],
        ['bots/decisions-b2-r1', 81],
      ]);
      expect(SUITES.map((s) => s.id)).toEqual(report.suites.map((s) => s.id));
    });

    it('is a valid runnerFormat 1 report (A2 schema)', () => {
      const parsed = parseRunnerReport(JSON.parse(canonicalJson(realReport())) as unknown);
      expect(parsed.ok ? 'ok' : parsed.error).toBe('ok');
    });

    it('pins the corpus identity: digest, rules versions, BOT_VERSION', () => {
      const { corpus } = realReport();
      expect(corpus.digest).toBe(corpusDigest(GOLDEN_CORPUS as unknown as Record<string, unknown>));
      expect(corpus.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(corpus.engineRulesVersions).toEqual([1]);
      expect(corpus.botVersion).toBe(2);
    });

    it('is deterministic: two runs give the same canonical bytes', () => {
      const again = runGoldens(GOLDEN_CORPUS, NODE);
      expect(canonicalJson(again)).toBe(canonicalJson(realReport()));
    });

    it('reports observed values (not only pass/fail), replays as stateHashes', () => {
      const report = realReport();
      expect(caseOf(report, 'sha256', 'abc')).toEqual({
        id: 'abc',
        status: 'pass',
        observed: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      });
      const hashes = caseOf(report, 'replays/v1', 'GC-DET-01/state-hashes/000-029');
      expect(
        hashes.status === 'pass' && Array.isArray(hashes.observed) && hashes.observed.length,
      ).toBe(30);
    });

    it('adds integer timings per suite only when the host injects a clock', () => {
      expect(realReport().timings).toBeUndefined();
      let t = 0;
      const timed = runGoldens(
        corrupted(() => undefined),
        { ...NODE, clock: () => (t += 5) },
      );
      expect(Object.keys(timed.timings ?? {})).toEqual(SUITES.map((s) => s.id));
      // A suite's time is the sum of its case intervals (5 per case with this clock).
      expect(
        timed.suites.map((s) => timed.timings?.[s.id]?.totalMs === 5 * s.cases.length),
      ).toEqual(SUITES.map(() => true));
    });

    it('runs one case per step and returns the same report as runGoldens', () => {
      const steps = runGoldensStepwise(GOLDEN_CORPUS, NODE);
      const progress: GoldenProgress[] = [];
      let step = steps.next();
      while (step.done !== true) {
        progress.push(step.value);
        step = steps.next();
      }
      const total = realReport().suites.reduce((n, s) => n + s.cases.length, 0);
      expect(progress).toHaveLength(total);
      expect(progress.map((p) => p.done)).toEqual(progress.map((_, i) => i + 1));
      expect(progress.every((p) => p.total === total)).toBe(true);
      expect(progress[0]?.suite).toBe('rng');
      expect(progress.at(-1)?.suite).toBe('bots/decisions-b2-r1');
      expect(canonicalJson(step.value)).toBe(canonicalJson(realReport()));
    });

    it('does not count the time a host spends between two steps', () => {
      let t = 0;
      const steps = runGoldensStepwise(GOLDEN_CORPUS, { ...NODE, clock: () => t });
      let step = steps.next();
      while (step.done !== true) {
        t += 1_000; // the host's pause between two cases
        step = steps.next();
      }
      expect(Object.values(step.value.timings ?? {}).every((v) => v.totalMs === 0)).toBe(true);
    });
  },
);

describe('a corrupted golden value fails and names the case', { timeout: 120_000 }, () => {
  it('a changed sha256 digest fails exactly that case with the computed value', () => {
    const report = runGoldens(
      corrupted((c) => {
        const file = c[SHA256_PATH] as { cases: { digest: string }[] };
        (file.cases[1] as { digest: string }).digest = '0'.repeat(64);
      }),
      NODE,
    );
    expect(report.verdict).toBe('fail');
    const failing = report.suites.flatMap((s) =>
      s.cases.filter((c) => c.status !== 'pass').map((c) => [s.id, c.id, c.status]),
    );
    expect(failing).toEqual([['sha256', 'abc', 'fail']]);
    expect(caseOf(report, 'sha256', 'abc')).toMatchObject({
      observed: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
    expect(report.corpus.digest).not.toBe(realReport().corpus.digest);
  });

  it.each([
    ['rng', RNG_PATH, ['cases', 0, 'next', 0], 1, 'rng', '0000000000000000/bag'],
    ['jcs canonical text', JCS_PATH, ['cases', 0, 'jcs'], '{}', 'jcs', 'cases/adr-0013-a3'],
    [
      'jcs rejection kind',
      JCS_PATH,
      ['rejections', 0, 'error'],
      'SyntaxError',
      'jcs',
      `rejections/${GOLDEN_CORPUS[JCS_PATH].rejections[0]?.name ?? ''}`,
    ],
    [
      'scoring total',
      SCORING_CLASSIC_PATH,
      ['scoringCases', 0, 'expected', 'total'],
      21,
      'scoring/v1',
      'GC-CL-01',
    ],
    [
      'end adjustment',
      SCORING_CLASSIC_PATH,
      ['endCases', 0, 'expected', 'adjustments', 0],
      18,
      'scoring/v1',
      'GC-CL-E1',
    ],
    [
      'stored state hash',
      REPLAY_GC_DET_01_LOG_PATH,
      ['stateHashes', 40],
      '0000000000000000',
      'replays/v1',
      'GC-DET-01/state-hashes/030-059',
    ],
    [
      'final state hash',
      REPLAY_GC_DET_01_PATH,
      ['finalStateHash'],
      '0000000000000000',
      'replays/v1',
      'GC-DET-01/final',
    ],
    [
      'bot decision key',
      BOT_DECISIONS_PATH,
      ['decisions', 0, 'key'],
      'X',
      'bots/decisions-b2-r1',
      '00000000a2918652/0/random-legal',
    ],
  ] as const)('%s fails exactly its case', (_name, path, keys, value, suite, id) => {
    const report = runGoldens(
      corrupted((c) => {
        setAt(c[path], keys, value);
      }),
      NODE,
    );
    expect(report.verdict).toBe('fail');
    expect(notPassing(report)).toEqual([[suite, id, 'fail']]);
  });

  it.each([
    [
      'a malformed bot seed',
      BOT_DECISIONS_PATH,
      ['decisions', 0, 'seed'],
      'zz',
      [['bots/decisions-b2-r1', 'zz/0/random-legal', 'error']],
    ],
    [
      'an unknown personality',
      BOT_DECISIONS_PATH,
      ['decisions', 0, 'personality'],
      'nobody',
      [['bots/decisions-b2-r1', '00000000a2918652/0/nobody', 'error']],
    ],
    [
      'a position after the match ended',
      BOT_DECISIONS_PATH,
      ['decisions', 0, 'actions'],
      400,
      [['bots/decisions-b2-r1', '00000000a2918652/400/random-legal', 'error']],
    ],
    [
      'a malformed log header',
      REPLAY_GC_DET_01_LOG_PATH,
      ['header', 'seed'],
      'nothex',
      [
        ['replays/v1', 'GC-DET-01/log', 'error'],
        ['replays/v1', 'GC-DET-01/state-hashes/000-029', 'error'],
        ['replays/v1', 'GC-DET-01/state-hashes/030-059', 'error'],
        ['replays/v1', 'GC-DET-01/state-hashes/060-089', 'error'],
        ['replays/v1', 'GC-DET-01/final', 'error'],
      ],
    ],
    [
      'a jcs rejection whose input is accepted',
      JCS_PATH,
      ['rejections', 0, 'input'],
      '"ok"',
      [['jcs', `rejections/${GOLDEN_CORPUS[JCS_PATH].rejections[0]?.name ?? ''}`, 'fail']],
    ],
    [
      'an unknown end reason',
      SCORING_CLASSIC_PATH,
      ['endCases', 0, 'endReason'],
      'timeout',
      [['scoring/v1', 'GC-CL-E1', 'error']],
    ],
    [
      'a scoring file on another layout',
      SCORING_INFLECTIONS_PATH,
      ['layout'],
      'classic-v2',
      GOLDEN_CORPUS[SCORING_INFLECTIONS_PATH].scoringCases.map((c) => [
        'scoring/v1',
        c.id,
        'error',
      ]),
    ],
  ] as const)('%s is reported, never a crash', (_name, path, keys, value, expected) => {
    const report = runGoldens(
      corrupted((c) => {
        setAt(c[path], keys, value);
      }),
      NODE,
    );
    expect(notPassing(report)).toEqual(expected);
  });

  it('a malformed golden case is an error case with a typed code, never a crash', () => {
    const report = runGoldens(
      corrupted((c) => {
        const file = c[RNG_PATH] as { cases: { seed: string }[] };
        (file.cases[0] as { seed: string }).seed = 'not-hex';
      }),
      NODE,
    );
    expect(report.suites[0]?.cases[0]).toEqual({
      id: 'not-hex/bag',
      status: 'error',
      errorCode: 'CORPUS_MALFORMED',
    });
  });

  it('a suite whose file cannot be read reports one error case', () => {
    const report = runGoldens(
      corrupted((c) => {
        c[SHA256_PATH] = {};
      }),
      NODE,
    );
    expect(report.suites[1]).toEqual({
      id: 'sha256',
      cases: [{ id: 'corpus', status: 'error', errorCode: 'CORPUS_MALFORMED' }],
      summary: { pass: 0, fail: 0, error: 1 },
    });
  });
});
