import { ENGINE_RULES_VERSION } from '@codelex/game-engine';
import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { I18nProvider } from '../../i18n/i18n-provider';
import { HomeScreen } from './home-screen';

describe('HomeScreen', () => {
  it('shows the app name from the catalog and the engine rules version', async () => {
    await render(
      <I18nProvider locale="en">
        <HomeScreen />
      </I18nProvider>,
    );
    expect(screen.getByRole('header').props.children).toBe('CODELEX');
    expect(screen.getByText('Play the language of technology.')).toBeTruthy();
    expect(screen.getByTestId('engine-version').props.children).toBe(
      `Rules engine v${String(ENGINE_RULES_VERSION)}`,
    );
  });

  it('renders French copy', async () => {
    await render(
      <I18nProvider locale="fr">
        <HomeScreen />
      </I18nProvider>,
    );
    expect(screen.getByText('Joue le langage de la technologie.')).toBeTruthy();
    expect(screen.getByTestId('engine-version').props.children).toBe(
      `Moteur de règles v${String(ENGINE_RULES_VERSION)}`,
    );
  });
});
