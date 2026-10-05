// Type declarations for canonical.mjs (zero-dependency script, kept as plain JS so CI can run it before install).

/** Version of the canonical document definitions. */
export const CONTENT_FORMAT: number;

/** Explicit UTF-16 code-unit comparator (never locale-dependent). */
export function byCodeUnit(a: string, b: string): number;

/** RFC 8785 canonical JSON; throws TypeError on anything that is not plain JSON. */
export function canonicalize(value: unknown): string;

/** First 16 lowercase hex chars of SHA-256 over the UTF-8 bytes of `text`. */
export function sha256Hex16(text: string): string;

/** One term of the canonical content document D (ADR-0013 §D7, LEXICON_SPEC §7). */
export interface CanonicalTerm {
  readonly id: string;
  readonly playable: boolean;
  readonly kind: string;
  readonly difficulty: string;
  readonly form?: string;
  readonly categories: readonly string[];
  readonly inflections: readonly { readonly form: string; readonly kind: string }[];
  readonly relations: readonly { readonly type: string; readonly target: string }[];
  readonly tags: readonly string[];
  readonly gameValue?: number;
  readonly knowledgeXp?: number;
}

export interface LexiconContentDocument {
  readonly contentFormat: number;
  readonly categories: readonly string[];
  readonly blocklist: readonly string[];
  readonly terms: readonly CanonicalTerm[];
}

/** A lexicon as read by `loadLexicon()` (scripts/validate.mjs). */
export interface LexiconData {
  readonly categories: readonly unknown[];
  readonly files: readonly { readonly path: string; readonly data: unknown }[];
  readonly blocklist: ReadonlySet<string>;
}

export function lexiconContentDocument(lex: LexiconData): LexiconContentDocument;
export function cardsContentDocument(lex: LexiconData): unknown;
export function computeLexiconVersion(lex: LexiconData): string;
export function computeCardsVersion(lex: LexiconData): string;

export interface LexiconProfileDefinition {
  readonly id: string;
  readonly kind: 'global' | 'season' | 'org';
  readonly include: {
    readonly all?: true;
    readonly tags?: readonly string[];
    readonly categories?: readonly string[];
    readonly ids?: readonly string[];
  };
  readonly exclude?: { readonly tags?: readonly string[]; readonly ids?: readonly string[] };
  /** E-1.7 D-14: `all` (default) keeps declared inflections, `none` builds canonical forms only. */
  readonly inflections?: InflectionPolicy;
}
export type InflectionPolicy = 'all' | 'none';
export const INFLECTION_POLICIES: readonly InflectionPolicy[];
export const GLOBAL_PROFILE: LexiconProfileDefinition;
/** Simulation-only profile `global-no-inflections` (E-1.7 D-14, AC-20). */
export const NO_INFLECTIONS_PROFILE: LexiconProfileDefinition;
/** Profiles built by `build:index`, in build order. */
export const BUILT_PROFILES: readonly LexiconProfileDefinition[];
/** The hashed form: `inflections: 'all'` is omitted; throws TypeError on an unknown option value. */
export function canonicalProfileDefinition(
  definition: LexiconProfileDefinition,
): LexiconProfileDefinition;
export function profileDefinitionHash(definition: LexiconProfileDefinition): string;
/** The builder's profile reference (`LexiconBuildInput.profile`), derived from one definition. */
export function profileBuildInput(definition: LexiconProfileDefinition): {
  readonly id: string;
  readonly kind: 'global' | 'season' | 'org';
  readonly definitionHash: string;
  readonly inflections: InflectionPolicy;
};
