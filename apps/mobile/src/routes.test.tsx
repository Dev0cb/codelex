import { describe, expect, it, jest } from '@jest/globals';
import { renderRouter, screen } from 'expo-router/testing-library';

import bundledDescriptor from '../assets/lexicon/lexicon.json';
import Home from './app/index';
import RootLayout from './app/_layout';

jest.mock('expo-localization', () => ({ useLocales: () => [{ languageTag: 'en-US' }] }));
// The layout loads the real bundled `.clxi` (prepare:lexicon) through Node stand-ins of the native modules.
jest.mock('expo-asset', () => jest.requireActual('../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../jest/expo-file-system.cjs'));

describe('app routes', () => {
  it('opens on Home inside the root layout once the bundled lexicon is verified', async () => {
    await renderRouter({ _layout: RootLayout, index: Home }, { initialUrl: '/' });
    expect(await screen.findByText('Play the language of technology.')).toBeTruthy();
    expect(screen.getByTestId('lexicon-version').props.children).toBe(
      `Lexicon ${bundledDescriptor.lexiconVersion}`,
    );
  });
});
