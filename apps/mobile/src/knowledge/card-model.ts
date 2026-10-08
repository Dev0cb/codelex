/**
 * Knowledge Card content (E-1.5 AC-13, design §5.7, §13.2) as plain data, from local data only: the bundled
 * `LexiconIndex` (term id, canonical form, difficulty, categories, typed relations) and the bundled card text
 * (`cards-data.ts`: display form, definitions, category names). Pure and synchronous, so a card opens in one frame.
 */
import type { Locale } from '@codelex/i18n';
import {
  relationTypesOf,
  type Difficulty,
  type LexiconIndex,
  type RelationType,
  type TermRef,
} from '@codelex/lexicon/index';

import type { CardsText } from './cards-data';

/** AC-13: the card lists up to 5 related terms. */
export const MAX_RELATED = 5;

export interface CardDeps {
  readonly index: LexiconIndex;
  readonly cards: CardsText;
  readonly locale: Locale;
}

export interface CategoryBadge {
  readonly id: string;
  /** In the app locale (`categories.json` names). */
  readonly name: string;
  /** Registry icon name. */
  readonly icon: string;
}

export interface CardTerm {
  readonly termId: string;
  /** Canonical form (`^[A-Z]{2,15}$`), the index key. */
  readonly form: string;
  readonly display: string;
  /** Primary category; null if the text has no entry for it. */
  readonly category: CategoryBadge | null;
}

export interface RelatedTerm extends CardTerm {
  /** First typed relation between the two terms (undirected, `RELATION_TYPES` order): the hop's analytics value. */
  readonly relation: RelationType;
}

export interface KnowledgeCard extends CardTerm {
  readonly difficulty: Difficulty;
  /** In the app locale, else EN. */
  readonly definition: string;
  /** True when EN is shown because the locale has no definition (the card shows a language tag). */
  readonly definitionFallback: boolean;
  /** The form as played (uppercase) when it is an inflection, e.g. PODS for Pod (E-1.7 AC-12); else null. */
  readonly playedAs: string | null;
  readonly related: readonly RelatedTerm[];
}

/** The term of `form` if it is the canonical term `termId` (a chip or best word always carries both). */
function resolve(index: LexiconIndex, termId: string, form: string): TermRef | undefined {
  const ref = index.lookup(form);
  if (ref === undefined) return undefined;
  const term = index.termOf(ref);
  return index.meta(term).id === termId ? term : undefined;
}

function definitionOf(
  deps: CardDeps,
  termId: string,
): { readonly text: string; readonly fallback: boolean } | null {
  const definitions = deps.cards.term(termId)?.definitions;
  if (definitions === undefined) return null;
  const local = definitions[deps.locale];
  if (local !== null) return { text: local, fallback: false };
  return definitions.en === null ? null : { text: definitions.en, fallback: true };
}

function cardTerm(deps: CardDeps, ref: TermRef): CardTerm {
  const meta = deps.index.meta(ref);
  const primary = meta.categories[0];
  const category = primary === undefined ? undefined : deps.cards.category(primary);
  return {
    termId: meta.id,
    form: meta.form,
    display: deps.cards.term(meta.id)?.display ?? meta.form,
    category:
      category === undefined
        ? null
        : { id: category.id, name: category.name[deps.locale], icon: category.icon },
  };
}

/** AC-13: a chip is tappable only when its card has a definition (locale or EN); otherwise it stays inert. */
export function hasCard(deps: CardDeps, termId: string, form: string): boolean {
  return resolve(deps.index, termId, form) !== undefined && definitionOf(deps, termId) !== null;
}

/**
 * What a tappable chip shows (display form, primary category) when the term has a card, else null (inert chip).
 * Cheaper than {@link knowledgeCard}: no related-term walk.
 */
export function chipTerm(deps: CardDeps, termId: string, form: string): CardTerm | null {
  const ref = resolve(deps.index, termId, form);
  return ref === undefined || definitionOf(deps, termId) === null ? null : cardTerm(deps, ref);
}

/**
 * The card of `termId` (canonical `form`), or null when it has no card. `playedAs` is the form as played (blanks
 * may be lowercase); it is shown only when it differs from the canonical form. Related terms: the index's
 * neighbours that have a card, same primary category first, then by display form in the app locale (design §13.2
 * proposal 3, so the list is stable across sessions), then by id; the first {@link MAX_RELATED}.
 */
export function knowledgeCard(
  deps: CardDeps,
  termId: string,
  form: string,
  playedAs: string | null = null,
): KnowledgeCard | null {
  const { index } = deps;
  const ref = resolve(index, termId, form);
  if (ref === undefined) return null;
  const definition = definitionOf(deps, termId);
  if (definition === null) return null;
  const term = cardTerm(deps, ref);
  const primary = index.meta(ref).categories[0];
  const related = index
    .neighbours(ref)
    .map((other) => ({ other, term: cardTerm(deps, other) }))
    .filter(({ term: t }) => definitionOf(deps, t.termId) !== null)
    .sort((a, b) => {
      const sameA = index.meta(a.other).categories[0] === primary ? 0 : 1;
      const sameB = index.meta(b.other).categories[0] === primary ? 0 : 1;
      if (sameA !== sameB) return sameA - sameB;
      const byDisplay = a.term.display.localeCompare(b.term.display, deps.locale);
      if (byDisplay !== 0) return byDisplay;
      return a.term.termId < b.term.termId ? -1 : 1;
    })
    .slice(0, MAX_RELATED)
    .map(({ other, term: t }) => ({
      ...t,
      relation: relationTypesOf(index.related(ref, other))[0] ?? 'related_to',
    }));
  const played = playedAs?.toUpperCase() ?? null;
  return {
    ...term,
    difficulty: index.difficulty(ref),
    definition: definition.text,
    definitionFallback: definition.fallback,
    playedAs: played !== null && played !== term.form ? played : null,
    related,
  };
}
