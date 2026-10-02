import type {
  Difficulty,
  FormKind,
  InflectionKind,
  LexiconVersion,
  RelationMask,
  RelationType,
} from './types.js';

/** Schema enum order (easiest first). A test keeps it equal to `schema/term.schema.json`. */
export const DIFFICULTIES: readonly Difficulty[] = Object.freeze([
  'novice',
  'intermediate',
  'advanced',
  'expert',
] as const);

/**
 * Schema enum order; index k is bit k of a `RelationMask`. Append-only: reordering would change the meaning of
 * masks inside published artefacts (needs a new `formatVersion`).
 */
export const RELATION_TYPES: readonly RelationType[] = Object.freeze([
  'is_a',
  'part_of',
  'uses',
  'related_to',
  'alternative_to',
  'runs_on',
  'implements',
] as const);

/** Schema v2 enum order. */
export const INFLECTION_KINDS: readonly InflectionKind[] = Object.freeze([
  'plural',
  'verb_s',
  'verb_ed',
  'verb_ing',
] as const);

/** `'canonical'` followed by the inflection kinds. */
export const FORM_KINDS: readonly FormKind[] = Object.freeze(['canonical', ...INFLECTION_KINDS]);

/** Number of letter codes (A..Z). */
export const LETTER_COUNT = 26;

/** GADDAG separator symbol ◇ (letters are 0..25). */
export const GADDAG_SEPARATOR = 26;

/** Longest playable form (schema `^[A-Z]{2,15}$`). */
export const MAX_FORM_LENGTH = 15;

const LEXICON_VERSION = /^[0-9a-f]{16}$/;

/** True for 16 lowercase hex chars (the `lexiconVersion` format). Use at trust boundaries (manifests, logs). */
export function isLexiconVersion(value: string): value is LexiconVersion {
  return LEXICON_VERSION.test(value);
}

/** The single-bit mask of a relation type. */
export function relationBit(type: RelationType): RelationMask {
  return 1 << RELATION_TYPES.indexOf(type);
}

/** True when `mask` contains `type`. */
export function hasRelation(mask: RelationMask, type: RelationType): boolean {
  return (mask & relationBit(type)) !== 0;
}

/** Relation types in `mask`, in `RELATION_TYPES` order (deterministic). Unknown bits are ignored. */
export function relationTypesOf(mask: RelationMask): RelationType[] {
  return RELATION_TYPES.filter((type) => hasRelation(mask, type));
}
