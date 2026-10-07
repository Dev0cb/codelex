import { canonicalJson } from '@codelex/game-engine/canonical';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { clone, hermesReport, nodeReport } from '../test/fixtures.js';
import {
  checkRunnerReportSize,
  OBSERVED_MAX_BYTES,
  OBSERVED_MAX_DEPTH,
  parseRunnerReport,
  parseRunnerReportText,
  RUNNER_REPORT_MAX_BYTES,
  type RunnerReport,
} from './index.js';

type Doc = Record<string, unknown>;

const TOO_DEEP_64 = 'nested deeper than 64 levels: outside the ADR-0013 §D3 subset';

/** `levels` nested arrays around 1 (`nested(1)` is `[1]`). */
function nested(levels: number): unknown {
  let value: unknown = 1;
  for (let i = 0; i < levels; i++) value = [value];
  return value;
}

function suites(report: Doc): Doc[] {
  return report['suites'] as Doc[];
}
function casesOf(report: Doc, suite: number): Doc[] {
  return suites(report)[suite]!['cases'] as Doc[];
}
function issuesFor(value: unknown): { path: string; message: string }[] {
  const result = parseRunnerReport(value);
  if (result.ok) throw new Error('expected the report to be rejected');
  return result.error;
}
function paths(value: unknown): string[] {
  return issuesFor(value).map((issue) => issue.path);
}

describe('runner report runnerFormat 1 (ADR-0016 §D3.1)', () => {
  it('accepts a Node-like report and returns it unchanged', () => {
    const input = nodeReport();
    const result = parseRunnerReport(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(canonicalJson(result.value)).toBe(canonicalJson(input));
  });

  it('accepts a hand-made Hermes CLI report and a report without timings', () => {
    expect(parseRunnerReport(hermesReport()).ok).toBe(true);
    const report = nodeReport();
    delete report['timings'];
    expect(parseRunnerReport(report).ok).toBe(true);
  });

  it('accepts a failing report whose verdict is fail', () => {
    const report = nodeReport();
    casesOf(report, 0)[0]!['status'] = 'fail';
    suites(report)[0]!['summary'] = { pass: 1, fail: 1, error: 0 };
    report['verdict'] = 'fail';
    expect(parseRunnerReport(report).ok).toBe(true);
  });

  describe('values stay in the ADR-0013 §D3 JCS subset', () => {
    it.each<[string, unknown]>([
      ['a fraction', 1.5],
      ['negative zero', -0],
      ['an unsafe integer', 2 ** 53],
      ['a boolean', true],
      ['null', null],
      ['a non-ASCII string', 'café'],
      ['a control character', 'a\nb'],
      ['a fraction nested in an array', [1, [2.25]]],
      ['a boolean nested in an object', { ok: false }],
      ['a non-ASCII key', { clé: 1 }],
    ])('rejects %s in observed', (_name, observed) => {
      const report = nodeReport();
      casesOf(report, 0)[0]!['observed'] = observed;
      expect(paths(report).some((p) => p.startsWith('$.suites[0].cases[0].observed'))).toBe(true);
    });

    it('rejects a document nested deeper than the engine serialiser allows, before zod', () => {
      const report = nodeReport();
      casesOf(report, 0)[0]!['observed'] = nested(70);
      expect(issuesFor(report)).toEqual([{ path: '$', message: TOO_DEEP_64 }]);
    });

    it(`limits observed to ${String(OBSERVED_MAX_DEPTH)} levels with a clear message`, () => {
      const report = nodeReport();
      casesOf(report, 0)[0]!['observed'] = nested(OBSERVED_MAX_DEPTH);
      expect(parseRunnerReport(report).ok).toBe(true);
      casesOf(report, 0)[0]!['observed'] = nested(OBSERVED_MAX_DEPTH + 1);
      expect(issuesFor(report)).toEqual([
        {
          path: '$.suites[0].cases[0].observed',
          message: 'observed is nested deeper than 32 levels: outside the ADR-0013 §D3 subset',
        },
      ]);
    });

    it('rejects a 100,000-deep text (200 KB) without overflowing the stack', () => {
      const deep = `${'['.repeat(100_000)}1${']'.repeat(100_000)}`;
      const text = JSON.stringify(nodeReport()).replace('[1,2,4294967295,0]', deep);
      expect(parseRunnerReportText(text)).toEqual({
        ok: false,
        error: [{ path: '$', message: TOO_DEEP_64 }],
      });
    });

    it('rejects a "__proto__" key that JSON.parse made an own property', () => {
      const report = nodeReport();
      casesOf(report, 0)[0]!['observed'] = JSON.parse('{"__proto__":{"x":1}}') as unknown;
      expect(issuesFor(report)).toEqual([
        { path: '$', message: expect.stringContaining('__proto__') as unknown },
      ]);
    });

    it('rejects fractions and non-ASCII outside observed too', () => {
      const report = nodeReport();
      report['timings'] = { rng: { totalMs: 2.5 } };
      expect(paths(report)).toContain('$.timings.rng.totalMs');
      const other = nodeReport();
      other['runtime'] = { kind: 'node', version: 'v22–lts' };
      expect(paths(other)).toContain('$.runtime.version');
    });

    it('rejects a boolean verdict', () => {
      const report = nodeReport();
      report['verdict'] = true;
      expect(paths(report)).toContain('$.verdict');
    });
  });

  describe('cases', () => {
    it('requires errorCode on an error case and forbids observed there', () => {
      const report = nodeReport();
      casesOf(report, 1)[0] = { id: 'nist/abc', status: 'error' };
      suites(report)[1]!['summary'] = { pass: 0, fail: 0, error: 1 };
      report['verdict'] = 'fail';
      expect(paths(report)).toContain('$.suites[1].cases[0].errorCode');

      casesOf(report, 1)[0] = { id: 'nist/abc', status: 'error', errorCode: 'RangeError' };
      expect(parseRunnerReport(report).ok).toBe(true);

      casesOf(report, 1)[0] = {
        id: 'nist/abc',
        status: 'error',
        errorCode: 'RangeError',
        observed: 'x',
      };
      expect(paths(report)).toContain('$.suites[1].cases[0]');
    });

    it('forbids errorCode on pass and fail cases', () => {
      const report = nodeReport();
      casesOf(report, 0)[0]!['errorCode'] = 'TypeError';
      expect(paths(report)).toContain('$.suites[0].cases[0]');
    });

    it('requires observed on pass and fail cases', () => {
      const report = nodeReport();
      delete casesOf(report, 0)[0]!['observed'];
      expect(paths(report)).toContain('$.suites[0].cases[0].observed');
    });

    it('rejects an error message or stack trace as errorCode', () => {
      const report = nodeReport();
      casesOf(report, 1)[0] = {
        id: 'nist/abc',
        status: 'error',
        errorCode: 'TypeError: x is undefined at foo (runner.js:1:2)',
      };
      suites(report)[1]!['summary'] = { pass: 0, fail: 0, error: 1 };
      report['verdict'] = 'fail';
      expect(paths(report)).toContain('$.suites[1].cases[0].errorCode');
    });

    it(`limits observed to ${String(OBSERVED_MAX_BYTES)} canonical bytes`, () => {
      const report = nodeReport();
      // A string of n characters is n + 2 canonical bytes.
      casesOf(report, 0)[0]!['observed'] = 'a'.repeat(OBSERVED_MAX_BYTES - 2);
      expect(parseRunnerReport(report).ok).toBe(true);
      casesOf(report, 0)[0]!['observed'] = 'a'.repeat(OBSERVED_MAX_BYTES - 1);
      expect(paths(report)).toContain('$.suites[0].cases[0].observed');
    });

    it('rejects duplicate case ids and duplicate suite ids', () => {
      const report = nodeReport();
      casesOf(report, 0)[1]!['id'] = 'pcg32/seed-0/first-8';
      expect(paths(report)).toContain('$.suites[0].cases[1].id');
      const other = nodeReport();
      suites(other)[1]!['id'] = 'rng';
      expect(paths(other)).toContain('$.suites[1].id');
    });

    it('rejects an empty suite and a report without suites', () => {
      const report = nodeReport();
      suites(report)[0]!['cases'] = [];
      suites(report)[0]!['summary'] = { pass: 0, fail: 0, error: 0 };
      expect(paths(report)).toContain('$.suites[0].cases');
      const empty = nodeReport();
      empty['suites'] = [];
      empty['timings'] = {};
      expect(paths(empty)).toContain('$.suites');
    });
  });

  describe('consistency', () => {
    it('rejects a summary that does not count the cases', () => {
      const report = nodeReport();
      suites(report)[0]!['summary'] = { pass: 1, fail: 1, error: 0 };
      expect(paths(report)).toEqual(['$.suites[0].summary.pass', '$.suites[0].summary.fail']);
    });

    it('rejects a verdict that does not match the cases', () => {
      const report = nodeReport();
      report['verdict'] = 'fail';
      expect(paths(report)).toEqual(['$.verdict']);
      const failing = nodeReport();
      casesOf(failing, 0)[0]!['status'] = 'fail';
      suites(failing)[0]!['summary'] = { pass: 1, fail: 1, error: 0 };
      expect(paths(failing)).toEqual(['$.verdict']);
    });

    it('rejects timings for a suite that is not in the report', () => {
      const report = nodeReport();
      report['timings'] = { 'replays/v9': { totalMs: 1 } };
      expect(paths(report)).toEqual(['$.timings["replays/v9"]']);
    });

    it.each<[string, (r: Doc) => void, string]>([
      ['runnerFormat 2', (r) => (r['runnerFormat'] = 2), '$.runnerFormat'],
      [
        'an upper-case digest',
        (r) => ((r['corpus'] as Doc)['digest'] = 'AB'.repeat(32)),
        '$.corpus.digest',
      ],
      [
        'unordered engineRulesVersions',
        (r) => ((r['corpus'] as Doc)['engineRulesVersions'] = [2, 1]),
        '$.corpus.engineRulesVersions',
      ],
      [
        'repeated engineRulesVersions',
        (r) => ((r['corpus'] as Doc)['engineRulesVersions'] = [1, 1]),
        '$.corpus.engineRulesVersions',
      ],
      ['botVersion 0', (r) => ((r['corpus'] as Doc)['botVersion'] = 0), '$.corpus.botVersion'],
      ['a suite id with spaces', (r) => (suites(r)[0]!['id'] = 'Rng Suite'), '$.suites[0].id'],
      [
        'a Hermes runtime without bytecodeVersion',
        (r) => (r['runtime'] = { kind: 'hermes-cli', version: '1' }),
        '$.runtime.bytecodeVersion',
      ],
      [
        'an unknown runtime kind',
        (r) => (r['runtime'] = { kind: 'jsc', version: '1' }),
        '$.runtime.kind',
      ],
      [
        'negative timings',
        (r) => (r['timings'] = { rng: { totalMs: -1 } }),
        '$.timings.rng.totalMs',
      ],
    ])('rejects %s', (_name, mutate, path) => {
      const report = nodeReport();
      mutate(report);
      expect(paths(report)).toContain(path);
    });
  });

  describe('no device or user data (§D3.1)', () => {
    it.each<[string, (r: Doc) => void, string]>([
      ['a top-level device block', (r) => (r['device'] = { model: 'Pixel 6a' }), '$'],
      ['an install id', (r) => (r['installId'] = 'b7c1'), '$'],
      [
        'a device model in runtime',
        (r) => ((r['runtime'] as Doc)['model'] = 'Pixel 6a'),
        '$.runtime',
      ],
      ['an OS version in corpus', (r) => ((r['corpus'] as Doc)['osVersion'] = '14'), '$.corpus'],
      [
        'a stack trace on a case',
        (r) => (casesOf(r, 0)[0]!['stack'] = 'at x'),
        '$.suites[0].cases[0]',
      ],
      [
        'device timings in timings',
        (r) => (r['timings'] = { rng: { totalMs: 1, deviceModel: 'x' } }),
        '$.timings.rng',
      ],
    ])('rejects %s', (_name, mutate, path) => {
      const report = nodeReport();
      mutate(report);
      expect(paths(report)).toContain(path);
    });
  });

  describe('size (≤ 256 KB, §D3.1 / §D7)', () => {
    function bigReport(cases: number): Doc {
      const report = nodeReport();
      const list = Array.from({ length: cases }, (_, i) => ({
        id: `case-${String(i).padStart(6, '0')}`,
        status: 'pass',
        observed: 'x'.repeat(200),
      }));
      suites(report)[0] = { id: 'rng', cases: list, summary: { pass: cases, fail: 0, error: 0 } };
      return report;
    }

    it('accepts a report just under the limit and rejects one over it', () => {
      const small = bigReport(1000);
      expect(checkRunnerReportSize(small).withinLimit).toBe(true);
      expect(parseRunnerReport(small).ok).toBe(true);

      const big = bigReport(1200);
      const size = checkRunnerReportSize(big);
      expect(size.withinLimit).toBe(false);
      expect(size.bytes).toBeGreaterThan(RUNNER_REPORT_MAX_BYTES);
      expect(issuesFor(big)).toEqual([
        {
          path: '$',
          message: `report is ${String(size.bytes)} canonical bytes, above the ${String(RUNNER_REPORT_MAX_BYTES)}-byte limit`,
        },
      ]);
    });

    it('rejects oversize text before decoding it', () => {
      const text = `${JSON.stringify(nodeReport())}${' '.repeat(RUNNER_REPORT_MAX_BYTES)}`;
      const result = parseRunnerReportText(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error[0]?.message).toMatch(/above the 262144-byte limit/);
    });

    it('reports a value outside the subset as having no size', () => {
      expect(checkRunnerReportSize({ x: 0.5 })).toEqual({ bytes: undefined, withinLimit: false });
    });
  });

  describe('text', () => {
    it('parses report text, including pretty-printed text', () => {
      expect(parseRunnerReportText(JSON.stringify(nodeReport())).ok).toBe(true);
      expect(parseRunnerReportText(JSON.stringify(nodeReport(), null, 2)).ok).toBe(true);
    });

    it('rejects text that is not JSON without echoing it', () => {
      expect(parseRunnerReportText('{"runnerFormat":1,')).toEqual({
        ok: false,
        error: [{ path: '$', message: 'runner report is not valid JSON' }],
      });
    });

    it('rejects a JSON -0 (JSON.parse keeps the sign)', () => {
      const text = JSON.stringify(nodeReport()).replace('"botVersion":2', '"botVersion":-0');
      expect(parseRunnerReportText(text).ok).toBe(false);
    });
  });

  describe('properties', () => {
    const ascii = fc.string({
      unit: fc.integer({ min: 0x20, max: 0x7e }).map((c) => String.fromCharCode(c)),
    });
    const observed = fc.letrec<{ v: unknown }>((tie) => ({
      v: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        ascii,
        fc.maxSafeInteger().filter((n) => !Object.is(n, -0)),
        fc.array(tie('v'), { maxLength: 4 }),
        fc.dictionary(
          ascii.filter((k) => k !== '__proto__'),
          tie('v'),
          { maxKeys: 4 },
        ),
      ),
    })).v;

    it('every well-formed report parses to the same canonical bytes', () => {
      fc.assert(
        fc.property(fc.array(observed, { minLength: 1, maxLength: 5 }), (values) => {
          const report = nodeReport();
          const list = values.map((v, i) => ({ id: `c${String(i)}`, status: 'pass', observed: v }));
          suites(report)[0] = {
            id: 'rng',
            cases: list,
            summary: { pass: list.length, fail: 0, error: 0 },
          };
          const result = parseRunnerReport(clone(report));
          const allFit = values.every((v) => canonicalJson(v).length <= OBSERVED_MAX_BYTES);
          expect(result.ok).toBe(allFit);
          if (result.ok) {
            const parsed: RunnerReport = result.value;
            expect(canonicalJson(parsed)).toBe(canonicalJson(report));
          }
        }),
        { seed: 20261007, numRuns: 200 },
      );
    });
  });
});
