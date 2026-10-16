/**
 * End-of-session export prompt on Home (E-1.5 AC-17, design D-17; slice S6c), driven through the app: a match ends
 * (resign), Home regains focus, the card shows under PLAY NOW (never a dialog, never on Match or Summary), at most
 * once per session; "Review and send" opens Send playtest data; "Not now" dismisses.
 */
import type { Locale } from '@codelex/i18n';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { JSX } from 'react';
import { AccessibilityInfo } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnalyticsProvider, CreateAnalyticsContext } from '../../analytics/analytics-provider';
import { PlaytestAnalytics } from '../../analytics/recorder';
import { eventId } from '../../analytics/test-support';
import SendDataRoute from '../../app/send-data';
import { FlagsProvider } from '../../config/flags-provider';
import { I18nProvider } from '../../i18n/i18n-provider';
import { createBundledLexiconSource } from '../../lexicon/bundled-lexicon-source';
import { LexiconGate } from '../../lexicon/lexicon-gate';
import type { LoadedLexicon } from '../../lexicon/load-lexicon';
import { createJsThreadBotRunner } from '../../match/bot-runner';
import { MatchSessionProvider } from '../../match/match-session';
import { humanStarts, loadBundledLexicon } from '../../match/test-support';
import { MatchServicesContext, type MatchServices } from '../../match/use-match';
import { MemoryFs } from '../../persistence/memory-fs';
import { ShareContext } from '../../sharing/share-provider';
import { createTestShare } from '../../sharing/test-share';
import { MatchScreen } from '../match/match-screen';
import { HomeScreen } from './home-screen';

jest.mock('expo-asset', () => jest.requireActual('../../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../../jest/expo-file-system.cjs'));

const MIN = 60 * 1000;
const T0 = Date.parse('2026-10-14T18:00:00.000Z');
const lexiconSource = createBundledLexiconSource();
let lexicon: LoadedLexicon;

beforeAll(async () => {
  lexicon = await loadBundledLexicon();
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
});
afterEach(() => {
  jest.restoreAllMocks();
});

function recorder(fs: MemoryFs, clock: { wall: number; mono: number }): PlaytestAnalytics {
  let n = 0;
  return new PlaytestAnalytics(
    {
      fs,
      randomUUID: () => {
        n += 1;
        return eventId(n);
      },
      wallMs: () => clock.wall,
      monoMs: () => clock.mono,
      sinceProcessStartMs: () => 1000,
      context: () => ({ app_version: '0.1.0', platform: 'android', locale: 'en-US' }),
    },
    true,
  );
}

async function renderApp(analytics: PlaytestAnalytics, locale: Locale = 'en') {
  const services: MatchServices = {
    newSeed: () => humanStarts(lexicon, 1301),
    createBotRunner: (index) =>
      createJsThreadBotRunner(index, { nextFrame: () => Promise.resolve() }),
    thinkDelayMs: () => 0,
    shuffleRandom: () => 0,
  };
  const share = createTestShare();
  function Layout(): JSX.Element {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <I18nProvider locale={locale}>
          <FlagsProvider flags={{ 'play_vs_bot.enabled': true, 'analytics.upload.enabled': true }}>
            <CreateAnalyticsContext value={() => analytics}>
              <AnalyticsProvider>
                <ShareContext value={share}>
                  <MatchServicesContext value={services}>
                    <LexiconGate source={lexiconSource}>
                      <MatchSessionProvider>
                        <Stack screenOptions={{ headerShown: false }} />
                      </MatchSessionProvider>
                    </LexiconGate>
                  </MatchServicesContext>
                </ShareContext>
              </AnalyticsProvider>
            </CreateAnalyticsContext>
          </FlagsProvider>
        </I18nProvider>
      </GestureHandlerRootView>
    );
  }
  await renderRouter(
    { _layout: Layout, index: HomeScreen, match: MatchScreen, 'send-data': SendDataRoute },
    { initialUrl: '/' },
  );
  await screen.findByTestId('home.playNow');
}

/** PLAY NOW, Resign, then Home from the Summary. */
async function playAndResign(): Promise<void> {
  await fireEvent.press(screen.getByTestId('home.playNow'));
  await screen.findByTestId('match.status');
  await fireEvent.press(screen.getByTestId('match.menu.open'));
  await fireEvent.press(await screen.findByTestId('match.menu.resign'));
  await fireEvent.press(await screen.findByTestId('match.resign.confirm'));
  expect(screen.queryByTestId('home.exportPrompt')).toBeNull();
  await fireEvent.press(await screen.findByTestId('summary.home'));
  await screen.findByTestId('home.playNow');
}

/** Consent on, notice already seen (the prompt never competes with the first-run notice). */
function seasoned(clock: { wall: number; mono: number }): PlaytestAnalytics {
  const analytics = recorder(new MemoryFs(), clock);
  analytics.start();
  analytics.onAppState('active');
  analytics.markNoticeSeen();
  // Something to send (the layout here has no InteractiveMark, so no app_opened).
  analytics.record('app_backgrounded', { foreground_ms: 1 });
  return analytics;
}

describe('Home end-of-session export prompt (D-17)', () => {
  it('appears on Home after a completed match and 8 min of play, once per session', async () => {
    const clock = { wall: T0, mono: 0 };
    const analytics = seasoned(clock);
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);
    await renderApp(analytics);
    expect(screen.queryByTestId('home.exportPrompt')).toBeNull();
    expect(announce).not.toHaveBeenCalledWith('Send your playtest data?');
    clock.mono = 9 * MIN;
    await playAndResign();
    const card = await screen.findByTestId('home.exportPrompt');
    expect(screen.getByText('Send your playtest data?')).toBeTruthy();
    // It appears without focus moving to it: screen readers hear the title once, and changes are polite.
    expect(card.props.accessibilityLiveRegion).toBe('polite');
    expect(announce.mock.calls.filter(([m]) => m === 'Send your playtest data?')).toHaveLength(1);
    expect(
      screen.getByText(
        "You've played 1 match. Sending the file helps us improve CODELEX. It takes a minute.",
      ),
    ).toBeTruthy();
    // Under PLAY NOW, which stays first; both card actions are secondary buttons.
    const labels = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel as string);
    expect(labels.slice(0, 2)).toEqual(['Settings', 'PLAY NOW']);
    expect(labels).toContain('Not now');
    expect(labels).toContain('Review and send');
    await fireEvent.press(screen.getByTestId('home.exportPrompt.later'));
    expect(screen.queryByTestId('home.exportPrompt')).toBeNull();
    // A second match in the same session: not shown again.
    await playAndResign();
    expect(screen.queryByTestId('home.exportPrompt')).toBeNull();
    expect(analytics.sessionMatches()).toBe(2);
    expect(announce.mock.calls.filter(([m]) => m === 'Send your playtest data?')).toHaveLength(1);
  });

  it('"Review and send" opens Send playtest data', async () => {
    const clock = { wall: T0, mono: 0 };
    await renderApp(seasoned(clock), 'fr');
    clock.mono = 9 * MIN;
    await playAndResign();
    await fireEvent.press(await screen.findByTestId('home.exportPrompt.send'));
    expect(await screen.findByText('Envoyer les données de test')).toBeTruthy();
    expect(screen.getByTestId('export.share')).toBeTruthy();
  });

  it('waits for a second match when the session is short; never competes with the first-run notice', async () => {
    const clock = { wall: T0, mono: 0 };
    const analytics = recorder(new MemoryFs(), clock);
    analytics.start();
    analytics.onAppState('active');
    analytics.record('app_backgrounded', { foreground_ms: 1 });
    await renderApp(analytics);
    expect(screen.getByTestId('home.notice')).toBeTruthy();
    expect(screen.queryByTestId('home.exportPrompt')).toBeNull();
    // One match in under 8 min: not yet (and leaving Home marked the notice seen).
    await playAndResign();
    expect(screen.queryByTestId('home.notice')).toBeNull();
    expect(screen.queryByTestId('home.exportPrompt')).toBeNull();
    // Two matches qualify on their own.
    await playAndResign();
    expect(await screen.findByTestId('home.exportPrompt')).toBeTruthy();
    expect(screen.getByText(/^You've played 2 matches\./)).toBeTruthy();
  });
});
