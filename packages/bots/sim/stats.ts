/**
 * Integer statistics for the B2 simulator. The determinism preset covers every file of `packages/bots` (ADR-0013
 * §D4.1-2: no fractional literals, no `Math.sqrt`), so rates are basis points (1 bp = 0.01 %) and means are
 * fixed-point integers; strings are formatted from integers only. Same inputs ⇒ same report bytes on any machine.
 */

/** ⌊a / b⌋ for safe integers, b > 0. */
export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** round(a / b) half up, safe integers, a ≥ 0, b > 0. */
export function roundDiv(a: number, b: number): number {
  return floorDiv(2 * a + b, 2 * b);
}

/** ⌊√n⌋ for a safe integer n ≥ 0 (Newton's method on integers). */
export function isqrt(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`isqrt: ${String(n)}`);
  if (n < 2) return n;
  let x = n;
  let y = floorDiv(x + 1, 2);
  while (y < x) {
    x = y;
    y = floorDiv(x + floorDiv(n, x), 2);
  }
  return x;
}

/** k / n in basis points, rounded half up; 0 when n = 0. */
export function rateBp(k: number, n: number): number {
  return n === 0 ? 0 : roundDiv(10_000 * k, n);
}

export interface Interval {
  /** Basis points. */
  readonly lo: number;
  readonly hi: number;
}

const MAX_WILSON_N = 10_000;

/**
 * Wilson score interval at 95 % (z = 1.96) for k successes out of n, in basis points (lo rounded down, hi up).
 * Scaled by 10⁴: centre = (10⁴k + 19,208) / (10⁴n + 38,416), half-width = 196·√(A/n) / (10⁴n + 38,416) with
 * A = 10⁴k(n−k) + 9,604n; √ is taken on A·10⁴/n (two extra decimals), all in safe integers for n ≤ 10,000.
 */
export function wilsonBp(k: number, n: number): Interval {
  if (n === 0) return { lo: 0, hi: 10_000 };
  if (n > MAX_WILSON_N || k < 0 || k > n)
    throw new RangeError(`wilson: k=${String(k)} n=${String(n)}`);
  const den = 10_000 * n + 38_416;
  const centre = 100 * (10_000 * k + 19_208);
  const a = 10_000 * k * (n - k) + 9_604 * n;
  const half = 196 * isqrt(floorDiv(a * 10_000, n));
  const lo = Math.max(0, floorDiv(100 * (centre - half), den));
  const hi = Math.min(10_000, floorDiv(100 * (centre + half) + den - 1, den));
  return { lo, hi };
}

/** Nearest-rank percentile (0..100) of integer values; 0 for an empty list. */
export function percentile(values: readonly number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, floorDiv(pct * sorted.length + 99, 100));
  return sorted[Math.min(sorted.length, rank) - 1] ?? 0;
}

export interface Spread {
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export function spread(values: readonly number[]): Spread {
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: percentile(values, 100),
  };
}

/** `value / 10^decimals` as a decimal string (value a safe integer). */
export function fixed(value: number, decimals: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (decimals === 0) return `${sign}${String(abs)}`;
  let scale = 1;
  for (let i = 0; i < decimals; i += 1) scale *= 10;
  const whole = floorDiv(abs, scale);
  const frac = String(abs - whole * scale).padStart(decimals, '0');
  return `${sign}${String(whole)}.${frac}`;
}

/** Basis points as a percentage string, e.g. 5231 → "52.31 %". */
export function pct(bp: number): string {
  return `${fixed(bp, 2)} %`;
}

/** Mean of a sum over n as tenths (rounded half up); 0 when n = 0. */
export function meanTenths(sum: number, n: number): number {
  return n === 0 ? 0 : roundDiv(10 * sum, n);
}

/** ⌈a / b⌉ for safe integers, b > 0. */
export function ceilDiv(a: number, b: number): number {
  return -floorDiv(-a, b);
}

/** ⌈√n⌉ for a safe integer n ≥ 0. */
export function ceilSqrt(n: number): number {
  const r = isqrt(n);
  return r * r === n ? r : r + 1;
}

function checked(value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`not a safe integer: ${String(value)}`);
  return value;
}

function pow10(k: number): number {
  let p = 1;
  for (let i = 0; i < k; i += 1) p *= 10;
  return p;
}

/** Largest j ≤ 3 with `value · 100^j` a safe integer (extra decimals for a square root). */
function sqrtDecimals(value: number): number {
  let j = 0;
  let scaled = value;
  while (j < 3 && Number.isSafeInteger(scaled * 100)) {
    scaled *= 100;
    j += 1;
  }
  return j;
}

export interface MeanWithCi {
  readonly n: number;
  /** Mean of the per-match values, tenths, rounded half up. */
  readonly meanTenths: number;
  /** Normal 95 % CI (z = 1.96, sample standard deviation), tenths; lo rounded down, hi rounded up. */
  readonly ci95: Interval;
}

/**
 * Mean of per-match integer values in [0, max] with a normal 95 % CI from the sample standard deviation
 * (v2-balance-check §3.2, C-11). With V = nΣx² − (Σx)², half = 1.96·√(V / (n²(n−1))); the root is taken with up
 * to three extra decimals and rounded up, so the interval is never narrower than the exact one.
 */
export function meanCiTenths(values: readonly number[], max = 100): MeanWithCi {
  const n = values.length;
  let sum = 0;
  let squares = 0;
  for (const x of values) {
    sum = checked(sum + x);
    squares = checked(squares + x * x);
  }
  const mean = meanTenths(sum, n);
  if (n < 2) return { n, meanTenths: mean, ci95: { lo: 0, hi: 10 * max } };
  const v = checked(checked(n * squares) - sum * sum);
  const scale = pow10(sqrtDecimals(v));
  const s = ceilSqrt(ceilDiv(v * scale * scale, checked(n * n * (n - 1))));
  const den = checked(10 * scale * n);
  const centre = checked(100 * scale * sum);
  const half = checked(196 * s * n);
  return {
    n,
    meanTenths: mean,
    ci95: {
      lo: Math.max(0, floorDiv(centre - half, den)),
      hi: Math.min(10 * max, ceilDiv(centre + half, den)),
    },
  };
}

export interface RatioWithCi {
  readonly n: number;
  /** ΣB ÷ ΣT in basis points, rounded half up. */
  readonly bp: number;
  /** Delta-method 95 % CI, basis points; lo rounded down, hi rounded up. */
  readonly ci95: Interval;
}

const MICRO = 1_000_000;

/**
 * Ratio of sums R = ΣB / ΣT with the delta-method 95 % CI, the match as the unit (v2-balance-check §3.2, C-05):
 * SE = √(Σ(Bᵢ − R·Tᵢ)² / (n(n−1))) / T̄, bounds R ± 1.96·SE. Safe integers only (no BigInt, no floats): R is
 * taken in millionths rounded down, so each residual is known within an interval of width Tᵢ millionths; its
 * larger magnitude is used and rounded up to the residual unit (10⁻³ point, coarser only if the squares would
 * overflow). The SE is never underestimated, so the CI is conservative.
 */
export function ratioCiBp(b: readonly number[], t: readonly number[]): RatioWithCi {
  if (b.length !== t.length) throw new RangeError('ratioCiBp: length mismatch');
  const n = b.length;
  let sumB = 0;
  let sumT = 0;
  for (let i = 0; i < n; i += 1) {
    sumB = checked(sumB + (b[i] ?? 0));
    sumT = checked(sumT + (t[i] ?? 0));
  }
  const bp = rateBp(sumB, sumT);
  if (n < 2 || sumT === 0) return { n, bp, ci95: { lo: 0, hi: 10_000 } };
  const rMicro = floorDiv(checked(sumB * MICRO), sumT);
  // Residual magnitudes in millionths of a point (upper bounds).
  const magnitudes: number[] = [];
  let largest = 0;
  for (let i = 0; i < n; i += 1) {
    const ti = t[i] ?? 0;
    const x = checked((b[i] ?? 0) * MICRO - rMicro * ti);
    const m = Math.max(Math.abs(x), Math.abs(x - ti));
    magnitudes.push(m);
    largest = Math.max(largest, m);
  }
  // Residual unit 10^(k−3) point: the smallest k ≥ 0 that keeps n · max² safe.
  let k = 0;
  for (;;) {
    const top = ceilDiv(largest, 1_000 * pow10(k));
    if (Number.isSafeInteger(n * top * top)) break;
    k += 1;
  }
  const unit = 1_000 * pow10(k);
  let e = 0;
  for (const m of magnitudes) {
    const r = ceilDiv(m, unit);
    e = checked(e + r * r);
  }
  const scale = pow10(Math.min(sqrtDecimals(e), sqrtDecimals(checked(100_000 * sumB))));
  const s = ceilSqrt(ceilDiv(e * scale * scale, checked(n * (n - 1))));
  const den = checked(10 * scale * sumT);
  const centre = checked(100_000 * sumB * scale);
  const half = checked(196 * n * pow10(k) * s);
  return {
    n,
    bp,
    ci95: {
      lo: Math.max(0, floorDiv(centre - half, den)),
      hi: Math.min(10_000, ceilDiv(centre + half, den)),
    },
  };
}
