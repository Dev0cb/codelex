import { useMemo } from 'react';

import { useFlag } from '../../config/flags-provider';
import { useI18n } from '../../i18n/i18n-provider';
import { bundledCards } from '../../knowledge/bundled-cards';
import type { CardDeps } from '../../knowledge/card-model';
import { useLexicon } from '../../lexicon/lexicon-gate';

/**
 * What the Summary needs to open Knowledge Cards, or null when `knowledge_card.post_match.enabled` is off (AC-14) or
 * the card text does not match the bundled index. Mount it only where cards can open (the Summary): with the flag on
 * it decodes the bundled text synchronously if `prewarmBundledCards` has not already done so.
 */
export function useCardDeps(): CardDeps | null {
  const enabled = useFlag('knowledge_card.post_match.enabled');
  const { index, descriptor } = useLexicon();
  const { locale } = useI18n();
  const version = descriptor.lexiconVersion;
  const cards = useMemo(() => (enabled ? bundledCards(version) : null), [enabled, version]);
  return useMemo(() => (cards === null ? null : { index, cards, locale }), [cards, index, locale]);
}
