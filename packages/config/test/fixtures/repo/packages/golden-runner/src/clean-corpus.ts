import type { TermId } from '@codelex/lexicon/index';
import rng from '@codelex/game-engine/golden/rng.json' with { type: 'json' };

/** The core may import published goldens and the pure lexicon index (sprint 4 P3). */
export const corpus: unknown = rng;

export function idOf(form: string): TermId {
  return form.toLowerCase();
}
