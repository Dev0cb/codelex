import { describe, expect, it, jest } from '@jest/globals';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import Home from './app/index';
import Match from './app/match';
import SendData from './app/send-data';
import RootLayout from './app/_layout';
import * as nativeIntent from './app/+native-intent';
import { SHARE_DIR } from './sharing/share-file';

jest.mock('expo-localization', () => ({ useLocales: () => [{ languageTag: 'en-US' }] }));
// The layout loads the real bundled `.clxi` (prepare:lexicon) through Node stand-ins of the native modules.
jest.mock('expo-asset', () => jest.requireActual('../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../jest/expo-file-system.cjs'));

describe('app routes', () => {
  it('opens on Home inside the root layout once the bundled lexicon is verified', async () => {
    await renderRouter({ _layout: RootLayout, index: Home }, { initialUrl: '/' });
    expect(await screen.findByText('Play the language of technology.')).toBeTruthy();
    // play_vs_bot.enabled ships off (bundled default): Home shows the paused card, not PLAY NOW (AC-19).
    expect(screen.getByTestId('home.paused')).toBeTruthy();
    expect(screen.queryByTestId('home.playNow')).toBeNull();
  });

  it('keeps the match route closed while play_vs_bot.enabled is off', async () => {
    await renderRouter(
      { _layout: RootLayout, index: Home, match: Match },
      { initialUrl: '/match' },
    );
    expect(await screen.findByTestId('home.paused')).toBeTruthy();
  });

  it('keeps Send playtest data closed while analytics.upload.enabled is off (deep link included)', async () => {
    await renderRouter(
      { _layout: RootLayout, index: Home, 'send-data': SendData },
      { initialUrl: '/send-data' },
    );
    expect(await screen.findByTestId('home.paused')).toBeTruthy();
    expect(screen.queryByText('Send playtest data')).toBeNull();
  });

  it('sweeps the whole share directory a previous process left behind (TM-04, DS-7)', async () => {
    const { Paths } = jest.requireActual<{ Paths: { cache: { uri: string } } }>(
      '../jest/expo-file-system.cjs',
    );
    const dir = join(Paths.cache.uri, SHARE_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'codelex-playtest-data.json'), '{}');
    writeFileSync(join(dir, 'any-other-name.json'), '{}');
    await renderRouter({ _layout: RootLayout, index: Home }, { initialUrl: '/' });
    await screen.findByText('Play the language of technology.');
    await waitFor(() => {
      expect(existsSync(dir)).toBe(false);
    });
  });

  it('routes the initial system URL through the deep-link guard before parsing it', async () => {
    const redirectSystemPath = jest.fn(nativeIntent.redirectSystemPath);
    const malformed = '/?q=%E0%A4%A';
    await renderRouter(
      { _layout: RootLayout, index: Home, '+native-intent': { redirectSystemPath } },
      { initialUrl: malformed },
    );
    expect(await screen.findByText('Play the language of technology.')).toBeTruthy();
    expect(redirectSystemPath).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('%E0%A4%A'), initial: true }),
    );
    expect(redirectSystemPath).toHaveReturnedWith('/');
  });
});
