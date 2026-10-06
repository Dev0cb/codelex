/**
 * E-1.5 slice S3 through the screens (AC-11, AC-12, AC-10 "New to you", AC-19; threat model TM-01, TM-02). The
 * previous process is played with the very functions the app persists with (`persistTransition`), stopped while the
 * bot is thinking; the app then starts on that disk. Every committed move comes back, the bot plays the same move,
 * unusable saves show their card, a full disk shows the low-storage banner, and no route reads a log or writes
 * anything but the resume guard on mount. Kills at every write boundary are covered in `saved-match.test.ts`.
 */
import { apply, observe, type Action, type MatchState, type SeedHex } from '@codelex/game-engine';
import type { Locale } from '@codelex/i18n';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { JSX } from 'react';
import { AccessibilityInfo } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { FlagsProvider } from '../../config/flags-provider';
import { I18nProvider } from '../../i18n/i18n-provider';
import { createBundledLexiconSource } from '../../lexicon/bundled-lexicon-source';
import { LexiconGate } from '../../lexicon/lexicon-gate';
import type { LoadedLexicon } from '../../lexicon/load-lexicon';
import { createJsThreadBotRunner, type BotRunner } from '../../match/bot-runner';
import { MatchSessionProvider } from '../../match/match-session';
import { BOT_SEAT, HUMAN_SEAT, playMatchConfig } from '../../match/play-config';
import {
  botDecision,
  humanStarts,
  loadBundledLexicon,
  newPlayState,
  scriptedAction,
  scriptMatch,
} from '../../match/test-support';
import { MatchServicesContext, type MatchServices } from '../../match/use-match';
import { DataStore } from '../../persistence/data-store';
import { FILES } from '../../persistence/match-journal';
import { MemoryFs } from '../../persistence/memory-fs';
import { createPersistence, GUARD_FILE, persistTransition } from '../../persistence/saved-match';
import { HomeScreen } from '../home/home-screen';
import { MatchScreen } from './match-screen';

jest.mock('expo-asset', () => jest.requireActual('../../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../../jest/expo-file-system.cjs'));

const lexiconSource = createBundledLexiconSource();
let lexicon: LoadedLexicon;
let announce: jest.SpiedFunction<typeof AccessibilityInfo.announceForAccessibility>;

beforeAll(async () => {
  lexicon = await loadBundledLexicon();
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {
    /* recorded */
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

/** A bot runner the test releases decision by decision, recording every action it returns. */
function gatedRunner(index: LoadedLexicon['index']) {
  const actions: Action[] = [];
  const waiting: (() => void)[] = [];
  const inner = createJsThreadBotRunner(index, { nextFrame: () => Promise.resolve() });
  const runner: BotRunner = {
    async decide(request) {
      await new Promise<void>((resolve) => waiting.push(resolve));
      const result = await inner.decide(request);
      if (result.ok) actions.push(result.value.action);
      return result;
    },
  };
  return {
    runner,
    actions,
    release: () => {
      waiting.shift()?.();
    },
    pending: () => waiting.length,
  };
}

interface Setup {
  readonly seed: SeedHex;
  readonly disk: MemoryFs;
  readonly locale?: Locale;
  readonly playEnabled?: boolean;
  readonly runner?: BotRunner;
  readonly initialUrl?: string;
}

async function renderApp({
  seed,
  disk,
  locale = 'en',
  playEnabled = true,
  runner,
  initialUrl = '/',
}: Setup) {
  const services: MatchServices = {
    newSeed: () => seed,
    createBotRunner: (index) =>
      runner ?? createJsThreadBotRunner(index, { nextFrame: () => Promise.resolve() }),
    thinkDelayMs: () => 0,
    shuffleRandom: () => 0,
    persistence: () => createPersistence(disk),
  };
  function Layout(): JSX.Element {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <I18nProvider locale={locale}>
          <FlagsProvider flags={{ 'play_vs_bot.enabled': playEnabled }}>
            <MatchServicesContext value={services}>
              <LexiconGate source={lexiconSource}>
                <MatchSessionProvider>
                  <Stack screenOptions={{ headerShown: false }} />
                </MatchSessionProvider>
              </LexiconGate>
            </MatchServicesContext>
          </FlagsProvider>
        </I18nProvider>
      </GestureHandlerRootView>
    );
  }
  return renderRouter({ _layout: Layout, index: HomeScreen, match: MatchScreen }, { initialUrl });
}

const text = (testID: string): string => {
  const children: unknown = screen.getByTestId(testID).props.children;
  return Array.isArray(children) ? children.join('') : String(children);
};

function expectSameAsEngine(replica: MatchState): void {
  const view = observe(replica, HUMAN_SEAT);
  expect(text('match.score.you')).toBe(String(view.seats[HUMAN_SEAT]?.score));
  expect(text('match.score.bot')).toBe(String(view.seats[BOT_SEAT]?.score));
  expect(text('match.bag')).toBe(`Bag ${String(view.bagCount)}`);
}

const ctx = () => ({ lexicon: lexicon.index });

function applyOrThrow(state: MatchState, action: Action): MatchState {
  const applied = apply(state, action, ctx());
  if (!applied.ok) throw new Error(applied.error.message);
  return applied.value.state;
}

async function waitForPlayerTurn(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('match.action.pass').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });
}

/** The player's scripted move through the controls: a word (rack tile, square, PLAY) or a Pass. */
async function playerMove(replica: MatchState): Promise<MatchState> {
  await waitForPlayerTurn();
  const action = scriptedAction(replica, `ui-s3:${String(replica.actionCount)}`, lexicon);
  if (action.type !== 'PLACE_WORD') {
    await fireEvent.press(screen.getByTestId('match.action.pass'));
    await fireEvent.press(await screen.findByTestId('match.pass.confirm'));
    return applyOrThrow(replica, { seat: HUMAN_SEAT, type: 'PASS' });
  }
  for (const tile of action.tiles) {
    const isBlank = tile.tile !== tile.tile.toUpperCase();
    const rackLabel = isBlank
      ? /^Rack, tile \d+ of \d+: Blank tile, 0 points$/
      : new RegExp(`^Rack, tile \\d+ of \\d+: Letter ${tile.tile}, `);
    const [rackTile] = screen.getAllByLabelText(rackLabel);
    if (rackTile === undefined) throw new Error(`no ${tile.tile} on the rack`);
    await fireEvent.press(rackTile);
    await fireEvent.press(
      screen.getByLabelText(
        new RegExp(`, row ${String(tile.row + 1)} column ${String(tile.col + 1)}, empty$`),
      ),
    );
    if (isBlank) {
      await fireEvent.press(await screen.findByTestId(`match.blank.${tile.tile.toUpperCase()}`));
    }
  }
  await fireEvent.press(screen.getByTestId('match.action.play'));
  return applyOrThrow(replica, action);
}

async function releaseBot(gate: ReturnType<typeof gatedRunner>, replica: MatchState) {
  const before = gate.actions.length;
  await waitFor(() => {
    expect(gate.pending()).toBe(1);
  });
  await act(async () => {
    gate.release();
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(gate.actions.length).toBe(before + 1);
  });
  return applyOrThrow(replica, gate.actions[before] as Action);
}

/**
 * The disk a killed process leaves: a scripted match persisted action by action as the app does it, stopped after
 * at least `minActions` actions at a point where the bot is on turn (it was thinking when the process died).
 */
function diskWithBotThinking(
  seed: SeedHex,
  minActions = 3,
): { disk: MemoryFs; replica: MatchState } {
  const { start, steps } = scriptMatch(seed, lexicon, minActions + 4);
  const disk = new MemoryFs();
  const { journal } = createPersistence(disk);
  journal.start(playMatchConfig(seed, lexicon.index));
  let before = start;
  for (const step of steps) {
    expect(persistTransition(journal, before, step.after)).toBe('saved');
    before = step.after;
    if (before.actions.length >= minActions && before.state.seatOnTurn === BOT_SEAT) break;
  }
  expect(before.state.seatOnTurn).toBe(BOT_SEAT);
  return { disk: disk.reboot(), replica: before.state };
}

/** PLAY NOW, once the saved match has been read (the button is disabled while it is being read). */
async function pressPlayNow(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('home.playNow').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });
  await fireEvent.press(screen.getByTestId('home.playNow'));
}

async function homeReady(): Promise<void> {
  await waitFor(() => {
    expect(
      screen.queryByTestId('home.resume') ??
        screen.queryByTestId('home.cannotResume') ??
        screen.queryByTestId('home.playNow'),
    ).toBeTruthy();
  });
}

describe('S3 resume through the screens (AC-11, AC-12)', () => {
  it('restores every committed move after a kill during the bot turn, and the bot plays the same move', async () => {
    const seed = humanStarts(lexicon, 1201);
    const { disk, replica } = diskWithBotThinking(seed);
    const expectedBotMove = botDecision(replica, lexicon);
    const gate = gatedRunner(lexicon.index);
    await renderApp({ seed, disk, runner: gate.runner });
    const card = await screen.findByTestId('home.resume');
    expect(card).toBeTruthy();
    expect(screen.getByText('Resume vs Beginner Bot')).toBeTruthy();
    const view = observe(replica, HUMAN_SEAT);
    expect(text('home.resume.detail')).toBe(
      `vs Beginner Bot · Beginner Bot's turn · ${String(view.seats[HUMAN_SEAT]?.score)}–${String(view.seats[BOT_SEAT]?.score)}`,
    );
    await fireEvent.press(screen.getByTestId('home.playNow'));
    await screen.findByTestId('match.status');
    expectSameAsEngine(replica);
    await waitFor(() => {
      expect(announce).toHaveBeenCalledWith(
        `Match restored. Beginner Bot's turn ${String(view.seats[HUMAN_SEAT]?.score)} to ${String(view.seats[BOT_SEAT]?.score)}.`,
      );
    });
    const after = await releaseBot(gate, replica);
    expect(expectedBotMove.ok && gate.actions[0]).toEqual(
      expectedBotMove.ok ? expectedBotMove.value.action : null,
    );
    await waitFor(() => {
      expectSameAsEngine(after);
    });
  }, 60_000);

  it('shows the French resume card', async () => {
    const seed = humanStarts(lexicon, 1211);
    await renderApp({ seed, disk: diskWithBotThinking(seed).disk, locale: 'fr' });
    expect(await screen.findByText('Reprendre contre Bot Débutant')).toBeTruthy();
    expect(text('home.resume.detail')).toMatch(/^contre Bot Débutant · Au tour de Bot Débutant · /);
    expect(screen.getByText('Nouvelle partie…')).toBeTruthy();
  }, 60_000);

  it('asks before abandoning the match in progress, then starts a new one (AC-12)', async () => {
    const seed = humanStarts(lexicon, 1221);
    const next = diskWithBotThinking(seed).disk;
    await renderApp({ seed, disk: next });
    await fireEvent.press(await screen.findByTestId('home.newMatch'));
    expect(await screen.findByText('Start a new match?')).toBeTruthy();
    expect(
      screen.getByText('Your current match against Beginner Bot will be abandoned.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home.newMatch.cancel'));
    expect(screen.getByTestId('home.resume')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home.newMatch'));
    await fireEvent.press(await screen.findByTestId('home.newMatch.confirm'));
    await screen.findByTestId('match.status');
    expectSameAsEngine(newPlayState(seed, lexicon));
    // The abandoned match is gone: the log now holds only the new match's header.
    const read = new DataStore(next).read(FILES.log, 1 << 20);
    expect(read.kind === 'ok' ? read.records.length : -1).toBe(1);
  }, 60_000);

  it('lets an in-progress match be resumed while play_vs_bot.enabled is off (AC-19)', async () => {
    const seed = humanStarts(lexicon, 1231);
    const { disk, replica } = diskWithBotThinking(seed);
    await renderApp({ seed, disk, playEnabled: false });
    await screen.findByTestId('home.resume');
    expect(screen.queryByTestId('home.newMatch')).toBeNull();
    await fireEvent.press(screen.getByTestId('home.playNow'));
    await screen.findByTestId('match.status');
    expectSameAsEngine(replica);
  }, 60_000);
});

describe('S3 cannot-resume cards (§5.10.2, TM-02)', () => {
  const logOnDisk = (seed: SeedHex, patch: Record<string, unknown>): MemoryFs => {
    const disk = new MemoryFs();
    const config = { ...playMatchConfig(seed, lexicon.index), ...patch };
    new DataStore(disk).append(FILES.log, [JSON.stringify({ logVersion: 1, header: config })]);
    return disk;
  };

  it('shows the version-mismatch card for a log of a rules version this build cannot replay', async () => {
    const seed = humanStarts(lexicon, 1241);
    // 99 is unknown to this build (a downgrade); the draft entry 2 is covered in FR below.
    const disk = logOnDisk(seed, { engineRulesVersion: 99 });
    await renderApp({ seed, disk });
    expect(
      await screen.findByText("This match was saved with an older version and can't be resumed."),
    ).toBeTruthy();
    expect(screen.queryByTestId('home.playNow')).toBeNull();
  }, 60_000);

  it('shows the French version-mismatch card', async () => {
    const seed = humanStarts(lexicon, 1242);
    await renderApp({ seed, disk: logOnDisk(seed, { engineRulesVersion: 2 }), locale: 'fr' });
    expect(
      await screen.findByText(
        'Cette partie a été sauvegardée avec une ancienne version et ne peut pas être reprise.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Lancer une nouvelle partie')).toBeTruthy();
  }, 60_000);

  it('shows the corrupt card for an unreadable log; Start a new match deletes it', async () => {
    const seed = humanStarts(lexicon, 1251);
    const disk = new MemoryFs();
    const store = new DataStore(disk);
    store.append(FILES.log, ['{"logVersion":1,"header":{}}', '{"a":1,"h":"x"}']);
    const bytes = disk.files.get(FILES.log);
    if (bytes === undefined) throw new Error('no log');
    bytes[10] = 0x41; // the first record's payload no longer matches its checksum
    await renderApp({ seed, disk });
    expect(await screen.findByText("We couldn't restore this match.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home.startNew'));
    await screen.findByTestId('match.status');
    const read = store.read(FILES.log, 1 << 20);
    expect(read.kind === 'ok' ? read.records.length : -1).toBe(1);
  }, 60_000);

  it('shows the corrupt card without the start button while matches are paused', async () => {
    const seed = humanStarts(lexicon, 1261);
    await renderApp({
      seed,
      disk: logOnDisk(seed, { lexiconVersion: 'ffffffffffffffff' }),
      playEnabled: false,
    });
    expect(
      await screen.findByText("This match was saved with an older version and can't be resumed."),
    ).toBeTruthy();
    expect(screen.getByTestId('home.paused')).toBeTruthy();
    expect(screen.queryByTestId('home.startNew')).toBeNull();
  }, 60_000);
});

describe('S3 low storage, New to you and routes', () => {
  it('shows the low-storage banner when a write fails, keeps playing, and lets the player dismiss it', async () => {
    const seed = humanStarts(lexicon, 1271);
    const disk = new MemoryFs();
    const gate = gatedRunner(lexicon.index);
    await renderApp({ seed, disk, runner: gate.runner });
    await pressPlayNow();
    let replica = newPlayState(seed, lexicon);
    disk.fullAfter = 0;
    replica = await playerMove(replica);
    expect(await screen.findByText('Low storage: your match may not be saved')).toBeTruthy();
    replica = await releaseBot(gate, replica);
    await waitFor(() => {
      expectSameAsEngine(replica);
    });
    await fireEvent.press(screen.getByTestId('match.lowStorage.dismiss'));
    expect(screen.queryByTestId('match.lowStorage')).toBeNull();
  }, 60_000);

  it('counts the terms new to the player on this device, then not again (AC-10, D-15)', async () => {
    const seed = humanStarts(lexicon, 1281);
    const disk = new MemoryFs();
    const gate = gatedRunner(lexicon.index);
    await renderApp({ seed, disk, runner: gate.runner });
    const resignAfterFirstMove = async (): Promise<void> => {
      const first = scriptedAction(newPlayState(seed, lexicon), 'ui-s3:0', lexicon);
      expect(first.type).toBe('PLACE_WORD');
      await playerMove(newPlayState(seed, lexicon));
      await waitFor(() => {
        expect(gate.pending()).toBe(1);
      });
      await fireEvent.press(screen.getByTestId('match.menu.open'));
      await fireEvent.press(await screen.findByTestId('match.menu.resign'));
      await fireEvent.press(await screen.findByTestId('match.resign.confirm'));
      await screen.findByTestId('summary.result');
    };
    await pressPlayNow();
    await resignAfterFirstMove();
    const count = text('summary.newToYou');
    expect(count).toMatch(/^\d+ new to you$/);
    expect(screen.getAllByText('NEW').length).toBe(Number(count.split(' ')[0]));
    // Play again (same seed in this test): the same terms are no longer new.
    await act(async () => {
      gate.release();
      await Promise.resolve();
    });
    await fireEvent.press(screen.getByTestId('summary.playAgain'));
    await resignAfterFirstMove();
    expect(screen.queryByTestId('summary.newToYou')).toBeNull();
    expect(screen.queryByText('NEW')).toBeNull();
  }, 60_000);

  it('opens no log and writes nothing but the resume guard when a link opens /match (TM-02 E-1)', async () => {
    const seed = humanStarts(lexicon, 1291);
    const next = diskWithBotThinking(seed).disk;
    const log = next.files.get(FILES.log)?.slice();
    await renderApp({ seed, disk: next, initialUrl: '/match' });
    // No match opens from a link: the player lands on Home with the resume card.
    expect(await screen.findByTestId('home.resume')).toBeTruthy();
    await homeReady();
    expect(new Set(next.writes)).toEqual(new Set([`${GUARD_FILE}.tmp`, GUARD_FILE]));
    expect(next.files.get(FILES.log)).toEqual(log);
    expect(screen.queryByTestId('match.status')).toBeNull();
  }, 60_000);
});
