/**
 * Settings (E-1.5 design §5.8, slice S6a): the Playtest data section only with `analytics.upload.enabled` on; the
 * consent toggle with its confirm-and-purge; the tester ID; the Animations choice (D-22) and the versions row, which
 * are not behind the flag; EN/FR; screen-reader roles.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { JSX } from 'react';
import { StyleSheet, Text } from 'react-native';

import type { Locale } from '@codelex/i18n';
import { useMotionMode } from '../../a11y/accessibility';
import { AnalyticsProvider, CreateAnalyticsContext } from '../../analytics/analytics-provider';
import { CONSENT_FILE } from '../../analytics/consent';
import { INSTALL_ID_FILE } from '../../analytics/install-id';
import { createTestAnalytics } from '../../analytics/test-analytics';
import { FlagsProvider } from '../../config/flags-provider';
import { I18nProvider } from '../../i18n/i18n-provider';
import { MemoryFs } from '../../persistence/memory-fs';
import { MotionPreferenceProvider, SETTINGS_FILE } from '../../settings/motion-preference';
import { SettingsScreen } from './settings-screen';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useRouter: () => jest.requireMock<{ router: unknown }>('expo-router').router,
}));

const VERSIONS = { app: '0.1.0', rules: 1, lexicon: '2f2cc6fca8fac92b' };

function MotionProbe(): JSX.Element {
  return <Text testID="probe.motion">{useMotionMode()}</Text>;
}

async function renderSettings(fs: MemoryFs, enabled: boolean, locale: Locale = 'en') {
  const analytics = createTestAnalytics(fs, enabled);
  const view = await render(
    <I18nProvider locale={locale}>
      <FlagsProvider flags={{ 'analytics.upload.enabled': enabled }}>
        <CreateAnalyticsContext value={() => analytics}>
          <AnalyticsProvider>
            <MotionPreferenceProvider fs={fs}>
              <SettingsScreen versions={VERSIONS} />
              <MotionProbe />
            </MotionPreferenceProvider>
          </AnalyticsProvider>
        </CreateAnalyticsContext>
      </FlagsProvider>
    </I18nProvider>,
  );
  return { view, analytics };
}

describe('SettingsScreen (E-1.5 §5.8)', () => {
  it('hides Playtest data while analytics.upload.enabled is off; Play and About stay', async () => {
    await renderSettings(new MemoryFs(), false);
    expect(screen.queryByTestId('settings.playtest')).toBeNull();
    expect(screen.getByTestId('settings.play')).toBeTruthy();
    expect(screen.getByTestId('settings.about.versions').props.children).toBe(
      'App 0.1.0 · Rules 1 · Lexicon 2f2cc6fca8fac92b',
    );
    expect(screen.getByText('Language follows your phone.')).toBeTruthy();
    const headers = screen.getAllByRole('header');
    expect(headers.map((h) => h.props.children as string)).toEqual([
      'Settings',
      'Play',
      'About this build',
    ]);
    // Section labels are drawn in capitals by style, so screen readers read the words, not letters.
    expect(StyleSheet.flatten(headers[1]?.props.style)).toMatchObject({
      textTransform: 'uppercase',
    });
  });

  it('shows the consent toggle on and the tester ID as selectable text', async () => {
    const { analytics } = await renderSettings(new MemoryFs(), true);
    const toggle = screen.getByTestId('settings.analytics.toggle');
    expect(toggle.props.value).toBe(true);
    expect(toggle.props.accessibilityLabel).toBe('Record playtest stats');
    const id = screen.getByTestId('settings.installId');
    expect(id.props.children).toBe(analytics.getSnapshot().installId);
    expect(id.props.selectable).toBe(true);
    expect(
      screen.getByText('Share this ID if you ask us to delete data you already sent.'),
    ).toBeTruthy();
  });

  it('asks before turning recording off, with the unsent count, then purges', async () => {
    const fs = new MemoryFs();
    const { analytics } = await renderSettings(fs, true);
    analytics.record('app_backgrounded', { foreground_ms: 1 });
    analytics.record('app_backgrounded', { foreground_ms: 2 });
    await fireEvent(screen.getByTestId('settings.analytics.toggle'), 'valueChange', false);
    expect(screen.getByText('Turn off recording?')).toBeTruthy();
    expect(
      screen.getByText('2 unsent events will be deleted. Nothing new will be recorded.'),
    ).toBeTruthy();
    // The only handle for erasing data already sent is shown before it is deleted (review M2).
    expect(
      screen.getByText('Note this ID first if you want data you already sent deleted.'),
    ).toBeTruthy();
    const noted = screen.getByTestId('settings.analytics.off.installId');
    expect(noted.props.children).toBe(analytics.getSnapshot().installId);
    expect(noted.props.selectable).toBe(true);
    await fireEvent.press(screen.getByTestId('settings.analytics.off.cancel'));
    expect(analytics.getSnapshot().consent).toBe(true);
    await fireEvent(screen.getByTestId('settings.analytics.toggle'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('settings.analytics.off.confirm'));
    expect(screen.getByTestId('settings.analytics.toggle').props.value).toBe(false);
    expect(screen.queryByTestId('settings.installId')).toBeNull();
    expect([...fs.files.keys()]).toEqual([CONSENT_FILE]);
  });

  it('turns recording back on with a new tester ID', async () => {
    const fs = new MemoryFs();
    const { analytics } = await renderSettings(fs, true);
    const before = analytics.getSnapshot().installId;
    await fireEvent(screen.getByTestId('settings.analytics.toggle'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('settings.analytics.off.confirm'));
    await fireEvent(screen.getByTestId('settings.analytics.toggle'), 'valueChange', true);
    const after = screen.getByTestId('settings.installId').props.children as string;
    expect(after).not.toBe(before);
    expect(fs.files.has(INSTALL_ID_FILE)).toBe(true);
  });

  it('says so when the choice cannot be saved, and changes nothing', async () => {
    const fs = new MemoryFs();
    await renderSettings(fs, true);
    fs.fullAfter = 0;
    await fireEvent(screen.getByTestId('settings.analytics.toggle'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('settings.analytics.off.confirm'));
    expect(screen.getByTestId('settings.saveError').props.children).toBe(
      "Couldn't save. Try again.",
    );
    expect(screen.getByTestId('settings.analytics.toggle').props.value).toBe(true);
  });

  it('overrides reduced motion from Settings and keeps the choice (D-22)', async () => {
    jest.useFakeTimers();
    const fs = new MemoryFs();
    await renderSettings(fs, false);
    const full = screen.getByTestId('settings.motion.full');
    expect(screen.getByTestId('settings.motion.system').props.accessibilityState).toEqual({
      checked: true,
    });
    await fireEvent.press(full);
    expect(screen.getByTestId('settings.motion.full').props.accessibilityState).toEqual({
      checked: true,
    });
    expect(screen.getByTestId('probe.motion').props.children).toBe('full');
    await fireEvent.press(screen.getByTestId('settings.motion.reduced'));
    expect(screen.getByTestId('probe.motion').props.children).toBe('reduced');
    expect(fs.files.has(SETTINGS_FILE)).toBe(true);
    // The next process reads it after the first render.
    await screen.unmount();
    await renderSettings(fs.reboot(), false);
    await act(() => {
      jest.runAllTimers();
    });
    expect(screen.getByTestId('probe.motion').props.children).toBe('reduced');
    jest.useRealTimers();
  });

  it('renders French copy', async () => {
    await renderSettings(new MemoryFs(), true, 'fr');
    expect(screen.getByText('Enregistrer les statistiques de test')).toBeTruthy();
    expect(screen.getByTestId('settings.about.versions').props.children).toBe(
      'App 0.1.0 · Règles 1 · Lexique 2f2cc6fca8fac92b',
    );
    expect(screen.getByText('Suivre le système')).toBeTruthy();
  });

  it('goes back with the back button', async () => {
    const { router } = jest.requireMock<{ router: { back: jest.Mock } }>('expo-router');
    await renderSettings(new MemoryFs(), false);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(router.back).toHaveBeenCalled();
  });
});
