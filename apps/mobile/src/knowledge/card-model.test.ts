import { relationTypesOf, type LexiconIndex, type TermRef } from '@codelex/lexicon/index';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import type { LoadedLexicon } from '../lexicon/load-lexicon';
import { loadBundledLexicon } from '../match/test-support';
import { bundledCards } from './bundled-cards';
import type { CardsText, TermText } from './cards-data';
import { MAX_RELATED, chipTerm, hasCard, knowledgeCard, type CardDeps } from './card-model';

jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));

let lexicon: LoadedLexicon;
let cards: CardsText;
let index: LexiconIndex;
beforeAll(async () => {
  lexicon = await loadBundledLexicon();
  index = lexicon.index;
  const decoded = bundledCards(lexicon.descriptor.lexiconVersion);
  if (decoded === null) throw new Error('bundled cards do not decode');
  cards = decoded;
});

const deps = (locale: 'en' | 'fr' = 'en', text: CardsText = cards): CardDeps => ({
  index,
  cards: text,
  locale,
});

/** The bundled text with some terms' definitions replaced. */
function withText(overrides: Readonly<Record<string, TermText | undefined>>): CardsText {
  return {
    ...cards,
    term: (id) => (Object.hasOwn(overrides, id) ? overrides[id] : cards.term(id)),
  };
}

const refOf = (form: string): TermRef => {
  const ref = index.lookup(form);
  if (ref === undefined) throw new Error(`${form} not in the index`);
  return index.termOf(ref);
};

describe('knowledgeCard (AC-13)', () => {
  it('shows display form, primary category, difficulty and the locale definition', () => {
    const card = knowledgeCard(deps('en'), 'kubernetes', 'KUBERNETES');
    expect(card).toMatchObject({
      termId: 'kubernetes',
      form: 'KUBERNETES',
      display: 'Kubernetes',
      category: { id: 'devops', name: 'DevOps', icon: 'infinity' },
      difficulty: 'expert',
      definition: 'Open-source system orchestrating containers across a cluster of machines.',
      definitionFallback: false,
      playedAs: null,
    });
    const fr = knowledgeCard(deps('fr'), 'kubernetes', 'KUBERNETES');
    expect(fr?.definition).toBe(
      'Système open source qui orchestre des conteneurs sur un cluster de machines.',
    );
    expect(fr?.definitionFallback).toBe(false);
  });

  it('falls back to EN with a tag when the locale definition is missing', () => {
    const text = withText({
      kubernetes: { display: 'Kubernetes', definitions: { en: 'EN only.', fr: null } },
    });
    expect(knowledgeCard(deps('fr', text), 'kubernetes', 'KUBERNETES')).toMatchObject({
      definition: 'EN only.',
      definitionFallback: true,
    });
  });

  it('gives a chip the display and category of its card without building it', () => {
    const card = knowledgeCard(deps('fr'), 'kubernetes', 'KUBERNETES');
    expect(chipTerm(deps('fr'), 'kubernetes', 'KUBERNETES')).toEqual({
      termId: card?.termId,
      form: card?.form,
      display: card?.display,
      category: card?.category,
    });
    expect(chipTerm(deps(), 'kubernetes', 'DOCKER')).toBeNull();
    const text = withText({ kubernetes: undefined });
    expect(chipTerm(deps('en', text), 'kubernetes', 'KUBERNETES')).toBeNull();
  });

  it('has a null category when the text does not name it', () => {
    const text: CardsText = { ...cards, category: () => undefined };
    expect(chipTerm(deps('en', text), 'kubernetes', 'KUBERNETES')?.category).toBeNull();
  });

  it('has no card for a term without any usable definition, or unknown to the index', () => {
    const text = withText({
      kubernetes: { display: 'Kubernetes', definitions: { en: null, fr: 'FR seulement.' } },
      docker: undefined,
    });
    expect(hasCard(deps('en', text), 'kubernetes', 'KUBERNETES')).toBe(false);
    expect(knowledgeCard(deps('en', text), 'kubernetes', 'KUBERNETES')).toBeNull();
    expect(hasCard(deps('fr', text), 'kubernetes', 'KUBERNETES')).toBe(true);
    expect(hasCard(deps('en', text), 'docker', 'DOCKER')).toBe(false);
    expect(hasCard(deps(), 'kubernetes', 'NOTATERM')).toBe(false);
    // A form of another term never opens this id's card.
    expect(hasCard(deps(), 'kubernetes', 'DOCKER')).toBe(false);
    expect(hasCard(deps(), 'kubernetes', 'KUBERNETES')).toBe(true);
  });

  it('shows "Played as" only for an inflection of the canonical form', () => {
    expect(knowledgeCard(deps(), 'pod', 'POD', 'PODS')?.playedAs).toBe('PODS');
    expect(knowledgeCard(deps(), 'pod', 'POD', 'pods')?.playedAs).toBe('PODS');
    expect(knowledgeCard(deps(), 'pod', 'POD', 'POD')?.playedAs).toBeNull();
    expect(knowledgeCard(deps(), 'pod', 'POD', null)?.playedAs).toBeNull();
  });

  it('lists up to 5 related terms with cards: same primary category first, then by display', () => {
    let checked = 0;
    for (let t = 0; t < index.termCount; t += 1) {
      const ref = t as TermRef;
      const meta = index.meta(ref);
      const card = knowledgeCard(deps('fr'), meta.id, meta.form);
      if (card === null) continue;
      checked += 1;
      expect(card.related.length).toBe(Math.min(MAX_RELATED, index.neighbours(ref).length));
      const primary = meta.categories[0];
      let seenOther = false;
      card.related.forEach((related, i) => {
        const other = refOf(related.form);
        expect(index.meta(other).id).toBe(related.termId);
        expect(relationTypesOf(index.related(ref, other))).toContain(related.relation);
        const same = related.category?.id === primary;
        if (!same) seenOther = true;
        else expect(seenOther).toBe(false);
        const previous = card.related[i - 1];
        if (previous !== undefined && (previous.category?.id === primary) === same) {
          expect(previous.display.localeCompare(related.display, 'fr')).toBeLessThanOrEqual(0);
        }
      });
    }
    expect(checked).toBe(index.termCount);
  });

  it('skips related terms that have no card', () => {
    const kube = refOf('KUBERNETES');
    const neighbours = index.neighbours(kube).map((n) => index.meta(n).id);
    const hidden = Object.fromEntries(neighbours.map((id) => [id, undefined]));
    expect(
      knowledgeCard(deps('en', withText(hidden)), 'kubernetes', 'KUBERNETES')?.related,
    ).toEqual([]);
  });

  it('builds a card well within the 300 ms open budget (synchronous lookups)', () => {
    const start = performance.now();
    for (let t = 0; t < index.termCount; t += 1) {
      const meta = index.meta(t as TermRef);
      knowledgeCard(deps(), meta.id, meta.form);
    }
    const perCard = (performance.now() - start) / index.termCount;
    expect(perCard).toBeLessThan(5);
  });
});
