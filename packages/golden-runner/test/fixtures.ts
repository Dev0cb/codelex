/**
 * Hand-made reports for the contract tests. `nodeReport()` has the shape the Node host will emit for the ADR-0016
 * §D3 item 3 suites; `hermesReport()` is the same run as reported by the Hermes CLI (only `runtime` and `timings`
 * differ, and neither is compared). Builders return fresh objects, so tests may mutate them.
 */
export function nodeReport(): Record<string, unknown> {
  return {
    runnerFormat: 1,
    runtime: { kind: 'node', version: 'v22.20.0' },
    corpus: {
      digest: '29cb9747b6a7224168208f209044e3d24573275df767bf9d09003cf5ef3ef7cb',
      engineRulesVersions: [1],
      botVersion: 2,
    },
    suites: [
      {
        id: 'rng',
        cases: [
          { id: 'pcg32/seed-0/first-8', status: 'pass', observed: [1, 2, 4294967295, 0] },
          { id: 'derive/bag', status: 'pass', observed: { state: [7, 11, 13, 17] } },
        ],
        summary: { pass: 2, fail: 0, error: 0 },
      },
      {
        id: 'sha256',
        cases: [
          {
            id: 'nist/abc',
            status: 'pass',
            observed: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
          },
        ],
        summary: { pass: 1, fail: 0, error: 0 },
      },
      {
        id: 'jcs',
        cases: [
          { id: 'appendix-a3', status: 'pass', observed: '{"a":[3,"?AE"],"b":0,"z":{"k":-7}}' },
        ],
        summary: { pass: 1, fail: 0, error: 0 },
      },
      {
        id: 'scoring/v1',
        cases: [{ id: 'cross-word-double', status: 'pass', observed: { total: 24, words: 2 } }],
        summary: { pass: 1, fail: 0, error: 0 },
      },
      {
        id: 'replays/v1',
        cases: [
          {
            id: 'gc-det-01',
            status: 'pass',
            observed: { stateHashes: ['29cb9747b6a72241', '0123456789abcdef'] },
          },
          {
            id: 'seeded-match-003',
            status: 'pass',
            observed: { stateHashes: ['fedcba9876543210'] },
          },
        ],
        summary: { pass: 2, fail: 0, error: 0 },
      },
    ],
    verdict: 'pass',
    timings: {
      rng: { totalMs: 3 },
      'replays/v1': { totalMs: 812 },
    },
  };
}

export function hermesReport(): Record<string, unknown> {
  const report = nodeReport();
  report['runtime'] = { kind: 'hermes-cli', version: '250829098.0.17', bytecodeVersion: 96 };
  report['timings'] = { rng: { totalMs: 41 }, sha256: { totalMs: 9 } };
  return report;
}

function measuredTiming(unit: 'ns' | 'us' | 'ms', p50: number): Record<string, unknown> {
  return { unit, samples: 1000, p50, p95: p50 * 2, p99: p50 * 3, max: p50 * 5 };
}

export function diagnosticsReport(): Record<string, unknown> {
  const runner = hermesReport();
  runner['runtime'] = { kind: 'hermes-app', version: '250829098.0.17', bytecodeVersion: 96 };
  delete runner['timings'];
  const counts = { p50: 900, p95: 4000, p99: 9000, max: 20000 };
  return {
    diagnosticsFormat: 1,
    build: {
      appVersion: '0.4.0',
      gitSha: 'e8555220c0ffee0123456789abcdef0123456789',
      profile: 'preview',
    },
    device: {
      platform: 'android',
      model: 'Pixel 6a',
      osVersion: '14',
      ramClass: '6gb',
      deviceClass: 'owner-device',
    },
    runner,
    benches: {
      lexiconHas: { status: 'measured', timing: measuredTiming('ns', 800) },
      engineApply: { status: 'measured', timing: measuredTiming('us', 120) },
      resume: { status: 'measured', timing: measuredTiming('ms', 40) },
      botThink: {
        status: 'measured',
        bots: [
          {
            botId: 'beginner',
            botVersion: 2,
            automaton: 'gaddag',
            timing: measuredTiming('ms', 30),
            nodes: counts,
            candidates: { p50: 40, p95: 120, p99: 200, max: 256 },
            capBound: 0,
          },
          {
            botId: 'strategist',
            botVersion: 2,
            automaton: 'gaddag',
            timing: measuredTiming('ms', 300),
            nodes: counts,
            candidates: { p50: 400, p95: 1200, p99: 2000, max: 2048 },
            capBound: 3,
          },
        ],
      },
      constants: {
        status: 'measured',
        automaton: 'gaddag',
        positions: 202,
        cNode: { unit: 'ns', value: 9500 },
        cCand: { unit: 'us', value: 35 },
        tFixed: { unit: 'ms', value: 11 },
      },
      decisionEquality: {
        status: 'measured',
        bots: [
          { botId: 'beginner', positions: 20, equal: 20, mismatchedPositionIds: [] },
          {
            botId: 'strategist',
            positions: 20,
            equal: 19,
            mismatchedPositionIds: ['00000000a2918652:4'],
          },
        ],
      },
      drift: {
        status: 'measured',
        botId: 'strategist',
        unit: 'ms',
        matches: Array.from({ length: 10 }, (_, i) => ({
          decisions: 14,
          computeP50: 300 + i,
          computeP95: 900 + 10 * i,
        })),
      },
    },
  };
}

/** Deep copy through JSON (test-only; values are plain JSON). */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
