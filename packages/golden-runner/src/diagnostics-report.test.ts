import { canonicalJson } from '@codelex/game-engine/canonical';
import { describe, expect, it } from 'vitest';

import { diagnosticsReport } from '../test/fixtures.js';
import {
  DIAGNOSTICS_REPORT_MAX_BYTES,
  parseDiagnosticsReport,
  parseDiagnosticsReportText,
} from './index.js';

type Doc = Record<string, unknown>;

function at(report: Doc, ...keys: string[]): Doc {
  let current: Doc = report;
  for (const key of keys) current = current[key] as Doc;
  return current;
}
function paths(value: unknown): string[] {
  const result = parseDiagnosticsReport(value);
  if (result.ok) throw new Error('expected the report to be rejected');
  return result.error.map((issue) => issue.path);
}

describe('Diagnostics report diagnosticsFormat 1 (ADR-0016 §D4, E-1.5 "Device timings (H1)")', () => {
  it('accepts a preview report with device block, build info, runner report and H1 benches', () => {
    const input = diagnosticsReport();
    const result = parseDiagnosticsReport(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(canonicalJson(result.value)).toBe(canonicalJson(input));
  });

  it('accepts benches that were not measured, with a reason code', () => {
    const report = diagnosticsReport();
    const benches = at(report, 'benches');
    for (const key of Object.keys(benches)) {
      benches[key] = { status: 'not-measured', reason: 'no-fixture' };
    }
    expect(parseDiagnosticsReport(report).ok).toBe(true);
    benches['resume'] = { status: 'not-measured', reason: 'The app crashed: see logcat' };
    expect(paths(report)).toContain('$.benches.resume.reason');
  });

  it('requires every H1 bench section', () => {
    const report = diagnosticsReport();
    delete at(report, 'benches')['lexiconHas'];
    expect(paths(report)).toContain('$.benches.lexiconHas');
  });

  describe('privacy: device data only in this wrapper, only what H1 needs', () => {
    it.each<[string, (r: Doc) => void, string]>([
      ['an install id in device', (r) => (at(r, 'device')['installId'] = 'b7c1'), '$.device'],
      ['a serial number in device', (r) => (at(r, 'device')['serial'] = 'R58M'), '$.device'],
      ['an exact RAM size', (r) => (at(r, 'device')['ramClass'] = '5838MB'), '$.device.ramClass'],
      ['a user id at the top level', (r) => (r['userId'] = 'u1'), '$'],
      ['a timestamp at the top level', (r) => (r['createdAt'] = 1760000000000), '$'],
      [
        'a device block inside the runner report',
        (r) => (at(r, 'runner')['device'] = {}),
        '$.runner',
      ],
      ['a non-preview build', (r) => (at(r, 'build')['profile'] = 'production'), '$.build.profile'],
      [
        'a development build',
        (r) => (at(r, 'build')['profile'] = 'development'),
        '$.build.profile',
      ],
      ['a non-ASCII model name', (r) => (at(r, 'device')['model'] = 'Galaxy A¹'), '$.device.model'],
    ])('rejects %s', (_name, mutate, path) => {
      const report = diagnosticsReport();
      mutate(report);
      expect(paths(report)).toContain(path);
    });
  });

  describe('build and runner', () => {
    it('requires a full lowercase git sha', () => {
      const report = diagnosticsReport();
      at(report, 'build')['gitSha'] = 'e855522';
      expect(paths(report)).toContain('$.build.gitSha');
    });

    it('requires the runner report to come from the app runtime', () => {
      const report = diagnosticsReport();
      at(report, 'runner')['runtime'] = { kind: 'node', version: 'v22' };
      expect(paths(report)).toEqual(['$.runner.runtime.kind']);
    });

    it('validates the embedded runner report with the runner schema', () => {
      const report = diagnosticsReport();
      at(report, 'runner')['verdict'] = 'fail';
      expect(paths(report)).toEqual(['$.runner.verdict']);
    });
  });

  describe('timings: integers with an explicit unit', () => {
    it.each<[string, (r: Doc) => void, string]>([
      [
        'a fractional percentile',
        (r) => (at(r, 'benches', 'engineApply', 'timing')['p95'] = 120.5),
        '$.benches.engineApply.timing.p95',
      ],
      [
        'a missing unit',
        (r) => delete at(r, 'benches', 'lexiconHas', 'timing')['unit'],
        '$.benches.lexiconHas.timing.unit',
      ],
      [
        'an unknown unit',
        (r) => (at(r, 'benches', 'resume', 'timing')['unit'] = 's'),
        '$.benches.resume.timing.unit',
      ],
      [
        'percentiles out of order',
        (r) => (at(r, 'benches', 'resume', 'timing')['p95'] = 1),
        '$.benches.resume.timing',
      ],
      [
        'zero samples',
        (r) => (at(r, 'benches', 'resume', 'timing')['samples'] = 0),
        '$.benches.resume.timing.samples',
      ],
      [
        'a fractional constant',
        (r) => (at(r, 'benches', 'constants', 'cNode')['value'] = 9.5),
        '$.benches.constants.cNode.value',
      ],
      [
        'node counts out of order',
        (r) => {
          const bots = at(r, 'benches', 'botThink')['bots'] as Doc[];
          bots[0]!['nodes'] = { p50: 10, p95: 5, p99: 20, max: 30 };
        },
        '$.benches.botThink.bots[0].nodes',
      ],
      [
        'an unknown automaton',
        (r) => (at(r, 'benches', 'constants')['automaton'] = 'trie'),
        '$.benches.constants.automaton',
      ],
    ])('rejects %s', (_name, mutate, path) => {
      const report = diagnosticsReport();
      mutate(report);
      expect(paths(report)).toContain(path);
    });
  });

  describe('decision equality and drift', () => {
    it('requires 20 positions per bot and equal + mismatches = positions', () => {
      const report = diagnosticsReport();
      const bots = at(report, 'benches', 'decisionEquality')['bots'] as Doc[];
      bots[1]!['equal'] = 20;
      expect(paths(report)).toContain('$.benches.decisionEquality.bots[1]');
      bots[1]!['equal'] = 19;
      bots[1]!['positions'] = 21;
      expect(paths(report)).toContain('$.benches.decisionEquality.bots[1].positions');
    });

    it('lists each bot once and each mismatched position once', () => {
      const report = diagnosticsReport();
      const bots = at(report, 'benches', 'decisionEquality')['bots'] as Doc[];
      bots[1]!['mismatchedPositionIds'] = ['p1', 'p1'];
      bots[1]!['equal'] = 18;
      expect(paths(report)).toContain('$.benches.decisionEquality.bots[1].mismatchedPositionIds');

      const twice = diagnosticsReport();
      const equality = at(twice, 'benches', 'decisionEquality')['bots'] as Doc[];
      equality[1]!['botId'] = 'beginner';
      expect(paths(twice)).toContain('$.benches.decisionEquality.bots');

      const think = diagnosticsReport();
      const thinkBots = at(think, 'benches', 'botThink')['bots'] as Doc[];
      thinkBots[1]!['botId'] = 'beginner';
      expect(paths(think)).toContain('$.benches.botThink.bots');
    });

    it('requires exactly 10 matches for drift', () => {
      const report = diagnosticsReport();
      (at(report, 'benches', 'drift')['matches'] as unknown[]).pop();
      expect(paths(report)).toContain('$.benches.drift.matches');
    });

    it('requires a personality-like bot id', () => {
      const report = diagnosticsReport();
      at(report, 'benches', 'drift')['botId'] = 'Strategist v2';
      expect(paths(report)).toContain('$.benches.drift.botId');
    });
  });

  describe('size and text', () => {
    it('bounds every list of the wrapper, so only the runner report can be large', () => {
      const report = diagnosticsReport();
      const bots = at(report, 'benches', 'decisionEquality')['bots'] as Doc[];
      bots[0]!['mismatchedPositionIds'] = Array.from({ length: 21 }, (_, i) => `p${String(i)}`);
      expect(paths(report)).toContain('$.benches.decisionEquality.bots[0].mismatchedPositionIds');
      const many = diagnosticsReport();
      const think = at(many, 'benches', 'botThink');
      const first = (think['bots'] as Doc[])[0];
      think['bots'] = Array.from({ length: 17 }, () => first);
      expect(paths(many)).toContain('$.benches.botThink.bots');
    });

    it('rejects an oversize embedded runner report', () => {
      const report = diagnosticsReport();
      const runner = at(report, 'runner');
      const cases = Array.from({ length: 1300 }, (_, i) => ({
        id: `case-${String(i)}`,
        status: 'pass',
        observed: 'x'.repeat(200),
      }));
      (runner['suites'] as Doc[])[0] = {
        id: 'rng',
        cases,
        summary: { pass: cases.length, fail: 0, error: 0 },
      };
      expect(paths(report)).toEqual(['$.runner']);
    });

    it('parses report text and rejects oversize text before decoding', () => {
      expect(parseDiagnosticsReportText(JSON.stringify(diagnosticsReport())).ok).toBe(true);
      const huge = `${JSON.stringify(diagnosticsReport())}${' '.repeat(DIAGNOSTICS_REPORT_MAX_BYTES)}`;
      const result = parseDiagnosticsReportText(huge);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error[0]?.message).toMatch(/^Diagnostics report is \d+ bytes/);
    });
  });
});

describe('Diagnostics parse keeps the bytes it was given', () => {
  it('rejects a "__proto__" key that zod would drop', () => {
    const text = JSON.stringify(diagnosticsReport()).replace('"cNode":', '"__proto__":{},"cNode":');
    expect(parseDiagnosticsReportText(text).ok).toBe(false);
  });
});

describe('nesting inside the wrapper', () => {
  function nested(levels: number): unknown {
    let value: unknown = 1;
    for (let i = 0; i < levels; i++) value = [value];
    return value;
  }
  function withObserved(observed: unknown): Doc {
    const report = diagnosticsReport();
    const runner = at(report, 'runner');
    ((runner['suites'] as Doc[])[0]!['cases'] as Doc[])[0]!['observed'] = observed;
    return report;
  }

  it('accepts the deepest observed a runner report allows', () => {
    expect(parseDiagnosticsReport(withObserved(nested(32))).ok).toBe(true);
  });

  it('rejects deeper observed values with a depth message, never a misleading one', () => {
    const result = parseDiagnosticsReport(withObserved(nested(59)));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual([
        { path: '$', message: 'nested deeper than 64 levels: outside the ADR-0013 §D3 subset' },
      ]);
    }
    const shallower = parseDiagnosticsReport(withObserved(nested(40)));
    expect(shallower.ok).toBe(false);
    if (!shallower.ok) {
      expect(shallower.error).toEqual([
        {
          path: '$.runner.suites[0].cases[0].observed',
          message: 'observed is nested deeper than 32 levels: outside the ADR-0013 §D3 subset',
        },
      ]);
    }
  });
});
