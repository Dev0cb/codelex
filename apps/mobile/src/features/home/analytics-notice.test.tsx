/**
 * First-run analytics notice on Home (E-1.5 §5.4, D-8; slice S6a): a card under PLAY NOW, never a gate (AC-1),
 * shown once, only with `analytics.upload.enabled` on; leaving Home marks it seen.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import type { Locale } from '@codelex/i18n';
import { AnalyticsProvider, CreateAnalyticsContext } from '../../analytics/analytics-provider';
import { createTestAnalytics } from '../../analytics/test-analytics';
import { FlagsProvider } from '../../config/flags-provider';
import { I18nProvider } from '../../i18n/i18n-provider';
import { MemoryFs } from '../../persistence/memory-fs';
import { HomeScreen } from './home-screen';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useRouter: () => jest.requireMock<{ router: unknown }>('expo-router').router,
}));

const renderHome = (fs: MemoryFs, enabled: boolean, locale: Locale = 'en') =>
  render(
    <I18nProvider locale={locale}>
      <FlagsProvider flags={{ 'play_vs_bot.enabled': true, 'analytics.upload.enabled': enabled }}>
        <CreateAnalyticsContext value={(on) => createTestAnalytics(fs, on)}>
          <AnalyticsProvider>
            <HomeScreen />
          </AnalyticsProvider>
        </CreateAnalyticsContext>
      </FlagsProvider>
    </I18nProvider>,
  );

describe('Home analytics notice (§5.4)', () => {
  it('is not rendered while analytics.upload.enabled is off', async () => {
    await renderHome(new MemoryFs(), false);
    expect(screen.queryByTestId('home.notice')).toBeNull();
  });

  it('shows under PLAY NOW, which stays first and tappable (no consent wall, AC-1)', async () => {
    await renderHome(new MemoryFs(), true);
    expect(screen.getByText('Playtest build')).toBeTruthy();
    const labels = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel as string);
    expect(labels).toEqual(['Settings', 'PLAY NOW', 'Dismiss', 'Settings', 'Got it']);
  });

  it('"Got it" hides it for good', async () => {
    const fs = new MemoryFs();
    await renderHome(fs, true);
    await fireEvent.press(screen.getByTestId('home.notice.ok'));
    expect(screen.queryByTestId('home.notice')).toBeNull();
    await screen.unmount();
    await renderHome(fs.reboot(), true);
    expect(screen.queryByTestId('home.notice')).toBeNull();
  });

  it('the ✕ dismisses it too', async () => {
    await renderHome(new MemoryFs(), true);
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('home.notice')).toBeNull();
  });

  it('opens Settings from the notice and from the gear, and counts as seen', async () => {
    await renderHome(new MemoryFs(), true);
    await fireEvent.press(screen.getByTestId('home.notice.settings'));
    expect(router.push).toHaveBeenLastCalledWith('/settings');
    expect(screen.queryByTestId('home.notice')).toBeNull();
    await fireEvent.press(screen.getByTestId('home.settings'));
    expect(router.push).toHaveBeenLastCalledWith('/settings');
  });

  it('is marked seen when the player leaves Home with PLAY NOW', async () => {
    await renderHome(new MemoryFs(), true);
    await fireEvent.press(screen.getByTestId('home.playNow'));
    expect(screen.queryByTestId('home.notice')).toBeNull();
  });

  it('renders French copy', async () => {
    await renderHome(new MemoryFs(), true, 'fr');
    expect(screen.getByText('Version de test')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Compris' })).toBeTruthy();
  });
});
