/**
 * DG1 note §4 (preview-diagnostics only): with `EXPO_PUBLIC_CODELEX_DIAGNOSTICS=1`, the Settings versions row is
 * wrapped in the hidden entry, and 7 quick taps open the Diagnostics modal (root `testID` = the module marker).
 * Production is covered by `settings-screen.test.tsx` (plain text, no handler) and by `bundle:check` (no module).
 */
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { JSX } from 'react';

import { AnalyticsProvider, CreateAnalyticsContext } from '../analytics/analytics-provider';
import { createTestAnalytics } from '../analytics/test-analytics';
import { FlagsProvider } from '../config/flags-provider';
import { I18nProvider } from '../i18n/i18n-provider';
import { createBundledLexiconSource } from '../lexicon/bundled-lexicon-source';
import { LexiconGate } from '../lexicon/lexicon-gate';
import { MemoryFs } from '../persistence/memory-fs';
import { MotionPreferenceProvider } from '../settings/motion-preference';
import type * as SettingsTypes from '../features/settings/settings-screen';
import { DIAGNOSTICS_MARKER } from './entry';

jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useRouter: () => jest.requireMock<{ router: unknown }>('expo-router').router,
}));

type SettingsModule = typeof SettingsTypes;
let SettingsScreen: SettingsModule['SettingsScreen'];

beforeAll(() => {
  // The preview-diagnostics build constant, set before the gate module is first evaluated.
  process.env.EXPO_PUBLIC_CODELEX_DIAGNOSTICS = '1';
  ({ SettingsScreen } = jest.requireActual<SettingsModule>('../features/settings/settings-screen'));
});

function Settings(): JSX.Element {
  return (
    <I18nProvider locale="en">
      <FlagsProvider flags={{}}>
        <CreateAnalyticsContext value={() => createTestAnalytics(new MemoryFs(), false)}>
          <AnalyticsProvider>
            <MotionPreferenceProvider fs={new MemoryFs()}>
              <LexiconGate source={createBundledLexiconSource()}>
                <SettingsScreen
                  versions={{ app: '0.1.0', rules: 1, lexicon: '2f2cc6fca8fac92b' }}
                />
              </LexiconGate>
            </MotionPreferenceProvider>
          </AnalyticsProvider>
        </CreateAnalyticsContext>
      </FlagsProvider>
    </I18nProvider>
  );
}

describe('Diagnostics entry (preview-diagnostics builds)', () => {
  it('opens the modal on the 7th quick tap on the versions row, not before', async () => {
    await render(<Settings />);
    const entry = await screen.findByTestId('settings.about.versions.entry');
    // Same text as production; no role and no hint (hidden developer affordance).
    expect(screen.getByTestId('settings.about.versions').props.children).toBe(
      'App 0.1.0 · Rules 1 · Lexicon 2f2cc6fca8fac92b',
    );
    expect(entry.props.accessibilityRole).toBeUndefined();
    expect(entry.props.accessibilityHint).toBeUndefined();
    for (let i = 0; i < 6; i += 1) await fireEvent.press(entry);
    expect(screen.queryByTestId(DIAGNOSTICS_MARKER)).toBeNull();
    await fireEvent.press(entry);
    expect(await screen.findByTestId(DIAGNOSTICS_MARKER)).toBeTruthy();
    expect(screen.getByText('Diagnostics')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('diagnostics.close'));
    expect(screen.queryByTestId(DIAGNOSTICS_MARKER)).toBeNull();
  });

  it('exports the marker the bundle check looks for', () => {
    expect(DIAGNOSTICS_MARKER).toBe('CODELEX_DIAGNOSTICS_SCREEN_V1');
  });
});
