export function sorted(xs: readonly number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

export function sortedWords(xs: readonly string[]): string[] {
  return xs.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function mix(a: number, b: number): number {
  return Math.imul(a, b) >>> 0;
}

export function floorHalf(x: number): number {
  return Math.floor(x / 2);
}

export const BIG_UNIT = 2 ** 29;
export const HEX = 0x2000_0000;
export const SHIFTED = 1 << 20;
export const SPARSE = 1_000_000;
export const INT_EXPONENT = 1e3;

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

export function pad(s: string): string {
  return s.toUpperCase().padStart(4, "0");
}

export function parse(s: string): number {
  return Number.parseInt(s, 10);
}
