/**
 * Bench statistics (DG1 note §5; Diagnostics report `diagnosticsFormat` 1): integer percentiles in the report's
 * shape, and the bots-api §6 constants fitted from per-decision samples. Pure: samples come from the host's clock.
 */

/** `Math.round`, with `-0` mapped to `0` (the JCS subset has no `-0`, ADR-0013 §D3). */
export function roundInt(value: number): number {
  return Math.round(value) + 0;
}

/** `percentile` of `qa2.bench.ts`: the sample at `floor((n - 1) × pct / 100)` of the sorted list. */
export function percentile(sorted: readonly number[], pct: number): number {
  return sorted[Math.floor(((sorted.length - 1) * pct) / 100)] ?? 0;
}

/** Percentiles of a count or a duration, every value an integer (the report's JCS subset has no fractions). */
export interface Distribution {
  readonly samples: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

/**
 * Distribution of `values` rounded to integers (`Math.round`, the A2 rule for float readings), or `null` when
 * there is no value or a value is not a finite non-negative number (a broken clock is not a measurement).
 */
export function distribution(values: readonly number[]): Distribution | null {
  if (values.length === 0) return null;
  const rounded = values.map(roundInt);
  if (!rounded.every((v) => Number.isSafeInteger(v) && v >= 0)) return null;
  const sorted = [...rounded].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: percentile(sorted, 100),
  };
}

/** One bot decision as measured: compute time in µs, and the budget counters of `BotDecision`. */
export interface DecisionSample {
  readonly micros: number;
  readonly nodes: number;
  readonly candidates: number;
}

/** bots-api §6: `T ≈ T_fixed + nodes × c_node + candidates × c_cand`, as integers. */
export interface FittedConstants {
  readonly positions: number;
  /** µs per decision. */
  readonly tFixedUs: number;
  /** ns per node. */
  readonly cNodeNs: number;
  /** ns per evaluated candidate. */
  readonly cCandNs: number;
}

/** Fewest samples for a fit: three unknowns, and a fit on a handful of points says nothing. */
export const MIN_FIT_SAMPLES = 20;

/**
 * Ordinary least squares of `micros` on `[1, nodes, candidates]` (centred normal equations), rounded to
 * integers in the report's units. `null` when there are too few samples, the system is singular (for example every
 * decision used the same counts) or a constant comes out negative (a fit that the data does not support).
 */
export function fitConstants(samples: readonly DecisionSample[]): FittedConstants | null {
  if (samples.length < MIN_FIT_SAMPLES) return null;
  const n = samples.length;
  const mean = (pick: (s: DecisionSample) => number): number =>
    samples.reduce((acc, s) => acc + pick(s), 0) / n;
  const mx = mean((s) => s.nodes);
  const my = mean((s) => s.candidates);
  const mt = mean((s) => s.micros);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxt = 0;
  let syt = 0;
  for (const { micros, nodes, candidates } of samples) {
    const x = nodes - mx;
    const y = candidates - my;
    const t = micros - mt;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sxt += x * t;
    syt += y * t;
  }
  const det = sxx * syy - sxy * sxy;
  // Singular, or ill-conditioned below one part in 10^9 (no fractional literal: ADR-0013 §D4.1 lint).
  if (!Number.isFinite(det) || !(det * 1_000_000_000 > sxx * syy)) return null;
  const perNode = (sxt * syy - syt * sxy) / det;
  const perCand = (syt * sxx - sxt * sxy) / det;
  const tFixedUs = roundInt(mt - perNode * mx - perCand * my);
  const cNodeNs = roundInt(perNode * 1000);
  const cCandNs = roundInt(perCand * 1000);
  const values = [tFixedUs, cNodeNs, cCandNs];
  if (!values.every((v) => Number.isSafeInteger(v) && v >= 0)) return null;
  return { positions: n, tFixedUs, cNodeNs, cCandNs };
}
