import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  distribution,
  fitConstants,
  MIN_FIT_SAMPLES,
  percentile,
  roundInt,
  type DecisionSample,
} from './stats.js';

describe('percentile and distribution (A2 integer percentiles)', () => {
  it('picks floor((n - 1) × pct / 100) of the sorted list, as qa2.bench.ts', () => {
    const sorted = Array.from({ length: 101 }, (_, i) => i);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 100)).toBe(100);
    expect(percentile([], 50)).toBe(0);
  });

  it('rounds float readings to integers and never yields -0', () => {
    expect(roundInt(-0.2)).toBe(0);
    expect(Object.is(roundInt(-0.2), 0)).toBe(true);
    expect(distribution([0.4, 2.6, 1.5, -0.3])).toEqual({
      samples: 4,
      p50: 0,
      p95: 2,
      p99: 2,
      max: 3,
    });
  });

  it('is null without a sample or with a broken reading', () => {
    expect(distribution([])).toBeNull();
    expect(distribution([1, Number.NaN])).toBeNull();
    expect(distribution([1, -5])).toBeNull();
    expect(distribution([Number.POSITIVE_INFINITY])).toBeNull();
  });

  it('is always ordered p50 <= p95 <= p99 <= max (the A2 refinement)', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1e9, noNaN: true }), { minLength: 1 }), (v) => {
        const d = distribution(v);
        return d !== null && d.p50 <= d.p95 && d.p95 <= d.p99 && d.p99 <= d.max;
      }),
    );
  });
});

describe('fitConstants (bots-api §6: T = T_fixed + nodes × c_node + candidates × c_cand)', () => {
  /** Samples generated from known constants: T_fixed 150 µs, c_node 1.2 µs, c_cand 1.1 ms. */
  const exact: DecisionSample[] = Array.from({ length: 60 }, (_, i) => {
    const nodes = 500 + ((i * 7919) % 60_000);
    const candidates = 10 + ((i * 104_729) % 490);
    return { micros: 150 + (nodes * 12) / 10 + candidates * 1100, nodes, candidates };
  });

  it('recovers the constants in the report units (µs, ns, ns)', () => {
    expect(fitConstants(exact)).toEqual({
      positions: 60,
      tFixedUs: 150,
      cNodeNs: 1200,
      cCandNs: 1_100_000,
    });
  });

  it('needs enough samples', () => {
    expect(fitConstants(exact.slice(0, MIN_FIT_SAMPLES - 1))).toBeNull();
  });

  it('is null on a singular system (every decision with the same counts)', () => {
    const same = exact.map((s) => ({ ...s, nodes: 100, candidates: 5 }));
    expect(fitConstants(same)).toBeNull();
    const collinear = exact.map((s) => ({ ...s, candidates: s.nodes * 2 }));
    expect(fitConstants(collinear)).toBeNull();
  });

  it('is null when the data gives a negative constant', () => {
    const inverse = exact.map((s) => ({ ...s, micros: 1_000_000 - s.nodes * 10 }));
    expect(fitConstants(inverse)).toBeNull();
  });
});
