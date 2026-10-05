/**
 * Integer CIs added for the V1 readout (v2-balance-check §3.2): the C-11 mean CI and the C-05 delta-method ratio
 * CI. Reference values were computed independently in double precision; the integer versions must bracket them
 * (lo rounded down, hi rounded up) within one unit.
 */
import { describe, expect, it } from 'vitest';
import { ceilSqrt, meanCiTenths, ratioCiBp } from './stats.js';

describe('ceilSqrt', () => {
  it('is the ceiling square root', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 15, 16, 17, 1_000_001, 2_500_000_000_000]) {
      const r = ceilSqrt(n);
      expect(r * r).toBeGreaterThanOrEqual(n);
      if (r > 0) expect((r - 1) * (r - 1)).toBeLessThan(n);
    }
    expect(() => ceilSqrt(-1)).toThrow(RangeError);
  });
});

describe('meanCiTenths (C-11)', () => {
  it('normal 95 % CI from the sample standard deviation, outward-rounded', () => {
    // values 88, 92, 90, 94, 86: mean 90, sd 3.1623, half 1.96·sd/√5 = 2.772.
    expect(meanCiTenths([88, 92, 90, 94, 86], 100)).toEqual({
      n: 5,
      meanTenths: 900,
      ci95: { lo: 872, hi: 928 },
    });
    expect(meanCiTenths([90, 90, 90], 100)).toEqual({
      n: 3,
      meanTenths: 900,
      ci95: { lo: 900, hi: 900 },
    });
    expect(meanCiTenths([95], 100)).toEqual({ n: 1, meanTenths: 950, ci95: { lo: 0, hi: 1000 } });
    expect(meanCiTenths([], 100)).toEqual({ n: 0, meanTenths: 0, ci95: { lo: 0, hi: 1000 } });
  });

  it('stays in safe integers at the pre-registered size (10,000 matches, values 0..100)', () => {
    const values = Array.from({ length: 10_000 }, (_, i) => (i % 2 === 0 ? 0 : 100));
    const r = meanCiTenths(values, 100);
    expect(r.meanTenths).toBe(500);
    // sd = 50.0025, half = 0.98 → 9.8 tenths.
    expect(r.ci95).toEqual({ lo: 490, hi: 510 });
  });
});

describe('ratioCiBp (C-05 delta method)', () => {
  it('matches the double-precision reference, outward-rounded', () => {
    // B = [30, 50, 20, 40], T = [100, 150, 90, 110]: R = 0.31111, SE = 0.0269 → [25.84 %, 36.38 %].
    const r = ratioCiBp([30, 50, 20, 40], [100, 150, 90, 110]);
    expect(r.bp).toBe(3111);
    expect(r.ci95.lo).toBeGreaterThanOrEqual(2583);
    expect(r.ci95.lo).toBeLessThanOrEqual(2584);
    expect(r.ci95.hi).toBeGreaterThanOrEqual(3638);
    expect(r.ci95.hi).toBeLessThanOrEqual(3639);
  });

  it('is exact for a constant ratio and total for degenerate input', () => {
    // Zero true residuals: only the conservative rounding of R (millionths) widens the interval, by ≤ 1 bp.
    expect(ratioCiBp([25, 50, 75], [100, 200, 300])).toEqual({
      n: 3,
      bp: 2500,
      ci95: { lo: 2499, hi: 2501 },
    });
    expect(ratioCiBp([1], [4])).toEqual({ n: 1, bp: 2500, ci95: { lo: 0, hi: 10_000 } });
    expect(ratioCiBp([0, 0], [0, 0])).toEqual({ n: 2, bp: 0, ci95: { lo: 0, hi: 10_000 } });
    expect(() => ratioCiBp([1], [1, 2])).toThrow(RangeError);
  });

  it('stays in safe integers at the pre-registered size with extreme residuals', () => {
    const b = Array.from({ length: 10_000 }, (_, i) => (i % 2 === 0 ? 0 : 1_000));
    const t = Array.from({ length: 10_000 }, (_, i) => (i % 2 === 0 ? 1_500 : 1_000));
    const r = ratioCiBp(b, t);
    // R = 0.4, SE ≈ 0.0048 → [39.06 %, 40.94 %].
    expect(r.bp).toBe(4000);
    expect(r.ci95.lo).toBeGreaterThanOrEqual(3904);
    expect(r.ci95.lo).toBeLessThanOrEqual(3905);
    expect(r.ci95.hi).toBeGreaterThanOrEqual(4095);
    expect(r.ci95.hi).toBeLessThanOrEqual(4096);
  });
});
