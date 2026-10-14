import { readFileSync } from 'node:fs';

/** Hosts may import Node built-ins and read a clock for timings (ADR-0016 §D3 item 2). */
export const read: unknown = readFileSync;

export function elapsed(start: number): number {
  return Math.max(0, Date.now() - start);
}
