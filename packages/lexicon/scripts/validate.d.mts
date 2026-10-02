// Type declarations for the parts of validate.mjs used from TypeScript (tests, index builders).
import type { LexiconData } from './canonical.mjs';

export interface LoadedLexicon extends LexiconData {
  /** Canonical lexiconVersion (ADR-0013 §D7). */
  readonly version: string;
  readonly cardsVersion: string;
}

/** Reads `data/` (default: the package's own data directory). Throws on an invalid blocklist line. */
export function loadLexicon(dataDir?: string): LoadedLexicon;

export interface PlayableFormRow {
  readonly form: string;
  readonly termId: string;
  readonly kind: string;
}

/** Every playable form (canonical + inflections) sorted by form, as read from the data (no validation). */
export function playableForms(lex: Pick<LexiconData, 'files'>): PlayableFormRow[];

export function validateLexicon(lex: LexiconData): {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly stats: unknown;
};
