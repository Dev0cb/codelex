export function best(scores: readonly number[]): number {
  return [...scores].sort((a, b) => b - a)[0] ?? 0;
}

export function fixedPoint(x: number): number {
  return Math.floor((x * 3) / 2);
}
