/**
 * `readout --merge` (v2-balance-check §5.3-2: variants split into separate jobs with identical inputs). The merged
 * readout must equal the readout of the same variants run as one job, and any input that breaks "identical
 * inputs" is rejected before evaluation.
 */
import { describe, expect, it } from 'vitest';
import { PROVENANCE, SHA, smokeReport, validFrom } from '../test/support/sim-reports.js';
import { mergeResults, MergeError, parseMergeArgs } from './merge.js';
import { readout, type RunProvenance } from './readout.js';
import { toJson } from './report.js';
import type { SuiteReport } from './simulate.js';

function job(
  report: SuiteReport,
  ids: readonly string[],
  primary = 'greedy',
  provenance: RunProvenance = PROVENANCE,
): string {
  const variants = report.variants.filter((v) => ids.includes(v.id));
  const suite: SuiteReport = {
    ...report,
    matches: variants.reduce((a, v) => a + v.pairings.reduce((b, p) => b + p.matches, 0), 0),
    variants,
  };
  return toJson({ readout: readout(suite, primary, provenance), suite });
}

function code(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof MergeError) return e.code;
    throw e;
  }
  return 'ok';
}

describe('readout --merge', () => {
  const full = validFrom(smokeReport());
  const a = job(full, ['v1', 'v2-3612']);
  const b = job(full, ['v2-248', 'dx-dw-3612', 'dx-dw-248']);

  it('merges split jobs into the single readout of the whole run', () => {
    const merged = mergeResults([a, b]);
    expect(merged.primary).toBe('greedy');
    expect(merged.provenance).toEqual(PROVENANCE);
    expect(merged.suite.variants.map((v) => v.id)).toEqual([
      'v1',
      'v2-3612',
      'v2-248',
      'dx-dw-3612',
      'dx-dw-248',
    ]);
    expect(merged.suite.matches).toBe(
      full.variants.reduce((x, v) => x + v.pairings.reduce((y, p) => y + p.matches, 0), 0),
    );
    const expected = readout(full, 'greedy', PROVENANCE, { wallTimeSeconds: 3_000 });
    expect(merged.readout(3_000)).toEqual(expected);
    expect(expected.valid).toBe(true);
    // Order of the inputs does not matter.
    expect(mergeResults([b, a]).readout(3_000)).toEqual(expected);
  }, 300_000);

  it('rejects inputs that do not share the run inputs', () => {
    const other = (patch: Partial<SuiteReport>) => job({ ...full, ...patch }, ['v2-248']);
    expect(code(() => mergeResults([a, other({ masterSeed: '0123456789abcdef' })]))).toBe(
      'MISMATCH_SEED',
    );
    expect(code(() => mergeResults([a, other({ botVersion: 1 })]))).toBe('MISMATCH_BOT_VERSION');
    const prov = (p: Partial<RunProvenance>) =>
      job(full, ['v2-248'], 'greedy', { ...PROVENANCE, ...p });
    const other40 = 'b'.repeat(40);
    expect(code(() => mergeResults([a, prov({ codeCommit: other40 })]))).toBe(
      'MISMATCH_CODE_COMMIT',
    );
    expect(code(() => mergeResults([a, prov({ lexiconCommit: other40 })]))).toBe(
      'MISMATCH_LEXICON_COMMIT',
    );
    expect(code(() => mergeResults([a, prov({ preRegistrationBlob: other40 })]))).toBe(
      'MISMATCH_PREREG_BLOB',
    );
    expect(code(() => mergeResults([a, job(full, ['v2-248'], 'strategist')]))).toBe(
      'MISMATCH_PRIMARY',
    );
    expect(
      code(() => mergeResults([a, other({ strategistBudget: { maxNodes: 1, maxCandidates: 1 } })])),
    ).toBe('MISMATCH_STRATEGIST_BUDGET');
  }, 300_000);

  it('rejects duplicate variants, missing gating variants and malformed input', () => {
    expect(code(() => mergeResults([a, job(full, ['v2-3612', 'v2-248'])]))).toBe(
      'DUPLICATE_VARIANT',
    );
    expect(code(() => mergeResults([a]))).toBe('MISSING_VARIANT');
    expect(code(() => mergeResults([a, job(full, ['dx-dw-248'])]))).toBe('MISSING_VARIANT');
    expect(code(() => mergeResults([]))).toBe('NO_INPUT');
    expect(code(() => mergeResults([a, '{ not json']))).toBe('MALFORMED');
    expect(code(() => mergeResults([a, '{"suite": {}, "readout": {}}']))).toBe('SCHEMA');
    // `replayVerified` exists only in the suite section (the readout section is re-derived, not trusted).
    const fractional = b.replace(/"replayVerified": \d+/, '"replayVerified": 1.5');
    expect(fractional).not.toBe(b);
    expect(code(() => mergeResults([a, fractional]))).toBe('SCHEMA');
    expect(SHA).toHaveLength(40);
  }, 300_000);

  it('parses its arguments', () => {
    expect(
      parseMergeArgs([
        '--',
        '--merge',
        'a.json',
        'b.json',
        '--out',
        'r.json',
        '--markdown',
        'r.md',
        '--wall-time-s',
        '2700',
        '--lexicon-version',
        'lex-1',
        '--definition-hash',
        '0123456789abcdef',
      ]),
    ).toEqual({
      inputs: ['a.json', 'b.json'],
      out: 'r.json',
      markdown: 'r.md',
      wallTimeSeconds: 2_700,
      expected: { lexiconVersion: 'lex-1', definitionHash: '0123456789abcdef' },
    });
    expect(parseMergeArgs(['--merge', 'a.json'])).toMatchObject({
      inputs: ['a.json'],
      out: 'sim-results/balance-check-results.json',
      wallTimeSeconds: null,
      expected: {},
    });
    expect(() => parseMergeArgs([])).toThrow(/--merge/);
    expect(() => parseMergeArgs(['--merge'])).toThrow(/--merge/);
    expect(() => parseMergeArgs(['--merge', 'a', '--wall-time-s', '1.5'])).toThrow(/wall-time/);
    expect(() => parseMergeArgs(['--merge', 'a', '--definition-hash', 'xyz'])).toThrow(
      /definition-hash/,
    );
    expect(() => parseMergeArgs(['--merge', 'a', '--nope', 'x'])).toThrow(/unknown option/);
    expect(() => parseMergeArgs(['--merge', 'a', '--out'])).toThrow(/missing value/);
  });
});
