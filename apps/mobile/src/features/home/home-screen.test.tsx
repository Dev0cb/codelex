import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import type { Locale } from '@codelex/i18n';
import { FlagsProvider } from '../../config/flags-provider';
import { I18nProvider } from '../../i18n/i18n-provider';
import { HomeScreen } from './home-screen';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useRouter: () => jest.requireMock<{ router: unknown }>('expo-router').router,
}));

const renderHome = (locale: Locale, playEnabled: boolean) =>
  render(
    <I18nProvider locale={locale}>
      <FlagsProvider flags={{ 'play_vs_bot.enabled': playEnabled }}>
        <HomeScreen />
      </FlagsProvider>
    </I18nProvider>,
  );

describe('HomeScreen (E-1.5 §5.2)', () => {
  it('shows the name, the tagline and one dominant PLAY NOW that opens the match', async () => {
    await renderHome('en', true);
    expect(screen.getByRole('header').props.children).toBe('CODELEX');
    expect(screen.getByText('Play the language of technology.')).toBeTruthy();
    const play = screen.getByRole('button', { name: 'PLAY NOW' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await fireEvent.press(play);
    expect(router.push).toHaveBeenCalledWith('/match');
  });

  it('replaces PLAY NOW by an inert paused card when play_vs_bot.enabled is off (AC-19)', async () => {
    await renderHome('en', false);
    expect(screen.getByText('Matches are paused for an update — back soon')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders French copy', async () => {
    await renderHome('fr', true);
    expect(screen.getByText('Joue le langage de la technologie.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'JOUER' })).toBeTruthy();
  });

  it('renders the French paused card', async () => {
    await renderHome('fr', false);
    expect(
      screen.getByText('Les parties sont en pause pour une mise à jour — de retour bientôt'),
    ).toBeTruthy();
  });
});
