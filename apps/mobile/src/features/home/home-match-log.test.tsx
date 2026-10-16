/**
 * "Send match log" on the corrupt-state card (E-1.5 design §5.10.2; slice S6d, behind `playtest.match_log.enabled`):
 * the corrupt match is exported (as `raw` when the app cannot read it) before "Start a new match" deletes it; the
 * version-mismatch card has no such button; with the flag off the card offers "Start a new match" only.
 */
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { replay, type SeedHex } from '@codelex/game-engine';
import type * as Engine from '@codelex/game-engine';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { JSX } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { FlagsProvider } from '../../config/flags-provider';
import { decodeMatchLog } from '../../export/match-log';
import { I18nProvider } from '../../i18n/i18n-provider';
import { createBundledLexiconSource } from '../../lexicon/bundled-lexicon-source';
import { LexiconGate } from '../../lexicon/lexicon-gate';
import type { LoadedLexicon } from '../../lexicon/load-lexicon';
import { createJsThreadBotRunner } from '../../match/bot-runner';
import { MatchSessionProvider } from '../../match/match-session';
import { playMatchConfig } from '../../match/play-config';
import { humanStarts, loadBundledLexicon, scriptMatch } from '../../match/test-support';
import { MatchServicesContext, type MatchServices } from '../../match/use-match';
import { MATCH_LOG_GUARD_FILE } from '../../match-log/match-log-file';
import { DataStore } from '../../persistence/data-store';
import { FILES } from '../../persistence/match-journal';
import { MemoryFs } from '../../persistence/memory-fs';
import {
  createPersistence,
  finishMatch,
  GUARD_FILE,
  MAX_UNCLEAN_RESUMES,
  persistTransition,
} from '../../persistence/saved-match';
import { ShareContext } from '../../sharing/share-provider';
import { createTestShare, type TestShare } from '../../sharing/test-share';
import { SettingsScreen } from '../settings/settings-screen';
import { HomeScreen } from './home-screen';

jest.mock('expo-asset', () => jest.requireActual('../../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../../jest/expo-file-system.cjs'));
// The engine's real `replay`, spied: the export of a crash-guarded match must never run it (TM-04).
jest.mock('@codelex/game-engine', () => {
  const actual = jest.requireActual<typeof Engine>('@codelex/game-engine');
  return { ...actual, replay: jest.fn(actual.replay) };
});
const replayMock = jest.mocked(replay);

const lexiconSource = createBundledLexiconSource();
let lexicon: LoadedLexicon;

beforeAll(async () => {
  lexicon = await loadBundledLexicon();
});

async function renderHome(seed: SeedHex, disk: MemoryFs, flag: boolean): Promise<TestShare> {
  const share = createTestShare();
  const services: MatchServices = {
    newSeed: () => seed,
    createBotRunner: (index) =>
      createJsThreadBotRunner(index, { nextFrame: () => Promise.resolve() }),
    thinkDelayMs: () => 0,
    shuffleRandom: () => 0,
    persistence: () => createPersistence(disk),
  };
  function Layout(): JSX.Element {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <I18nProvider locale="en">
          <FlagsProvider
            flags={{ 'play_vs_bot.enabled': true, 'playtest.match_log.enabled': flag }}
          >
            <MatchServicesContext value={services}>
              <ShareContext value={share}>
                <LexiconGate source={lexiconSource}>
                  <MatchSessionProvider>
                    <Stack screenOptions={{ headerShown: false }} />
                  </MatchSessionProvider>
                </LexiconGate>
              </ShareContext>
            </MatchServicesContext>
          </FlagsProvider>
        </I18nProvider>
      </GestureHandlerRootView>
    );
  }
  function Settings(): JSX.Element {
    return <SettingsScreen versions={{ app: '0.1.0', rules: 1, lexicon: '2f2cc6fca8fac92b' }} />;
  }
  await renderRouter(
    { _layout: Layout, index: HomeScreen, settings: Settings },
    { initialUrl: '/' },
  );
  return share;
}

/** Plays `n` scripted actions of `seed` through the app's persistence (as the match screen does). */
function persistMatch(disk: MemoryFs, seed: SeedHex, n: number, finish = false): void {
  const persistence = createPersistence(disk);
  const { start, steps } = scriptMatch(seed, lexicon, n);
  persistence.journal.start(playMatchConfig(seed, lexicon.index));
  let before = start;
  for (const step of steps) {
    persistTransition(persistence.journal, before, step.after, { lexicon: lexicon.index });
    before = step.after;
  }
  if (finish) finishMatch(persistence, before);
}

/** A log whose first record no longer matches its checksum: the corrupt card. */
function corruptDisk(): { readonly disk: MemoryFs; readonly bytes: Uint8Array } {
  const disk = new MemoryFs();
  new DataStore(disk).append(FILES.log, ['{"logVersion":1,"header":{}}', '{"a":1,"h":"x"}']);
  const bytes = disk.files.get(FILES.log);
  if (bytes === undefined) throw new Error('no log');
  bytes[10] = 0x41;
  return { disk, bytes: bytes.slice() };
}

describe('Send match log on the corrupt-state card (§5.10.2, S6d)', () => {
  it('exports the corrupt match as raw bytes, before Start a new match deletes it', async () => {
    const seed = humanStarts(lexicon, 5201);
    const { disk, bytes } = corruptDisk();
    const share = await renderHome(seed, disk, true);
    expect(await screen.findByText("We couldn't restore this match.")).toBeTruthy();
    const button = screen.getByTestId('home.sendMatchLog');
    expect(button.props.accessibilityLabel).toBe('Send match log');
    await act(async () => {
      await fireEvent.press(button);
    });
    expect(screen.getByTestId('matchlog.confirm.body').props.children).toBe(
      'The file holds the moves, seed and versions of your current match. No personal data in the file.',
    );
    await act(async () => {
      await fireEvent.press(screen.getByTestId('matchlog.share'));
      await Promise.resolve();
    });
    expect(share.opened).toHaveLength(1);
    const text = share.opened[0]?.files.get('codelex-match-log.json') ?? '';
    const decoded = decodeMatchLog(text);
    if (!decoded.ok) throw new Error(JSON.stringify(decoded.error));
    expect(decoded.value).toMatchObject({ raw: Buffer.from(bytes).toString('base64') });
    expect(share.files.size).toBe(0);
    // The card stays until the player acts; the match is still there.
    expect(screen.getByTestId('home.cannotResume')).toBeTruthy();
    expect(disk.files.has(FILES.log)).toBe(true);
  }, 60_000);

  it('exports a crash-guarded match (resume crashed twice) without replaying it (TM-04, TM-02 D-1)', async () => {
    const seed = humanStarts(lexicon, 5204);
    const disk = new MemoryFs();
    persistMatch(disk, seed, 6);
    // The last two resumes of this log never returned.
    new DataStore(disk).replace(GUARD_FILE, [String(MAX_UNCLEAN_RESUMES)]);
    replayMock.mockClear();
    const share = await renderHome(seed, disk, true);
    expect(await screen.findByText("We couldn't restore this match.")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('home.sendMatchLog'));
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('matchlog.share'));
      await Promise.resolve();
    });
    expect(share.opened).toHaveLength(1);
    const text = share.opened[0]?.files.get('codelex-match-log.json') ?? '';
    const decoded = decodeMatchLog(text);
    if (!decoded.ok) throw new Error(JSON.stringify(decoded.error));
    expect(Object.keys(decoded.value).sort()).toEqual(['app', 'exportFormat', 'kind', 'log']);
    expect(replayMock).not.toHaveBeenCalled();
    expect(disk.files.has(MATCH_LOG_GUARD_FILE)).toBe(false);
  }, 60_000);

  it('Settings exports the last finished match while the saved match has no move yet (§12.3)', async () => {
    const finished = humanStarts(lexicon, 5205);
    const seed = humanStarts(lexicon, 5300);
    expect(seed).not.toBe(finished);
    const disk = new MemoryFs();
    persistMatch(disk, finished, 6, true);
    // Play again, then the app was closed before the first move: current.log holds the header only.
    persistMatch(disk, seed, 0);
    expect(disk.files.has(FILES.log) && disk.files.has(FILES.last)).toBe(true);
    const share = await renderHome(seed, disk, true);
    // The resume card: the saved match (no move yet) was read.
    expect(await screen.findByTestId('home.newMatch')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('home.settings'));
    });
    await act(async () => {
      await fireEvent.press(await screen.findByTestId('settings.sendMatchLog'));
    });
    expect(screen.getByTestId('matchlog.confirm.body').props.children).toBe(
      'The file holds the moves, seed and versions of your last finished match. No personal data in the file.',
    );
    await act(async () => {
      await fireEvent.press(screen.getByTestId('matchlog.share'));
      await Promise.resolve();
    });
    const text = share.opened[0]?.files.get('codelex-match-log.json') ?? '';
    const decoded = decodeMatchLog(text);
    if (!decoded.ok || !('log' in decoded.value)) throw new Error('expected a readable log');
    expect(decoded.value.log.header.seed).toBe(finished);
    expect(decoded.value.log.actions.length).toBeGreaterThan(0);
  }, 60_000);

  it('offers Start a new match only while the flag is off', async () => {
    const seed = humanStarts(lexicon, 5202);
    await renderHome(seed, corruptDisk().disk, false);
    expect(await screen.findByText("We couldn't restore this match.")).toBeTruthy();
    expect(screen.getByTestId('home.startNew')).toBeTruthy();
    expect(screen.queryByTestId('home.sendMatchLog')).toBeNull();
  }, 60_000);

  it('has no Send match log on the version-mismatch card', async () => {
    const seed = humanStarts(lexicon, 5203);
    const disk = new MemoryFs();
    const config = { ...playMatchConfig(seed, lexicon.index), engineRulesVersion: 99 };
    new DataStore(disk).append(FILES.log, [JSON.stringify({ logVersion: 1, header: config })]);
    await renderHome(seed, disk, true);
    expect(
      await screen.findByText("This match was saved with an older version and can't be resumed."),
    ).toBeTruthy();
    expect(screen.queryByTestId('home.sendMatchLog')).toBeNull();
  }, 60_000);
});
