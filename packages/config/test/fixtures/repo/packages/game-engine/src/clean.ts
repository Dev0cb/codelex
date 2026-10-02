import type { TermId } from "../../lexicon/src/index.js";

export interface Rng {
  next(): number;
}

export function pick(rng: Rng, ids: readonly TermId[]): TermId | undefined {
  return ids[Math.floor(rng.next() * ids.length)];
}
