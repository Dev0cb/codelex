/**
 * Automaton selection (BOT-8): GADDAG when the index carries one, else the DAWG fallback.
 *
 * TODO(O-1, bots-api §4.3 / §9.1): the DAWG (Appel–Jacobson) generator waits for `LexiconIndex.dawg` from L5.
 * Until then an index without a GADDAG yields no candidates and the bot plays the rule-correct fallback
 * (BOT-6), so every decision stays legal (P-BOT-01). Add `{ kind: 'dawg' }` here and `dawgGenerator` beside
 * `gaddagGenerator`; P-BOT-03 then compares the two.
 */
import type { LexiconIndex } from '@codelex/lexicon/index';
import { gaddagGenerator } from './gaddag.js';
import type { Generation, MoveGenerator } from './types.js';

export type AutomatonKind = 'gaddag' | 'none';

export interface SelectedGenerator {
  readonly kind: AutomatonKind;
  readonly generate: MoveGenerator;
}

const NO_GENERATION: Generation = Object.freeze({
  candidates: Object.freeze([]),
  nodesUsed: 0,
  exhausted: false,
});

const noAutomaton: MoveGenerator = (): Generation => NO_GENERATION;

export function selectGenerator(lexicon: LexiconIndex): SelectedGenerator {
  if (lexicon.gaddag !== undefined) {
    return { kind: 'gaddag', generate: gaddagGenerator(lexicon.gaddag) };
  }
  return { kind: 'none', generate: noAutomaton };
}

export type { Candidate, Generation, GenerationInput, MoveGenerator } from './types.js';
