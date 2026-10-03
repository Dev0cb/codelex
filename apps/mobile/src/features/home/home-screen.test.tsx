import { ENGINE_RULES_VERSION } from '@codelex/game-engine';
import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import bundledDescriptor from '../../../assets/lexicon/lexicon.json';
import type { Locale } from '@codelex/i18n';
import { I18nProvider } from '../../i18n/i18n-provider';
import { createBundledLexiconSource } from '../../lexicon/bundled-lexicon-source';
import { LexiconGate } from '../../lexicon/lexicon-gate';
import { HomeScreen } from './home-screen';

jest.mock('expo-asset', () => jest.requireActual('../../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../../jest/expo-file-system.cjs'));

const lexicon = createBundledLexiconSource();

const renderHome = (locale: Locale) =>
  render(
    <I18nProvider locale={locale}>
      <LexiconGate source={lexicon}>
        <HomeScreen />
      </LexiconGate>
    </I18nProvider>,
  );

describe('HomeScreen', () => {
  it('shows the app name, the engine rules version and the loaded lexicon version', async () => {
    await renderHome('en');
    expect((await screen.findByRole('header')).props.children).toBe('CODELEX');
    expect(screen.getByText('Play the language of technology.')).toBeTruthy();
    expect(screen.getByTestId('engine-version').props.children).toBe(
      `Rules engine v${String(ENGINE_RULES_VERSION)}`,
    );
    expect(screen.getByTestId('lexicon-version').props.children).toBe(
      `Lexicon ${bundledDescriptor.lexiconVersion}`,
    );
  });

  it('renders French copy', async () => {
    await renderHome('fr');
    expect(await screen.findByText('Joue le langage de la technologie.')).toBeTruthy();
    expect(screen.getByTestId('engine-version').props.children).toBe(
      `Moteur de règles v${String(ENGINE_RULES_VERSION)}`,
    );
    expect(screen.getByTestId('lexicon-version').props.children).toBe(
      `Lexique ${bundledDescriptor.lexiconVersion}`,
    );
  });
});
