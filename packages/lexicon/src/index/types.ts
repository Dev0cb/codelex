/**
 * `@codelex/lexicon/index` contract: the types `packages/game-engine` (E2–E4) and `packages/bots` consume.
 *
 * Spec: docs/architecture/notes/lexicon-index.md §2 (as amended by ADR-0013 and the E-1.7 FormRef/TermRef
 * split) and docs/architecture/notes/game-engine-api.md §5 (`EngineLexicon`). Implementations: the
 * reference index (sprint L3) and the `.clxi` decoder (sprint L4). Everything here is pure data shapes: no
 * IO, no Node built-ins, no clock, so the engine can import it under its purity lint.
 */

/** 16 lowercase hex chars: the value printed by `pnpm lexicon:validate` (LEXICON_SPEC §7, ADR-0013 §D7). */
export type LexiconVersion = string & { readonly __brand: 'LexiconVersion' };

/**
 * 16 lowercase hex chars: hash of the canonical profile definition (lexicon-index note §4.2). A distinct brand
 * from `LexiconVersion` so the two halves of an artefact identity cannot be swapped.
 */
export type DefinitionHash = string & { readonly __brand: 'DefinitionHash' };

/** Term difficulty (R-SCORE-003). Order = `DIFFICULTIES`. */
export type Difficulty = 'novice' | 'intermediate' | 'advanced' | 'expert';

/** Category id from `data/categories.json` (e.g. `cloud`). Obtain from `categories()` or `TermMeta`. */
export type CategoryId = string & { readonly __brand: 'CategoryId' };

/** Typed relation of the knowledge graph (schema enum). Bit k of a `RelationMask` = `RELATION_TYPES[k]`. */
export type RelationType =
  'is_a' | 'part_of' | 'uses' | 'related_to' | 'alternative_to' | 'runs_on' | 'implements';

/** Declared inflection kind (schema v2). */
export type InflectionKind = 'plural' | 'verb_s' | 'verb_ed' | 'verb_ing';

/** How a playable form relates to its canonical term: the term's own form, or a declared inflection. */
export type FormKind = 'canonical' | InflectionKind;

/** 0 = 'A' … 25 = 'Z'. Hot paths take letter codes to avoid building strings. */
export type LetterCode = number;

/** Bit i set ⇔ letter code i allowed (26 bits). */
export type LetterMask = number;

/** Bit k set ⇔ relation `RELATION_TYPES[k]`, either direction. 0 = not related. */
export type RelationMask = number;

/**
 * Per-letter counts, index = `LetterCode`, length `LETTER_COUNT`. Read-only by type: no index assignment and no
 * mutating method (`set`, `fill`, `copyWithin`, `reverse`, `sort`). Implementations return either a fresh copy
 * per call (e.g. a new `Uint32Array`) or a frozen array, so a caller can never alter the index's own state
 * (L3's T-ORACLE asserts it).
 */
export type LetterCounts = ArrayLike<number> & Iterable<number>;

/**
 * A playable string of one artefact: a canonical form (POD) or a declared inflection (PODS).
 * Dense ordinal 0..size-1, forms sorted by UTF-16 code-unit order. Valid only for the index that returned
 * it. Never persist a FormRef (replays, events, saves): persist the form string.
 */
export type FormRef = number & { readonly __brand: 'FormRef' };

/**
 * A canonical playable term of one artefact: holds metadata (difficulty, categories, values) and relations.
 * Dense ordinal 0..termCount-1, terms sorted by canonical form (UTF-16 code-unit order). Valid only for the
 * index that returned it. Never persist a TermRef: persist the term `id` or its canonical form.
 */
export type TermRef = number & { readonly __brand: 'TermRef' };

export type LexiconProfileKind = 'global' | 'season' | 'org';

/** Profile identity; with `LexiconIndex.version` it identifies an artefact (ADR-0013 §D7). */
export interface LexiconProfileRef {
  /** e.g. `global-ranked`, `season-s01-the-cloud`, `org-<orgId>`. */
  readonly id: string;
  readonly kind: LexiconProfileKind;
  readonly definitionHash: DefinitionHash;
}

/** Metadata of a canonical term. Frozen, memoised by the implementation. */
export interface TermMeta {
  readonly ref: TermRef;
  /** Stable term id (analytics, Knowledge Card, breakdowns). Immutable across lexicon versions. */
  readonly id: string;
  /** The canonical form (`^[A-Z]{2,15}$`), never an inflection: `meta(termOf(lookup('PODS'))).form === 'POD'`. */
  readonly form: string;
  /** R-SCORE-003. */
  readonly difficulty: Difficulty;
  /** First = primary category; R-BOARD-003 uses all of them. */
  readonly categories: readonly CategoryId[];
  /** `formulas.mjs`, or the approved override. */
  readonly gameValue: number;
  /** `formulas.mjs`, or the approved override. */
  readonly knowledgeXp: number;
}

/** A playable form and the canonical term it resolves to (R-CORE-006; E-1.5 "Played as PODS"). */
export interface FormMeta {
  readonly ref: FormRef;
  /** The playable string, `^[A-Z]{2,15}$`. */
  readonly form: string;
  /** Equal to `termOf(ref)`. */
  readonly term: TermRef;
  readonly kind: FormKind;
}

/** A node of the DAWG automaton of one artefact. Never persisted. */
export type DawgNode = number & { readonly __brand: 'DawgNode' };

/**
 * Membership automaton over the playable forms (bots-api note §4.3, DAWG / Appel–Jacobson fallback): the
 * `Gaddag` shape without the separator. The language is exactly the set of playable forms (canonical and
 * inflections), read left to right. Every implementation answers a node that is not one of its own (negative,
 * fractional, out of range) like a dead end: `arcs` 0, `next` -1, `isFinal` false; it never throws.
 */
export interface Dawg {
  readonly root: DawgNode;
  /** Bits 0..25 = letter arcs. Iterate set bits ascending ⇒ deterministic order. */
  arcs(node: DawgNode): LetterMask;
  /** Target node, or -1 when the arc does not exist (or `letter` is not a LetterCode). O(1). */
  next(node: DawgNode, letter: LetterCode): DawgNode | -1;
  /** True when the letters read from the root spell a playable form. */
  isFinal(node: DawgNode): boolean;
}

/** GADDAG symbol: 0..25 letters, 26 = separator ◇ (Gordon 1994). */
export type GaddagSymbol = number;

/** A node of the GADDAG automaton of one artefact. Never persisted. */
export type GaddagNode = number & { readonly __brand: 'GaddagNode' };

/**
 * Move-generation automaton (packages/bots, lexicon-index note §2.3). Each form w of length n is inserted as
 * rev(w[0..i]) ◇ w[i..n] for i = 1..n−1, plus rev(w). Covers every playable form (canonical and inflections);
 * its language is exactly those paths (T-GADDAG). Nodes that are not its own behave as dead ends, as in `Dawg`.
 */
export interface Gaddag {
  readonly root: GaddagNode;
  /** Bits 0..25 = letter arcs, bit 26 = separator arc. Iterate set bits ascending ⇒ deterministic order. */
  arcs(node: GaddagNode): number;
  /** Target node, or -1 when the arc does not exist. O(1). */
  next(node: GaddagNode, symbol: GaddagSymbol): GaddagNode | -1;
  /** True when the symbols read from the root spell rev(prefix) [◇ suffix] of a complete playable form. */
  isFinal(node: GaddagNode): boolean;
}

/**
 * A decoded lexicon index for one (`lexiconVersion`, profile). Pure, synchronous, immutable; absence is not an
 * error (`has`/`lookup` return `false`/`undefined`, the engine maps a miss to `NOT_IN_LEXICON`).
 *
 * Forms vs terms (E-1.7 AC-8): `lookup` resolves a playable string to a `FormRef`; `termOf` resolves it to the
 * canonical `TermRef` that carries metadata and relations. Term bonus, chain bonus, tech squares, XP and cards
 * all use the term; only the tiles on the board use the form.
 */
export interface LexiconIndex {
  /** Content version of the lexicon this artefact was built from. */
  readonly version: LexiconVersion;
  readonly profile: LexiconProfileRef;
  /** Binary format version of the artefact (the decoder supports a set of them). */
  readonly formatVersion: number;
  /** Number of playable forms in this profile: canonical forms + inflections (E-1.7 AC-8). */
  readonly size: number;
  /** Number of canonical playable terms in this profile (≤ size). */
  readonly termCount: number;
  /** Longest playable form, ≤ 15. */
  readonly maxFormLength: number;

  // --- R-CORE-003 / R-TURN-003: membership (budget < 5 µs on Node, allocation-free) ---
  /** False for anything that is not a playable form of ^[A-Z]{2,15}$ (no case folding, no locale logic). */
  has(form: string): boolean;
  /** The playable form, or undefined. Same acceptance rules as `has`. */
  lookup(form: string): FormRef | undefined;
  /** Same as `lookup` over `codes[from, to)`; used by the engine when reading words off the board. */
  lookupCodes(codes: ArrayLike<LetterCode>, from: number, to: number): FormRef | undefined;

  // --- forms → terms (R-CORE-006) ---
  /** Canonical term of a playable form (PODS → POD; POD → POD). */
  termOf(form: FormRef): TermRef;
  /** The form string, its kind and its term. Memoised, frozen. */
  formMeta(form: FormRef): FormMeta;

  // --- term metadata ---
  /** Memoised, frozen; `meta(t).form` is the canonical form. */
  meta(term: TermRef): TermMeta;
  /** Hot-path accessor, no allocation (R-SCORE-003). */
  difficulty(term: TermRef): Difficulty;
  inCategory(term: TermRef, category: CategoryId): boolean;
  /** Category ids present in this profile, sorted. */
  categories(): readonly CategoryId[];

  // --- R-SCORE-005 chain bonus: graph distance 1, any typed relation, undirected, in-profile only ---
  /** 0 if not related (including a === b: an inflection and its term are the same term, not a link). */
  related(a: TermRef, b: TermRef): RelationMask;
  /** Sorted ascending; only terms in this profile. */
  neighbours(term: TermRef): readonly TermRef[];

  // --- R-BAG-001 inputs (the derivation runs offline, ADR-0013 Q-G4) ---
  /**
   * Occurrences of each letter across all playable forms of the profile; index = LetterCode. A fresh copy or a
   * frozen array: mutating the result (if a cast allows it) never changes the index.
   */
  letterCounts(): LetterCounts;

  // --- move generation (packages/bots) ---
  /** Undefined if the artefact omits the section (`.clxi` flags bit 0 clear). */
  readonly gaddag: Gaddag | undefined;
  /** Always present: the membership automaton (the mandatory DAWG section), for DAWG-based generation. */
  readonly dawg: Dawg;
  /** Letters L such that before + L + after is a playable form. */
  crossCheck(before: ArrayLike<LetterCode>, after: ArrayLike<LetterCode>): LetterMask;
}

/** Decoding failures of a `.clxi` artefact (lexicon-index note §2.2). */
export type LexiconIndexErrorCode =
  | 'BAD_MAGIC'
  | 'UNSUPPORTED_FORMAT'
  | 'TRUNCATED'
  | 'CORRUPT'
  | 'VERSION_MISMATCH'
  | 'PROFILE_MISMATCH'
  | 'UNSUPPORTED_PLATFORM';

export interface LexiconIndexError {
  readonly code: LexiconIndexErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number>>;
}

/** What the caller expects the artefact to be; a difference is `VERSION_MISMATCH` / `PROFILE_MISMATCH`. */
export interface LexiconIndexExpectation {
  readonly version?: LexiconVersion;
  readonly profileId?: string;
}
