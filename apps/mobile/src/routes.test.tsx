import { describe, expect, it, jest } from '@jest/globals';
import { renderRouter, screen } from 'expo-router/testing-library';

import Home from './app/index';
import RootLayout from './app/_layout';

jest.mock('expo-localization', () => ({ useLocales: () => [{ languageTag: 'en-US' }] }));

describe('app routes', () => {
  it('opens on Home inside the root layout', async () => {
    await renderRouter({ _layout: RootLayout, index: Home }, { initialUrl: '/' });
    expect(await screen.findByText('Play the language of technology.')).toBeTruthy();
  });
});
