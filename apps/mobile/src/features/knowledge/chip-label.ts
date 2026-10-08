import type { Translator } from '@codelex/i18n';

import type { CardTerm } from '../../knowledge/card-model';

/**
 * Screen-reader label of a tappable term chip (§10.6 `a11y.chip.term`): "Kubernetes, DevOps, double tap to open".
 * A term whose category has no name gets the variant without it, never an empty slot.
 */
export function termChipLabel(t: Translator['t'], term: CardTerm, state: string): string {
  return term.category === null
    ? t('a11y.chip.term_no_category', { term: term.display, state })
    : t('a11y.chip.term', { term: term.display, category: term.category.name, state });
}
