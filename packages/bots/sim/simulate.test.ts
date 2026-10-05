/**
 * Smoke test of the B2 simulator (CI-gating, small): integer statistics, the JSON writer, option parsing, and a
 * short seeded suite on the real lexicon variants (every match replayed, report deterministic). The full run
 * (≥ 1,000 matches) is the `simulate` script, never part of `pnpm test`.
 */
import type { PlaceWordAction, WordScore } from '@codelex/game-engine';
import { describe, expect, it } from 'vitest';
import { toJson, toMarkdown } from './report.js';
import { RULES_V1 } from './rules.js';
import { isHookedInflection, matchSeed, runSuite, seatsFor, type SuiteSpec } from './simulate.js';
import { fixed, isqrt, meanTenths, pct, percentile, rateBp, spread, wilsonBp } from './stats.js';
import { NO_INFLECTIONS_PROFILE, pairingsFor, parseOptions, realVariants } from './variants.js';

describe('integer statistics', () => {
  it('isqrt is the floor square root', () => {
    for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 99, 100, 1_000_000, 2_500_000_000_000]) {
      const r = isqrt(n);
      expect(r * r).toBeLessThanOrEqual(n);
      expect((r + 1) * (r + 1)).toBeGreaterThan(n);
    }
    expect(() => isqrt(-1)).toThrow(RangeError);
  });

  it('Wilson 95 % intervals match published values', () => {
    expect(wilsonBp(50, 100)).toEqual({ lo: 4038, hi: 5962 });
    expect(wilsonBp(0, 10)).toEqual({ lo: 0, hi: 2776 });
    expect(wilsonBp(10, 10)).toEqual({ lo: 7224, hi: 10_000 });
    expect(wilsonBp(520, 1_000)).toEqual({ lo: 4890, hi: 5509 });
    expect(wilsonBp(0, 0)).toEqual({ lo: 0, hi: 10_000 });
    expect(() => wilsonBp(1, 20_000)).toThrow(RangeError);
  });

  it('rates, percentiles and fixed-point strings', () => {
    expect(rateBp(1, 3)).toBe(3333);
    expect(rateBp(2, 3)).toBe(6667);
    expect(rateBp(0, 0)).toBe(0);
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
    expect(spread([5, 1, 4, 2, 3])).toEqual({ p50: 3, p95: 5, max: 5 });
    expect(spread([])).toEqual({ p50: 0, p95: 0, max: 0 });
    expect(fixed(5231, 2)).toBe('52.31');
    expect(fixed(-15, 1)).toBe('-1.5');
    expect(fixed(7, 0)).toBe('7');
    expect(pct(5)).toBe('0.05 %');
    expect(meanTenths(7, 2)).toBe(35);
    expect(meanTenths(1, 0)).toBe(0);
  });
});

describe('report writers', () => {
  it('writes JSON that parses back to the same data', () => {
    const data = { a: 1, b: [1, 2], c: [{ d: 'x"\\é' }], e: {}, f: [], g: true, h: null };
    expect(JSON.parse(toJson(data))).toEqual(data);
    expect(() => toJson({ x: 0.5 })).toThrow(RangeError);
  });
});

describe('options', () => {
  it('defaults and overrides', () => {
    expect(parseOptions([])).toMatchObject({ mirror: 1_000, pair: 500, seed: '2026100300000b02' });
    expect(
      parseOptions([
        '--mirror',
        '4',
        '--pair',
        '2',
        '--variants',
        'with',
        '--seed',
        '0123456789abcdef',
      ]),
    ).toMatchObject({ mirror: 4, pair: 2, variants: ['with'], seed: '0123456789abcdef' });
    expect(parseOptions(['--out', 'a.json', '--markdown', 'b.md'])).toMatchObject({
      out: 'a.json',
      markdown: 'b.md',
    });
    expect(parseOptions(['--', '--pair', '3'])).toMatchObject({ pair: 3 });
    expect(() => parseOptions(['--mirror'])).toThrow(/missing/);
    expect(() => parseOptions(['--mirror', 'x'])).toThrow(/count/);
    expect(() => parseOptions(['--seed', 'XYZ'])).toThrow(/hex/);
    expect(() => parseOptions(['--variants', 'both'])).toThrow(/with, without/);
    expect(() => parseOptions(['--nope', '1'])).toThrow(/unknown/);
  });

  it('pairs the mirror across variants on the same seeds and swaps seats', () => {
    const p = pairingsFor(parseOptions(['--mirror', '3', '--pair', '2']));
    expect(p.with[0]).toEqual(p.without[0]);
    expect(p.with.map((x) => x.id)).toEqual([
      'beginner-mirror',
      'beginner-vs-random',
      'greedy-vs-beginner',
    ]);
    const pairing = p.with[2];
    if (pairing === undefined) throw new Error('unreachable');
    expect(seatsFor(pairing, 0)).toEqual(['greedy', 'beginner']);
    expect(seatsFor(pairing, 1)).toEqual(['beginner', 'greedy']);
    expect(matchSeed('2026100300000b02', 0, 1)).toBe(matchSeed('2026100300000b02', 0, 1));
    expect(matchSeed('2026100300000b02', 0, 1)).not.toBe(matchSeed('2026100300000b02', 1, 1));
    expect(matchSeed('2026100300000b02', 0, 1)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('C-09 hooked inflection', () => {
  const word = (form: string, canonicalForm: string): WordScore => ({
    form,
    termId: canonicalForm.toLowerCase(),
    canonicalForm,
    difficulty: 'novice',
    main: false,
    start: { row: 7, col: 5 },
    direction: 'row',
    letterSum: 0,
    wordMult: 1,
    base: 0,
    techBonus: 0,
    compileBonus: 0,
    termBonus: 5,
    total: 5,
  });
  const at = (col: number): PlaceWordAction => ({
    seat: 0,
    type: 'PLACE_WORD',
    tiles: [{ row: 7, col, tile: 'S' }],
  });

  it('counts one tile added at either end of the canonical form only', () => {
    expect(isHookedInflection(word('PODS', 'POD'), at(8))).toBe(true);
    expect(isHookedInflection(word('POD', 'POD'), at(7))).toBe(false);
    expect(isHookedInflection(word('PODS', 'POD'), at(6))).toBe(false);
    expect(isHookedInflection(word('PODS', 'POD'), at(12))).toBe(false);
    expect(isHookedInflection(word('SPOD', 'POD'), at(5))).toBe(true);
    const two: PlaceWordAction = {
      seat: 0,
      type: 'PLACE_WORD',
      tiles: [
        { row: 7, col: 7, tile: 'D' },
        { row: 7, col: 8, tile: 'S' },
      ],
    };
    expect(isHookedInflection(word('PODS', 'POD'), two)).toBe(false);
    const column = { ...word('PODS', 'POD'), direction: 'col' as const };
    expect(isHookedInflection(column, { ...at(5), tiles: [{ row: 10, col: 5, tile: 'S' }] })).toBe(
      true,
    );
    expect(isHookedInflection(column, { ...at(5), tiles: [{ row: 10, col: 6, tile: 'S' }] })).toBe(
      false,
    );
  });
});

describe('short seeded suite on the real lexicon', () => {
  const lexicons = realVariants();
  const pairings = pairingsFor(parseOptions(['--mirror', '2', '--pair', '2']));
  const spec: SuiteSpec = {
    masterSeed: '2026100300000b02',
    variants: [
      { id: 'with-inflections', lexicon: lexicons.with, rules: RULES_V1, pairings: pairings.with },
      {
        id: 'without-inflections',
        lexicon: lexicons.without,
        rules: RULES_V1,
        pairings: pairings.without,
      },
    ],
  };

  it('plays, replays and aggregates every pairing; same seeds ⇒ same report', () => {
    const seen: string[] = [];
    const report = runSuite(spec, { onMatch: (v, p, i) => seen.push(`${v}/${p}/${String(i)}`) });
    expect(report.matches).toBe(8);
    expect(seen).toHaveLength(8);
    expect(lexicons.without.profile.id).toBe(NO_INFLECTIONS_PROFILE.id);
    expect(lexicons.without.version).toBe(lexicons.with.version);
    expect(lexicons.without.size).toBeLessThan(lexicons.with.size);
    for (const variant of report.variants) {
      expect(variant.automaton).toBe('gaddag');
      for (const p of variant.pairings) {
        expect(p.replayVerified).toBe(p.matches);
        expect(p.endReasons.resign).toBe(0);
        expect(p.firstPlayerWin.n + p.draws).toBe(p.matches);
        for (const s of p.personalities) expect(s.decisions).toBeGreaterThan(0);
      }
      if (variant.id === 'without-inflections') {
        expect(variant.pairings[0]?.inflectionShareBp).toBe(0);
        expect(variant.pairings[0]?.hookTermBonusShareBp).toBe(0);
      }
    }
    expect(runSuite(spec)).toEqual(report);
    const markdown = toMarkdown(report);
    expect(markdown).toContain('### with-inflections');
    expect(markdown).toContain('n/a (mirror)');
  }, 120_000);
});
