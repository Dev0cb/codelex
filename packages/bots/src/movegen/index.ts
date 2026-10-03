/**
 * Automaton selection (BOT-8): GADDAG when the index carries one, else the DAWG fallback (Appel–Jacobson over
 * `LexiconIndex.dawg`, always present, lexicon-index §2.3). Both yield the same move set (P-BOT-03).
 */
import type { LexiconIndex } from '@codelex/lexicon/index';
import { dawgGenerator } from './dawg.js';
import { gaddagGenerator } from './gaddag.js';
import type { MoveGenerator } from './types.js';

export type AutomatonKind = 'gaddag' | 'dawg';

export interface SelectedGenerator {
  readonly kind: AutomatonKind;
  readonly generate: MoveGenerator;
}

export function selectGenerator(lexicon: LexiconIndex): SelectedGenerator {
  if (lexicon.gaddag !== undefined) {
    return { kind: 'gaddag', generate: gaddagGenerator(lexicon.gaddag) };
  }
  return { kind: 'dawg', generate: dawgGenerator(lexicon.dawg) };
}

export type { Candidate, Generation, GenerationInput, MoveGenerator } from './types.js';
