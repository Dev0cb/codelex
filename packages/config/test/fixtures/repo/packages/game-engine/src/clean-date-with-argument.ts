export function fromTimestamp(ms: number): Date {
  return new Date(ms);
}

export function isDate(value: unknown): boolean {
  return value instanceof Date;
}

export function floor(value: number): number {
  return Math.floor(value);
}
