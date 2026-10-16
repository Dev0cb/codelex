/**
 * "Would you play CODELEX again?" on the Summary (E-1.5 AC-18, design §5.6; slice S6b). The card alone: shown only
 * when due, with the flag on and recording on; one tap records the answer and shows "Thanks!" for 1.5 s, ✕ records a
 * dismissal; a labelled group, not a modal. Through the app: the 1st and 3rd completed match only, and Play again
 * stays one tap away while the card is on screen.
 */
import type { Locale } from '@codelex/i18n';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { JSX, ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnalyticsProvider, CreateAnalyticsContext } from '../../analytics/analytics-provider';
import { DataStore } from '../../persistence/data-store';
import { EventQueue } from '../../analytics/event-queue';
import type { AnalyticsEvent } from '../../analytics/events';
import type { PlaytestAnalytics } from '../../analytics/recorder';
import { SURVEY_ID } from '../../analytics/survey';
import { createTestAnalytics, TEST_NOW } from '../../analytics/test-analytics';
import { FlagsProvider } from '../../config/flags-provider';
import type { FlagKey } from '../../config/flags';
import { I18nProvider } from '../../i18n/i18n-provider';
import { createBundledLexiconSource } from '../../lexicon/bundled-lexicon-source';
import { LexiconGate } from '../../lexicon/lexicon-gate';
import type { LoadedLexicon } from '../../lexicon/load-lexicon';
import { createJsThreadBotRunner } from '../../match/bot-runner';
import { MatchSessionProvider } from '../../match/match-session';
import { humanStarts, loadBundledLexicon } from '../../match/test-support';
import { MatchServicesContext, type MatchServices } from '../../match/use-match';
import { MemoryFs } from '../../persistence/memory-fs';
import { HomeScreen } from '../home/home-screen';
import { MatchScreen } from './match-screen';
import { SURVEY_THANKS_MS, SurveyCard } from './survey-card';

jest.mock('expo-asset', () => jest.requireActual('../../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../../jest/expo-file-system.cjs'));

type FlagValues = Partial<Record<FlagKey, boolean>>;
const ON: FlagValues = { 'analytics.upload.enabled': true, 'playtest.survey.enabled': true };

const surveyEvents = (fs: MemoryFs): readonly AnalyticsEvent[] =>
  new EventQueue(new DataStore(fs.reboot()), () => TEST_NOW)
    .events()
    .filter((e) => e.event.startsWith('playtest_survey'));

/** A recording install (consent on, notice seen) on `fs`, with `matches` completed while the survey was active. */
function install(fs: MemoryFs, matches: number): PlaytestAnalytics {
  const analytics = createTestAnalytics(fs, true);
  analytics.start();
  analytics.onAppState('active');
  analytics.load();
  analytics.markNoticeSeen();
  for (let i = 0; i < matches; i += 1) analytics.noteSurveyMatchCompleted();
  return analytics;
}

function Providers({
  analytics,
  flags,
  locale = 'en',
  children,
}: {
  readonly analytics: PlaytestAnalytics | null;
  readonly flags: FlagValues;
  readonly locale?: Locale;
  readonly children: ReactNode;
}): JSX.Element {
  const inner =
    analytics === null ? (
      children
    ) : (
      <CreateAnalyticsContext value={() => analytics}>
        <AnalyticsProvider>{children}</AnalyticsProvider>
      </CreateAnalyticsContext>
    );
  return (
    <I18nProvider locale={locale}>
      <FlagsProvider flags={flags}>{inner}</FlagsProvider>
    </I18nProvider>
  );
}

/**
 * One tap as Pressability takes an accessibility click (`onClick` → `onPress`), synchronously and without its own
 * act(), so several taps can land before the card re-renders (a double tap, Yes and No in the same frame).
 */
function tap(element: ReturnType<typeof screen.getByTestId>): void {
  const onClick: unknown = element.props.onClick;
  if (typeof onClick !== 'function') throw new Error('not a pressable');
  const event = { nativeEvent: {}, target: 1, currentTarget: 1 };
  (onClick as (e: typeof event) => void)(event);
}

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('SurveyCard (AC-18)', () => {
  it('asks on a due Summary: a labelled group with three 48 dp answers and a dismiss', async () => {
    const fs = new MemoryFs();
    const analytics = install(fs, 1);
    await render(
      <Providers analytics={analytics} flags={ON}>
        <SurveyCard />
      </Providers>,
    );
    const card = screen.getByTestId('summary.survey');
    expect(card.props.role).toBe('group');
    expect(card.props.accessibilityLabel).toBe('Would you play CODELEX again?');
    expect(card.props.accessible).not.toBe(true);
    expect(screen.getByText('Would you play CODELEX again?')).toBeTruthy();
    for (const label of ['Yes', 'Maybe', 'No', 'Dismiss question']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(surveyEvents(fs).map((e) => [e.event, e.properties])).toEqual([
      [
        'playtest_survey_shown',
        { survey_id: SURVEY_ID, question_id: 'would_play_again', matches_completed: 1 },
      ],
    ]);
  });

  it('records one answer, says thanks, then collapses after 1.5 s', async () => {
    jest.useFakeTimers();
    const fs = new MemoryFs();
    const analytics = install(fs, 1);
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);
    await render(
      <Providers analytics={analytics} flags={ON}>
        <SurveyCard />
      </Providers>,
    );
    await fireEvent.press(screen.getByTestId('summary.survey.yes'));
    const thanks = screen.getByTestId('summary.survey.thanks');
    // Announced exactly once: no live region on top of the announcement (TalkBack would read it twice).
    expect(thanks.props.accessibilityLiveRegion).toBeUndefined();
    expect(screen.getByText('Thanks!')).toBeTruthy();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Thanks!');
    expect(screen.queryByTestId('summary.survey.no')).toBeNull();
    await act(() => {
      jest.advanceTimersByTime(SURVEY_THANKS_MS - 1);
    });
    expect(screen.getByTestId('summary.survey')).toBeTruthy();
    await act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('summary.survey')).toBeNull();
    expect(SURVEY_THANKS_MS).toBe(1500);
    expect(surveyEvents(fs).map((e) => e.event)).toEqual([
      'playtest_survey_shown',
      'playtest_survey_answered',
    ]);
    expect(surveyEvents(fs)[1]?.properties).toEqual({
      survey_id: SURVEY_ID,
      question_id: 'would_play_again',
      answer: 'yes',
      matches_completed: 1,
    });
  });

  it('✕ records a dismissal and collapses at once (it counts as shown)', async () => {
    const fs = new MemoryFs();
    const analytics = install(fs, 3);
    await render(
      <Providers analytics={analytics} flags={ON} locale="fr">
        <SurveyCard />
      </Providers>,
    );
    expect(screen.getByText('Rejouerais-tu à CODELEX ?')).toBeTruthy();
    expect(screen.getByText('Peut-être')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Ignorer la question' }));
    expect(screen.queryByTestId('summary.survey')).toBeNull();
    expect(surveyEvents(fs).map((e) => e.properties)).toEqual([
      { survey_id: SURVEY_ID, question_id: 'would_play_again', matches_completed: 3 },
      {
        survey_id: SURVEY_ID,
        question_id: 'would_play_again',
        answer: 'dismissed',
        matches_completed: 3,
      },
    ]);
  });

  it('records one answer only: a double tap, or Yes and No in the same frame', async () => {
    const answered = (fs: MemoryFs): readonly AnalyticsEvent[] =>
      surveyEvents(fs).filter((e) => e.event === 'playtest_survey_answered');
    // A double tap: both presses land before the card re-renders.
    const doubleTap = new MemoryFs();
    const first = await render(
      <Providers analytics={install(doubleTap, 1)} flags={ON}>
        <SurveyCard />
      </Providers>,
    );
    const yes = screen.getByTestId('summary.survey.yes');
    await act(() => {
      tap(yes);
      tap(yes);
    });
    expect(answered(doubleTap).map((e) => e.properties)).toEqual([
      expect.objectContaining({ answer: 'yes' }),
    ]);
    await first.unmount();
    // Yes then No (and ✕) in the same frame: the first one wins.
    const sameFrame = new MemoryFs();
    await render(
      <Providers analytics={install(sameFrame, 1)} flags={ON}>
        <SurveyCard />
      </Providers>,
    );
    const [yesButton, noButton, dismiss] = ['yes', 'no', 'dismiss'].map((id) =>
      screen.getByTestId(`summary.survey.${id}`),
    );
    await act(() => {
      for (const button of [yesButton, noButton, dismiss]) if (button !== undefined) tap(button);
    });
    expect(answered(sameFrame).map((e) => e.properties)).toEqual([
      expect.objectContaining({ answer: 'yes' }),
    ]);
    expect(screen.getByTestId('summary.survey.thanks')).toBeTruthy();
  });

  it('unmounting during "Thanks!" clears its timer: no late update, no act warning', async () => {
    jest.useFakeTimers();
    const consoleError = jest.spyOn(console, 'error');
    const fs = new MemoryFs();
    const view = await render(
      <Providers analytics={install(fs, 1)} flags={ON}>
        <SurveyCard />
      </Providers>,
    );
    const setTimer = jest.spyOn(globalThis, 'setTimeout');
    const clearTimer = jest.spyOn(globalThis, 'clearTimeout');
    await fireEvent.press(screen.getByTestId('summary.survey.yes'));
    expect(screen.getByTestId('summary.survey.thanks')).toBeTruthy();
    const thanksTimers = setTimer.mock.results.filter(
      (_, i) => setTimer.mock.calls[i]?.[1] === SURVEY_THANKS_MS,
    );
    expect(thanksTimers).toHaveLength(1);
    await view.unmount();
    expect(clearTimer).toHaveBeenCalledWith(thanksTimers[0]?.value);
    // Nothing left to fire: had the timer survived, its setPhase would land outside act() after the unmount.
    jest.advanceTimersByTime(SURVEY_THANKS_MS * 2);
    expect(consoleError).not.toHaveBeenCalled();
    expect(surveyEvents(fs).map((e) => e.event)).toEqual([
      'playtest_survey_shown',
      'playtest_survey_answered',
    ]);
  });

  it('records each answer value of the catalogue', async () => {
    for (const answer of ['maybe', 'no'] as const) {
      const fs = new MemoryFs();
      const view = await render(
        <Providers analytics={install(fs, 1)} flags={ON}>
          <SurveyCard />
        </Providers>,
      );
      await fireEvent.press(screen.getByTestId(`summary.survey.${answer}`));
      expect(surveyEvents(fs).at(-1)?.properties).toMatchObject({ answer });
      await view.unmount();
    }
  });

  it('is not shown when not due, with the flag off, with consent off, or outside the recorder', async () => {
    const cases: { analytics: PlaytestAnalytics | null; flags: FlagValues; fs: MemoryFs }[] = [];
    const notDue = new MemoryFs();
    cases.push({ analytics: install(notDue, 2), flags: ON, fs: notDue });
    const flagOff = new MemoryFs();
    cases.push({
      analytics: install(flagOff, 1),
      flags: { 'analytics.upload.enabled': true },
      fs: flagOff,
    });
    const consentOff = new MemoryFs();
    const withdrawn = install(consentOff, 1);
    withdrawn.setConsent(false);
    cases.push({ analytics: withdrawn, flags: ON, fs: consentOff });
    cases.push({ analytics: null, flags: ON, fs: new MemoryFs() });
    for (const { analytics, flags, fs } of cases) {
      const view = await render(
        <Providers analytics={analytics} flags={flags}>
          <SurveyCard />
        </Providers>,
      );
      expect(screen.queryByTestId('summary.survey')).toBeNull();
      expect(surveyEvents(fs)).toEqual([]);
      await view.unmount();
    }
  });

  it('is not shown again when the Summary mounts a second time for the same match', async () => {
    const fs = new MemoryFs();
    const analytics = install(fs, 1);
    const first = await render(
      <Providers analytics={analytics} flags={ON}>
        <SurveyCard />
      </Providers>,
    );
    expect(screen.getByTestId('summary.survey')).toBeTruthy();
    await first.unmount();
    await render(
      <Providers analytics={analytics} flags={ON}>
        <SurveyCard />
      </Providers>,
    );
    expect(screen.queryByTestId('summary.survey')).toBeNull();
    expect(surveyEvents(fs).map((e) => e.event)).toEqual(['playtest_survey_shown']);
  });
});

describe('Survey through the app (AC-18: 1st and 3rd completed match, never blocks Play again)', () => {
  const lexiconSource = createBundledLexiconSource();
  let lexicon: LoadedLexicon;

  beforeAll(async () => {
    lexicon = await loadBundledLexicon();
  });

  async function renderApp(analytics: PlaytestAnalytics, flags: FlagValues): Promise<void> {
    const services: MatchServices = {
      newSeed: () => humanStarts(lexicon, 1301),
      createBotRunner: (index) =>
        createJsThreadBotRunner(index, { nextFrame: () => Promise.resolve() }),
      thinkDelayMs: () => 0,
      shuffleRandom: () => 0,
    };
    function Layout(): JSX.Element {
      return (
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Providers analytics={analytics} flags={{ 'play_vs_bot.enabled': true, ...flags }}>
            <MatchServicesContext value={services}>
              <LexiconGate source={lexiconSource}>
                <MatchSessionProvider>
                  <Stack screenOptions={{ headerShown: false }} />
                </MatchSessionProvider>
              </LexiconGate>
            </MatchServicesContext>
          </Providers>
        </GestureHandlerRootView>
      );
    }
    await renderRouter(
      { _layout: Layout, index: HomeScreen, match: MatchScreen },
      { initialUrl: '/' },
    );
    await fireEvent.press(await screen.findByTestId('home.playNow'));
  }

  /** Resigns the match on screen; resolves on its Summary. */
  async function resign(): Promise<void> {
    await screen.findByTestId('match.status');
    await fireEvent.press(screen.getByTestId('match.menu.open'));
    await fireEvent.press(await screen.findByTestId('match.menu.resign'));
    await fireEvent.press(await screen.findByTestId('match.resign.confirm'));
    await screen.findByTestId('summary.result');
  }

  it('asks on the 1st and 3rd Summary only; Play again works with the card on screen', async () => {
    const fs = new MemoryFs();
    await renderApp(install(fs, 0), ON);
    const asked: boolean[] = [];
    for (let match = 1; match <= 4; match += 1) {
      await resign();
      asked.push(screen.queryByTestId('summary.survey') !== null);
      if (match === 3) await fireEvent.press(screen.getByTestId('summary.survey.no'));
      // Not answered on the 1st: the card never stands between the player and the next match.
      if (match < 4) await fireEvent.press(screen.getByTestId('summary.playAgain'));
    }
    expect(asked).toEqual([true, false, true, false]);
    const matches = (e: AnalyticsEvent): unknown =>
      (e.properties as Readonly<Record<string, unknown>>)['matches_completed'];
    expect(surveyEvents(fs).map((e) => [e.event, matches(e)])).toEqual([
      ['playtest_survey_shown', 1],
      ['playtest_survey_shown', 3],
      ['playtest_survey_answered', 3],
    ]);
  });

  it('never asks with playtest.survey.enabled off', async () => {
    const fs = new MemoryFs();
    const analytics = install(fs, 0);
    await renderApp(analytics, { 'analytics.upload.enabled': true });
    await resign();
    expect(screen.queryByTestId('summary.survey')).toBeNull();
    expect(analytics.surveyDue()).toBeNull();
    expect(surveyEvents(fs)).toEqual([]);
  });
});
