// Type declarations for scale-corpus.mjs (seeded scale corpora for the size gate, lexicon-index note §5).
import type { CanonicalTerm } from './canonical.mjs';

export const SCALE_CORPUS_KINDS: readonly ['synthetic', 'real+synthetic'];
export type ScaleCorpusKind = (typeof SCALE_CORPUS_KINDS)[number];

/** mulberry32: seeded PRNG, uniform floats in [0, 1). */
export function seededRandom(seed: number): () => number;

export interface FormModel {
  readonly lengths: readonly number[];
  readonly starts: readonly number[];
  readonly bigrams: readonly (readonly number[])[];
  readonly difficulties: readonly (readonly [string, number])[];
  readonly categories: readonly (readonly [string, number])[];
  readonly pluralRate: number;
  readonly verbRate: number;
  readonly relationsPerTerm: number;
}

/** Fits lengths, start letters, bigrams and inflection/relation rates on canonical document terms. */
export function fitFormModel(terms: readonly CanonicalTerm[]): FormModel;

/** Generated terms adding exactly `forms` playable forms that collide with nothing in `taken` (mutated). */
export function generateTerms(options: {
  readonly model: FormModel;
  readonly forms: number;
  readonly seed: number;
  readonly taken: Set<string>;
  readonly targets?: readonly string[];
  readonly idPrefix?: string;
}): CanonicalTerm[];

/** Terms of a scale corpus with exactly `forms` playable forms (deterministic per seed). */
export function scaleCorpus(options: {
  readonly terms: readonly CanonicalTerm[];
  readonly blocklist?: Iterable<string>;
  readonly kind: ScaleCorpusKind;
  readonly forms: number;
  readonly seed?: number;
}): CanonicalTerm[];
