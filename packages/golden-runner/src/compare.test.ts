import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { diagnosticsReport, hermesReport, nodeReport } from '../test/fixtures.js';
import {
  compareReports,
  compareReportTexts,
  describeComparison,
  DESCRIBED_ISSUES_MAX,
  DIAGNOSTICS_REPORT_MAX_BYTES,
  type ComparisonResult,
} from './index.js';

type Doc = Record<string, unknown>;

function suites(report: Doc): Doc[] {
  return report['suites'] as Doc[];
}
function casesOf(report: Doc, suite: number): Doc[] {
  return suites(report)[suite]!['cases'] as Doc[];
}
function failure(result: ComparisonResult) {
  if (result.ok) throw new Error('expected the comparison to fail');
  return result.error;
}

describe('compareReports (ADR-0016 §D3.2)', () => {
  it('passes for a Node report and the equal Hermes report: runtime and timings are not compared', () => {
    const result = compareReports(nodeReport(), hermesReport());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suites).toBe(5);
      expect(result.value.cases).toBe(7);
      expect(result.value.canonical).not.toContain('runtime');
      expect(result.value.canonical).not.toContain('timings');
      expect(result.value.canonical.startsWith('{"corpus":')).toBe(true);
    }
    expect(describeComparison(result)).toBe(
      'golden reports equal: 5 suites, 7 cases, verdict pass',
    );
  });

  it('fails when one observed value differs and names the suite and case with both values', () => {
    const hermes = hermesReport();
    casesOf(hermes, 4)[0]!['observed'] = { stateHashes: ['29cb9747b6a72241', '0123456789abcdee'] };
    const result = compareReports(nodeReport(), hermes);
    expect(failure(result)).toEqual({
      kind: 'mismatch',
      location: {
        path: '$.suites[4].cases[0].observed.stateHashes[1]',
        suiteId: 'replays/v1',
        caseId: 'gc-det-01',
      },
      reference: '"0123456789abcdef"',
      candidate: '"0123456789abcdee"',
    });
    expect(describeComparison(result)).toBe(
      'reports differ at suite "replays/v1" case "gc-det-01" (' +
        '$.suites[4].cases[0].observed.stateHashes[1]): reference "0123456789abcdef", candidate "0123456789abcdee"',
    );
  });

  it('reports the first difference in canonical order when several cases differ', () => {
    const hermes = hermesReport();
    casesOf(hermes, 3)[0]!['observed'] = { total: 25, words: 2 };
    casesOf(hermes, 0)[1]!['observed'] = { state: [7, 11, 13, 18] };
    const error = failure(compareReports(nodeReport(), hermes));
    expect(error.kind === 'mismatch' && error.location).toEqual({
      path: '$.suites[0].cases[1].observed.state[3]',
      suiteId: 'rng',
      caseId: 'derive/bag',
    });
  });

  it('names a case present on one side only', () => {
    const hermes = hermesReport();
    casesOf(hermes, 4).pop();
    suites(hermes)[4]!['summary'] = { pass: 1, fail: 0, error: 0 };
    expect(failure(compareReports(nodeReport(), hermes))).toEqual({
      kind: 'mismatch',
      location: { path: '$.suites[4].cases[1].id', suiteId: 'replays/v1' },
      reference: '"seeded-match-003"',
      candidate: null,
    });
    const swapped = { expect: { reference: ['hermes-cli'], candidate: ['node'] } } as const;
    const reversed = compareReports(hermes, nodeReport(), swapped);
    expect(failure(reversed)).toMatchObject({
      kind: 'mismatch',
      reference: null,
      candidate: '"seeded-match-003"',
    });
    expect(describeComparison(reversed)).toContain('reference (absent)');
  });

  it('names an observed key present on one side only, even an Object.prototype name', () => {
    const hermes = hermesReport();
    casesOf(hermes, 3)[0]!['observed'] = { toString: 1, total: 24, words: 2 };
    expect(failure(compareReports(nodeReport(), hermes))).toEqual({
      kind: 'mismatch',
      location: {
        path: '$.suites[3].cases[0].observed.toString',
        suiteId: 'scoring/v1',
        caseId: 'cross-word-double',
      },
      reference: null,
      candidate: '1',
    });
  });

  it('reports misaligned suites at the suite id, with both ids', () => {
    const hermes = hermesReport();
    suites(hermes).reverse();
    expect(failure(compareReports(nodeReport(), hermes))).toEqual({
      kind: 'mismatch',
      location: { path: '$.suites[0].id', suiteId: 'rng' },
      reference: '"rng"',
      candidate: '"replays/v1"',
    });
  });

  it('reports a missing suite at its id', () => {
    const hermes = hermesReport();
    suites(hermes).pop();
    hermes['timings'] = {};
    expect(failure(compareReports(nodeReport(), hermes))).toEqual({
      kind: 'mismatch',
      location: { path: '$.suites[4].id', suiteId: 'replays/v1' },
      reference: '"replays/v1"',
      candidate: null,
    });
    const swapped = { expect: { reference: ['hermes-cli'], candidate: ['node'] } } as const;
    expect(failure(compareReports(hermes, nodeReport(), swapped))).toMatchObject({
      location: { path: '$.suites[4].id', suiteId: 'replays/v1' },
      reference: null,
    });
  });

  it('reports reordered cases at the case id, with both ids', () => {
    const hermes = hermesReport();
    casesOf(hermes, 0).reverse();
    expect(failure(compareReports(nodeReport(), hermes))).toEqual({
      kind: 'mismatch',
      location: { path: '$.suites[0].cases[0].id', suiteId: 'rng' },
      reference: '"pcg32/seed-0/first-8"',
      candidate: '"derive/bag"',
    });
  });

  it('reports a corpus difference before misaligned suites', () => {
    const hermes = hermesReport();
    suites(hermes).reverse();
    (hermes['corpus'] as Doc)['botVersion'] = 3;
    expect(failure(compareReports(nodeReport(), hermes))).toMatchObject({
      location: { path: '$.corpus.botVersion' },
    });
  });

  it('fails on a different corpus without naming a suite', () => {
    const hermes = hermesReport();
    (hermes['corpus'] as Doc)['botVersion'] = 3;
    const result = compareReports(nodeReport(), hermes);
    expect(failure(result)).toEqual({
      kind: 'mismatch',
      location: { path: '$.corpus.botVersion' },
      reference: '2',
      candidate: '3',
    });
    expect(describeComparison(result)).toBe(
      'reports differ at $.corpus.botVersion: reference 2, candidate 3',
    );
  });

  it('fails when a status differs (pass on Node, fail on Hermes)', () => {
    const hermes = hermesReport();
    casesOf(hermes, 1)[0]!['status'] = 'fail';
    suites(hermes)[1]!['summary'] = { pass: 0, fail: 1, error: 0 };
    hermes['verdict'] = 'fail';
    const error = failure(compareReports(nodeReport(), hermes));
    expect(error).toMatchObject({
      kind: 'mismatch',
      location: { path: '$.suites[1].cases[0].status', suiteId: 'sha256', caseId: 'nist/abc' },
      reference: '"pass"',
      candidate: '"fail"',
    });
  });

  it('fails when both reports are equal but a case did not pass', () => {
    const make = (runtime: 'node' | 'hermes'): Doc => {
      const report = runtime === 'node' ? nodeReport() : hermesReport();
      casesOf(report, 2)[0] = { id: 'appendix-a3', status: 'error', errorCode: 'RangeError' };
      suites(report)[2]!['summary'] = { pass: 0, fail: 0, error: 1 };
      report['verdict'] = 'fail';
      return report;
    };
    const result = compareReports(make('node'), make('hermes'));
    expect(failure(result)).toEqual({
      kind: 'not-passing',
      location: { path: '$.suites[2].cases[0]', suiteId: 'jcs', caseId: 'appendix-a3' },
      status: 'error',
    });
    expect(describeComparison(result)).toBe(
      'reports are equal but suite "jcs" case "appendix-a3" ($.suites[2].cases[0]) has status error on both runtimes',
    );
  });

  it('fails with the side and issues when a report does not parse', () => {
    const bad = hermesReport();
    bad['device'] = { model: 'Pixel 6a' };
    const result = compareReports(nodeReport(), bad);
    expect(failure(result)).toMatchObject({ kind: 'invalid-report', side: 'candidate' });
    expect(describeComparison(result)).toMatch(/^candidate report is invalid: \$: /);
    expect(failure(compareReports('not a report', nodeReport()))).toMatchObject({
      kind: 'invalid-report',
      side: 'reference',
    });
  });

  describe('runtimes (a misconfigured job must not compare Node with Node)', () => {
    it('requires a Node reference and a Hermes candidate by default', () => {
      const result = compareReports(nodeReport(), nodeReport());
      expect(failure(result)).toEqual({
        kind: 'wrong-runtime',
        side: 'candidate',
        actual: 'node',
        expected: ['hermes-cli', 'hermes-app'],
      });
      expect(describeComparison(result)).toBe(
        'candidate report ran on "node", expected "hermes-cli" or "hermes-app"',
      );
      expect(failure(compareReports(hermesReport(), hermesReport()))).toEqual({
        kind: 'wrong-runtime',
        side: 'reference',
        actual: 'hermes-cli',
        expected: ['node'],
      });
      expect(failure(compareReports(diagnosticsReport(), diagnosticsReport()))).toMatchObject({
        kind: 'wrong-runtime',
        side: 'reference',
        actual: 'hermes-app',
      });
    });

    it('accepts other pairs only when asked explicitly', () => {
      const cliVsDevice = {
        expect: { reference: ['hermes-cli'], candidate: ['hermes-app'] },
      } as const;
      expect(compareReports(hermesReport(), diagnosticsReport(), cliVsDevice).ok).toBe(true);
      expect(
        compareReportTexts(
          JSON.stringify(hermesReport()),
          JSON.stringify(diagnosticsReport()),
          cliVsDevice,
        ).ok,
      ).toBe(true);
    });
  });

  describe('device layer: a Diagnostics report compared with the Node report', () => {
    it('passes when the embedded runner report is equal', () => {
      expect(compareReports(nodeReport(), diagnosticsReport()).ok).toBe(true);
    });

    it('fails naming the case when the device computed something else', () => {
      const diagnostics = diagnosticsReport();
      const runner = diagnostics['runner'] as Doc;
      casesOf(runner, 1)[0]!['observed'] = '0'.repeat(64);
      expect(failure(compareReports(nodeReport(), diagnostics))).toMatchObject({
        kind: 'mismatch',
        location: { suiteId: 'sha256', caseId: 'nist/abc' },
      });
    });

    it('rejects an invalid Diagnostics wrapper even if the runner report is valid', () => {
      const diagnostics = diagnosticsReport();
      (diagnostics['build'] as Doc)['profile'] = 'production';
      expect(failure(compareReports(nodeReport(), diagnostics))).toMatchObject({
        kind: 'invalid-report',
        side: 'candidate',
        issues: [{ path: '$.build.profile' }],
      });
    });
  });

  describe('compareReportTexts', () => {
    it('compares report texts and Diagnostics texts', () => {
      const node = JSON.stringify(nodeReport());
      expect(compareReportTexts(node, JSON.stringify(hermesReport(), null, 2)).ok).toBe(true);
      expect(compareReportTexts(node, JSON.stringify(diagnosticsReport())).ok).toBe(true);
    });

    it('rejects text that is not JSON or is too large, naming the side', () => {
      const node = JSON.stringify(nodeReport());
      expect(failure(compareReportTexts('{', node))).toEqual({
        kind: 'invalid-report',
        side: 'reference',
        issues: [{ path: '$', message: 'reference report is not valid JSON' }],
      });
      const huge = `${node}${' '.repeat(DIAGNOSTICS_REPORT_MAX_BYTES)}`;
      expect(failure(compareReportTexts(node, huge))).toMatchObject({
        kind: 'invalid-report',
        side: 'candidate',
      });
    });

    it('does not mistake a runner report mentioning "diagnosticsFormat" for a Diagnostics report', () => {
      const report = nodeReport();
      casesOf(report, 3)[0]!['observed'] = { diagnosticsFormat: 1 };
      const hermes = hermesReport();
      hermes['suites'] = report['suites'];
      expect(compareReportTexts(JSON.stringify(report), JSON.stringify(hermes)).ok).toBe(true);
    });

    it('rejects a deeply nested text without overflowing the stack', () => {
      const node = JSON.stringify(nodeReport());
      const deep = `${'['.repeat(100_000)}1${']'.repeat(100_000)}`;
      const hermes = JSON.stringify(hermesReport()).replace('[1,2,4294967295,0]', deep);
      expect(failure(compareReportTexts(node, hermes))).toEqual({
        kind: 'invalid-report',
        side: 'candidate',
        issues: [
          { path: '$', message: 'nested deeper than 64 levels: outside the ADR-0013 §D3 subset' },
        ],
      });
    });
  });

  describe('properties', () => {
    it('a Node report equals the same run on any Hermes runtime, whatever timings say', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('hermes-cli', 'hermes-app'),
          fc.nat({ max: 1000 }),
          fc.nat({ max: 100000 }),
          (kind, bytecodeVersion, totalMs) => {
            const other = nodeReport();
            other['runtime'] = { kind, version: '250829098.0.17', bytecodeVersion };
            other['timings'] = { jcs: { totalMs } };
            expect(compareReports(nodeReport(), other).ok).toBe(true);
          },
        ),
        { seed: 20261007, numRuns: 100 },
      );
    });

    it('any change of one observed integer is reported at that case', () => {
      const cells: [number, number][] = [
        [0, 0],
        [3, 0],
      ];
      fc.assert(
        fc.property(
          fc.constantFrom(...cells),
          fc.integer({ min: 1, max: 1000 }),
          ([s, c], delta) => {
            const hermes = hermesReport();
            const testCase = casesOf(hermes, s)[c]!;
            testCase['observed'] =
              s === 0 ? [1 + delta, 2, 4294967295, 0] : { total: 24 + delta, words: 2 };
            const error = failure(compareReports(nodeReport(), hermes));
            expect(error.kind === 'mismatch' && error.location.caseId).toBe(testCase['id']);
          },
        ),
        { seed: 20261007, numRuns: 100 },
      );
    });
  });

  it('lists at most 20 parse issues', () => {
    const bad = hermesReport();
    suites(bad)[0]!['cases'] = Array.from({ length: 25 }, (_, i) => ({
      id: `c${String(i)}`,
      status: 'pass',
      observed: 0.5,
    }));
    const text = describeComparison(compareReports(nodeReport(), bad));
    expect(text).toMatch(/^candidate report is invalid: /);
    const issues = failure(compareReports(nodeReport(), bad));
    const total = issues.kind === 'invalid-report' ? issues.issues.length : 0;
    expect(total).toBeGreaterThan(DESCRIBED_ISSUES_MAX);
    expect(text.endsWith(`; and ${String(total - DESCRIBED_ISSUES_MAX)} more`)).toBe(true);
  });
});
