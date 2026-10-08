/**
 * E-1.5 slice S5 (AC-13, AC-14): the Knowledge Card from the Summary, on local data (the bundled index and card
 * text), its navigation (related hop, Back, Close, scrim, swipe, system back), its events through the analytics
 * emitter, locale fallback, and the kill switch.
 */
import type { Locale } from '@codelex/i18n';
import type { LexiconIndex } from '@codelex/lexicon/index';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { JSX } from 'react';
import { AccessibilityInfo, AppState, type AppStateStatus } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnalyticsContext, type AnalyticsCall } from '../../analytics/emitter';
import { I18nProvider } from '../../i18n/i18n-provider';
import { bundledCards } from '../../knowledge/bundled-cards';
import type { CardsText, TermText } from '../../knowledge/cards-data';
import type { CardDeps } from '../../knowledge/card-model';
import type { MatchSummary } from '../../match/summary';
import { loadBundledLexicon } from '../../match/test-support';
import { SummaryScreen } from '../match/summary-screen';
import { SWIPE_GESTURE_ID } from './knowledge-card-sheet';

jest.mock('expo-asset', () => jest.requireActual('../../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../../jest/expo-file-system.cjs'));

let index: LexiconIndex;
let cards: CardsText;
beforeAll(async () => {
  const lexicon = await loadBundledLexicon();
  index = lexicon.index;
  const decoded = bundledCards(lexicon.descriptor.lexiconVersion);
  if (decoded === null) throw new Error('bundled cards do not decode');
  cards = decoded;
});

const LETTERS = { values: Array.from({ length: 26 }, () => 1) } as never;

const SUMMARY: MatchSummary = {
  outcome: 'victory',
  you: 142,
  them: 128,
  adjustments: { you: -3, them: 3 },
  end: { key: 'summary.end.out_you', params: {} },
  margin: 14,
  bestWord: { form: 'PODS', points: 62, seat: 0, termId: 'pod', canonicalForm: 'POD' },
  terms: {
    you: [
      { termId: 'kubernetes', form: 'KUBERNETES', isNew: true, playedAs: null },
      { termId: 'pod', form: 'POD', isNew: false, playedAs: 'PODS' },
    ],
    bot: [{ termId: 'docker', form: 'DOCKER', isNew: false, playedAs: null }],
  },
  newToYou: 1,
  botRack: 'QJ',
};

let clock = 0;
let calls: AnalyticsCall[] = [];
const onPlayAgain = jest.fn();
let appStateListener: ((state: AppStateStatus) => void) | undefined;

beforeEach(() => {
  clock = 1_000;
  calls = [];
  onPlayAgain.mockClear();
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => Promise.resolve(true));
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener;
    return { remove: () => undefined };
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

function Harness({
  deps,
  locale,
  summary,
}: {
  readonly deps: CardDeps | null;
  readonly locale: Locale;
  readonly summary: MatchSummary;
}): JSX.Element {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 800 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <I18nProvider locale={locale}>
        <AnalyticsContext value={{ emit: (call) => calls.push(call) }}>
          <SummaryScreen
            summary={summary}
            botName="Beginner Bot"
            letters={LETTERS}
            canPlayAgain
            onPlayAgain={onPlayAgain}
            onHome={() => undefined}
            cards={deps}
            now={() => clock}
          />
        </AnalyticsContext>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

async function show(
  options: { cardsOn?: boolean; locale?: Locale; text?: CardsText; summary?: MatchSummary } = {},
) {
  const locale = options.locale ?? 'en';
  const deps = options.cardsOn === false ? null : { index, cards: options.text ?? cards, locale };
  return await render(<Harness deps={deps} locale={locale} summary={options.summary ?? SUMMARY} />);
}

const sheetOpen = (): boolean => screen.queryByTestId('card.sheet') !== null;

describe('Knowledge Card kill switch (AC-14)', () => {
  it('shows chips but no tappable chip, no best-word link, no Discover and no sheet', async () => {
    await show({ cardsOn: false });
    const chips = within(screen.getByTestId('summary.terms.you'));
    expect(chips.getByText('KUBERNETES')).toBeTruthy();
    expect(screen.queryByTestId('summary.term.kubernetes')).toBeNull();
    expect(screen.queryAllByRole('button').map((b) => String(b.props.testID))).toEqual([
      'summary.playAgain',
      'summary.home',
    ]);
    expect(screen.queryByTestId('summary.bestWord.open')).toBeNull();
    expect(screen.queryByTestId('summary.discover')).toBeNull();
    expect(sheetOpen()).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('Knowledge Card (AC-13)', () => {
  it('never opens on its own', async () => {
    await show();
    expect(sheetOpen()).toBe(false);
    expect(calls).toEqual([]);
    expect(screen.getByTestId('summary.discover')).toBeTruthy();
  });

  it('opens from a term chip with display, category, difficulty and definition', async () => {
    await show();
    const chip = screen.getByTestId('summary.term.kubernetes');
    expect(chip.props.accessibilityLabel).toBe(
      'Kubernetes, DevOps, new to you, double tap to open',
    );
    await fireEvent.press(chip);
    expect(sheetOpen()).toBe(true);
    expect(screen.getByTestId('card.title').props.children).toBe('Kubernetes');
    expect(screen.getByTestId('card.title').props.accessibilityLabel).toBe(
      'Knowledge Card: Kubernetes',
    );
    expect(screen.getByText('DevOps')).toBeTruthy();
    expect(screen.getByLabelText('Difficulty: Expert')).toBeTruthy();
    expect(screen.getByTestId('card.definition').props.children).toBe(
      'Open-source system orchestrating containers across a cluster of machines.',
    );
    expect(screen.queryByTestId('card.playedAs')).toBeNull();
    expect(screen.queryByTestId('card.fallbackTag')).toBeNull();
    expect(screen.queryByTestId('card.back')).toBeNull();
    expect(screen.getByTestId('card.close')).toBeTruthy();
    expect(calls).toEqual([
      {
        event: 'knowledge_card_opened',
        properties: { term_id: 'kubernetes', source: 'post_match' },
      },
    ]);
  });

  it('hops to a related term, goes Back, then closes back to the Summary and Play again', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('summary.term.kubernetes'));
    const related = within(screen.getByTestId('card.related')).getAllByRole('button');
    expect(related.length).toBeGreaterThan(0);
    expect(related.length).toBeLessThanOrEqual(5);
    const first = related[0];
    if (first === undefined) throw new Error('no related term');
    const target = String(first.props.testID).replace('card.related.', '');
    clock = 4_000;
    await fireEvent.press(first);
    expect(screen.getByTestId('card.back')).toBeTruthy();
    expect(calls.slice(1).map((c) => c.event)).toEqual([
      'knowledge_graph_navigated',
      'knowledge_card_opened',
    ]);
    expect(calls[2]).toEqual({
      event: 'knowledge_card_opened',
      properties: { term_id: target, source: 'graph' },
    });
    clock = 5_000;
    await fireEvent.press(screen.getByTestId('card.back'));
    expect(screen.getByTestId('card.title').props.children).toBe('Kubernetes');
    expect(screen.queryByTestId('card.back')).toBeNull();
    clock = 6_000;
    await fireEvent.press(screen.getByTestId('card.close'));
    expect(sheetOpen()).toBe(false);
    expect(calls.filter((c) => c.event === 'knowledge_card_closed')).toEqual([
      {
        event: 'knowledge_card_closed',
        properties: { term_id: target, source: 'graph', dwell_ms: 1000, related_taps: 0 },
      },
      {
        event: 'knowledge_card_closed',
        properties: {
          term_id: 'kubernetes',
          source: 'post_match',
          dwell_ms: 4000,
          related_taps: 1,
        },
      },
    ]);
    await fireEvent.press(screen.getByTestId('summary.playAgain'));
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
  });

  it('opens the best word as its canonical card with "Played as"', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('summary.bestWord.open'));
    expect(screen.getByTestId('card.title').props.children).toBe('Pod');
    expect(screen.getByTestId('card.playedAs').props.children).toBe('Played as PODS');
  });

  it('Discover opens the first tappable chip of the player', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('summary.discover'));
    expect(screen.getByTestId('card.title').props.children).toBe('Kubernetes');
  });

  it('closes with the scrim, a downward swipe and system back (one card at a time)', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('summary.term.docker'));
    await fireEvent.press(screen.getByTestId('card.scrim', { includeHiddenElements: true }));
    expect(sheetOpen()).toBe(false);

    await fireEvent.press(screen.getByTestId('summary.term.docker'));
    await act(() => {
      fireGestureHandler(getByGestureTestId(SWIPE_GESTURE_ID), [
        { state: State.BEGAN, translationY: 0 },
        { state: State.ACTIVE, translationY: 40 },
        { state: State.END, translationY: 30 },
      ]);
    });
    expect(sheetOpen()).toBe(true);
    await act(() => {
      fireGestureHandler(getByGestureTestId(SWIPE_GESTURE_ID), [
        { state: State.BEGAN, translationY: 0 },
        { state: State.ACTIVE, translationY: 40 },
        { state: State.END, translationY: 120 },
      ]);
    });
    expect(sheetOpen()).toBe(false);

    await fireEvent.press(screen.getByTestId('summary.term.kubernetes'));
    const related = within(screen.getByTestId('card.related')).getAllByRole('button')[0];
    if (related === undefined) throw new Error('no related term');
    await fireEvent.press(related);
    // Android back: the Modal's onRequestClose.
    const requestClose = async (): Promise<void> => {
      await fireEvent(screen.getByTestId('card.sheet'), 'requestClose');
    };
    await requestClose();
    expect(screen.getByTestId('card.title').props.children).toBe('Kubernetes');
    await requestClose();
    expect(sheetOpen()).toBe(false);
  });

  it('speaks French, and falls back to the EN definition with a tag', async () => {
    const kube = cards.term('kubernetes');
    if (kube === undefined) throw new Error('no text');
    const text: CardsText = {
      ...cards,
      term: (id) =>
        id === 'kubernetes'
          ? ({ ...kube, definitions: { en: kube.definitions.en, fr: null } } satisfies TermText)
          : cards.term(id),
    };
    await show({ locale: 'fr', text });
    await fireEvent.press(screen.getByTestId('summary.term.pod'));
    expect(screen.getByTestId('card.definition').props.children).toBe(
      cards.term('pod')?.definitions.fr,
    );
    expect(screen.getByTestId('card.playedAs').props.children).toBe('Joué sous la forme PODS');
    expect(screen.getByText('Termes liés')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('card.close'));
    await fireEvent.press(screen.getByTestId('summary.term.kubernetes'));
    expect(screen.getByTestId('card.fallbackTag').props.children).toBe('Définition en anglais');
    expect(screen.getByTestId('card.definition').props.accessibilityLanguage).toBe('en');
  });

  it('keeps a chip inert when its term has no definition at all', async () => {
    const text: CardsText = {
      ...cards,
      term: (id) => (id === 'docker' ? undefined : cards.term(id)),
    };
    await show({ text });
    expect(screen.queryByTestId('summary.term.docker')).toBeNull();
    expect(within(screen.getByTestId('summary.terms.bot')).getByText('DOCKER')).toBeTruthy();
    expect(screen.getByTestId('summary.term.kubernetes')).toBeTruthy();
  });

  it('hides Discover when no chip has a card', async () => {
    await show({ summary: { ...SUMMARY, bestWord: null, terms: { you: [], bot: [] } } });
    expect(screen.queryByTestId('summary.discover')).toBeNull();
    expect(screen.queryByTestId('summary.bestWord.open')).toBeNull();
  });

  it('stops the dwell clock in the background and closes open cards on unmount', async () => {
    const view = await show();
    await fireEvent.press(screen.getByTestId('summary.term.kubernetes'));
    clock = 2_000;
    await act(() => appStateListener?.('background'));
    clock = 50_000;
    await act(() => appStateListener?.('active'));
    clock = 50_500;
    await view.unmount();
    expect(calls.at(-1)).toEqual({
      event: 'knowledge_card_closed',
      properties: { term_id: 'kubernetes', source: 'post_match', dwell_ms: 1500, related_taps: 0 },
    });
  });

  it('shows an error line and no sheet when a card cannot be opened', async () => {
    let gone = false;
    const text: CardsText = {
      ...cards,
      term: (id) => (gone && id === 'kubernetes' ? undefined : cards.term(id)),
    };
    await show({ text });
    gone = true;
    await fireEvent.press(screen.getByTestId('summary.term.kubernetes'));
    expect(sheetOpen()).toBe(false);
    expect(screen.getByTestId('summary.cardError').props.children).toBe("Couldn't open this card.");
  });
});
