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
