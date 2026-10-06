/**
 * E-1.5 slice S1 acceptance (sprint 3 row S1): a scripted full match vs the Beginner bot completes, and the scores the
 * app shows always equal an independent engine replica (engine/app score mismatches = 0); EN/FR; reduced motion;
 * flag `play_vs_bot.enabled`.
 */
import { chooseAction, PERSONALITIES } from '@codelex/bots';
import {
  apply,
  deriveRng,
  observe,
  type Action,
  type MatchState,
  type SeedHex,
} from '@codelex/game-engine';
import { CATALOGS, type Locale } from '@codelex/i18n';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { JSX } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { GestureHandlerRootView, State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { FlagsProvider } from '../../config/flags-provider';
import { I18nProvider } from '../../i18n/i18n-provider';
import { createBundledLexiconSource } from '../../lexicon/bundled-lexicon-source';
import { LexiconGate } from '../../lexicon/lexicon-gate';
import type { LoadedLexicon } from '../../lexicon/load-lexicon';
import { createJsThreadBotRunner, type BotRunner } from '../../match/bot-runner';
import { BOT_SEAT, HUMAN_SEAT, PLAY_BOT } from '../../match/play-config';
import {
  humanStarts,
  loadBundledLexicon,
  newPlayState,
  seedWhereFirst,
} from '../../match/test-support';
import { MatchServicesContext, type MatchServices } from '../../match/use-match';
import { HomeScreen } from '../home/home-screen';
import { MatchScreen } from './match-screen';

jest.mock('expo-asset', () => jest.requireActual('../../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../../jest/expo-file-system.cjs'));

const lexiconSource = createBundledLexiconSource();
let lexicon: LoadedLexicon;

beforeAll(async () => {
  lexicon = await loadBundledLexicon();
});

let reduceMotion = true;
let screenReader = true;
beforeEach(() => {
  reduceMotion = true;
  screenReader = true;
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => Promise.resolve(reduceMotion));
  jest
    .spyOn(AccessibilityInfo, 'isScreenReaderEnabled')
    .mockImplementation(() => Promise.resolve(screenReader));
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
  readonly locale?: Locale;
  readonly playEnabled?: boolean;
  readonly runner?: BotRunner;
}

async function renderApp({ seed, locale = 'en', playEnabled = true, runner }: Setup) {
  const services: MatchServices = {
    newSeed: () => seed,
    createBotRunner: (index) =>
      runner ?? createJsThreadBotRunner(index, { nextFrame: () => Promise.resolve() }),
    thinkDelayMs: () => 0,
    shuffleRandom: () => 0,
  };
  function Layout(): JSX.Element {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <I18nProvider locale={locale}>
          <FlagsProvider flags={{ 'play_vs_bot.enabled': playEnabled }}>
            <MatchServicesContext value={services}>
              <LexiconGate source={lexiconSource}>
                <Stack screenOptions={{ headerShown: false }} />
              </LexiconGate>
            </MatchServicesContext>
          </FlagsProvider>
        </I18nProvider>
      </GestureHandlerRootView>
    );
  }
  await renderRouter(
    { _layout: Layout, index: HomeScreen, match: MatchScreen },
    { initialUrl: '/' },
  );
}

async function startMatch(): Promise<void> {
  await fireEvent.press(await screen.findByTestId('home.playNow'));
  await screen.findByTestId('match.status');
}

const text = (testID: string): string => {
  const children: unknown = screen.getByTestId(testID).props.children;
  return Array.isArray(children) ? children.join('') : String(children);
};

/** The scores and bag the app shows equal the replica's, as the player may know them. */
function expectSameAsEngine(replica: MatchState): void {
  const view = observe(replica, HUMAN_SEAT);
  expect(text('match.score.you')).toBe(String(view.seats[HUMAN_SEAT]?.score));
  expect(text('match.score.bot')).toBe(String(view.seats[BOT_SEAT]?.score));
  expect(text('match.bag')).toBe(`Bag ${String(view.bagCount)}`);
}

function applyOrThrow(state: MatchState, action: Action): MatchState {
  const applied = apply(state, action, { lexicon: lexicon.index });
  if (!applied.ok) throw new Error(`replica refused ${action.type}: ${applied.error.message}`);
  return applied.value.state;
}

/** What a scripted player does: the Beginner's choice from a test-only stream; anything but a word is a Pass. */
function scriptedTurn(replica: MatchState): Action {
  const decided = chooseAction(observe(replica, HUMAN_SEAT), {
    lexicon: lexicon.index,
    rng: deriveRng(replica.seed, `test-player:${String(replica.actionCount)}`),
    personality: PLAY_BOT,
    budget: PERSONALITIES[PLAY_BOT].budget,
  });
  if (!decided.ok) throw new Error(decided.error.message);
  const { action } = decided.value;
  return action.type === 'PLACE_WORD' ? action : { seat: HUMAN_SEAT, type: 'PASS' };
}

/** Plays `action` through the UI exactly as a screen-reader user would: rack tile, square, (blank letter), PLAY. */
async function playThroughUi(action: Action): Promise<void> {
  if (action.type !== 'PLACE_WORD') {
    await fireEvent.press(screen.getByTestId('match.action.pass'));
    await fireEvent.press(await screen.findByTestId('match.pass.confirm'));
    return;
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
    if (isBlank)
      await fireEvent.press(await screen.findByTestId(`match.blank.${tile.tile.toUpperCase()}`));
  }
  await fireEvent.press(screen.getByTestId('match.action.play'));
}

async function playFullMatch(seed: SeedHex): Promise<{ replica: MatchState; actions: number }> {
  const gate = gatedRunner(lexicon.index);
  await renderApp({ seed, runner: gate.runner });
  await startMatch();
  let replica = newPlayState(seed, lexicon);
  let bot = 0;
  let steps = 0;
  while (replica.status === 'in_progress') {
    steps += 1;
    if (steps > 300) throw new Error('the match did not end');
    if (replica.seatOnTurn === BOT_SEAT) {
      await waitFor(() => {
        expect(gate.pending()).toBe(1);
      });
      await act(async () => {
        gate.release();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(gate.actions.length).toBe(bot + 1);
      });
      replica = applyOrThrow(replica, gate.actions[bot] as Action);
      bot += 1;
    } else {
      await waitFor(() => {
        expect(screen.getByTestId('match.action.pass').props.accessibilityState).toMatchObject({
          disabled: false,
        });
      });
      const action = scriptedTurn(replica);
      await playThroughUi(action);
      replica = applyOrThrow(replica, action);
    }
    if (replica.status === 'in_progress') {
      await waitFor(() => {
        expectSameAsEngine(replica);
      });
    }
  }
  return { replica, actions: replica.actionCount };
}

describe('Match vs Beginner (E-1.5 S1)', () => {
  it.each([
    ['the player starts', (l: LoadedLexicon) => humanStarts(l, 101)],
    ['the bot starts', (l: LoadedLexicon) => seedWhereFirst(BOT_SEAT, l, 201)],
  ])(
    'plays a scripted full match to the end with 0 engine/app score mismatches (%s)',
    async (_case, seedFor) => {
      const { replica, actions } = await playFullMatch(seedFor(lexicon));
      expect(actions).toBeGreaterThan(6);
      // End screen: final scores (R-SCORE-006 included) and result exactly as the engine computed them.
      await screen.findByTestId('summary.result');
      const final = observe(replica, HUMAN_SEAT);
      expect(text('summary.score.you')).toBe(String(final.seats[HUMAN_SEAT]?.score));
      expect(text('summary.score.bot')).toBe(String(final.seats[BOT_SEAT]?.score));
      const places = replica.result?.places ?? [];
      const expected =
        places[HUMAN_SEAT] === places[BOT_SEAT]
          ? 'Draw'
          : places[HUMAN_SEAT] === 1
            ? 'Victory'
            : 'Defeat';
      expect(text('summary.result')).toBe(expected);
      expect(screen.getByTestId('summary.reason')).toBeTruthy();
      // Play again starts a fresh match (same seed in this test, so the same deal).
      await fireEvent.press(screen.getByTestId('summary.playAgain'));
      await waitFor(() => {
        expectSameAsEngine(newPlayState(replica.seed, lexicon));
      });
    },
    240_000,
  );

  it('rejects an illegal placement with the engine reason and changes nothing (AC-6)', async () => {
    const seed = humanStarts(lexicon, 301);
    await renderApp({ seed });
    await startMatch();
    const [first] = screen.getAllByLabelText(/^Rack, tile 1 of 7: /);
    if (first === undefined) throw new Error('empty rack');
    await fireEvent.press(first);
    if (screen.queryByTestId('match.blank.A') === null) {
      await fireEvent.press(screen.getByLabelText(/, row 1 column 1, empty$/));
    }
    if (screen.queryByTestId('match.blank.A') !== null) {
      await fireEvent.press(screen.getByTestId('match.blank.A'));
    }
    await fireEvent.press(screen.getByTestId('match.action.play'));
    expect(text('match.status.primary')).toBe('The first word must cover the ★');
    expectSameAsEngine(newPlayState(seed, lexicon));
    // Recall returns the tile; the reason clears.
    await fireEvent.press(screen.getByTestId('match.action.recall'));
    expect(text('match.status.primary')).toBe('You start');
  });

  it('speaks French (AC-15)', async () => {
    const seed = humanStarts(lexicon, 401);
    await renderApp({ seed, locale: 'fr' });
    await fireEvent.press(await screen.findByText('JOUER'));
    expect(await screen.findByText('Tu commences')).toBeTruthy();
    expect(screen.getByText("Couvre l'étoile ★ avec au moins 2 lettres")).toBeTruthy();
    expect(screen.getByText('Passer')).toBeTruthy();
    expect(screen.getByLabelText('Jouer le mot')).toBeTruthy();
    expect(screen.getByText('Sac 86')).toBeTruthy();
  });

  it('shows static thinking dots under reduced motion and pulsing dots otherwise (D-25)', async () => {
    const seed = seedWhereFirst(BOT_SEAT, lexicon, 501);
    const gate = gatedRunner(lexicon.index);
    await renderApp({ seed, runner: gate.runner });
    await startMatch();
    expect(
      await screen.findByTestId('match.thinking.static', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(text('match.status.primary')).toBe('Beginner Bot is thinking…');
    await act(async () => {
      gate.release();
      await Promise.resolve();
    });
  });

  it('animates the thinking dots with full motion', async () => {
    reduceMotion = false;
    const seed = seedWhereFirst(BOT_SEAT, lexicon, 501);
    const gate = gatedRunner(lexicon.index);
    await renderApp({ seed, runner: gate.runner });
    await startMatch();
    expect(
      await screen.findByTestId('match.thinking.animated', { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it('stops with a message if the bot fails, never substituting a move', async () => {
    const seed = seedWhereFirst(BOT_SEAT, lexicon, 601);
    const broken: BotRunner = { decide: () => Promise.reject(new Error('boom')) };
    await renderApp({ seed, runner: broken });
    await startMatch();
    await waitFor(() => {
      expect(text('match.status.primary')).toBe('Something went wrong in this match.');
    });
    expectSameAsEngine(newPlayState(seed, lexicon));
    await fireEvent.press(screen.getByText('Home'));
    expect(await screen.findByTestId('home.playNow')).toBeTruthy();
  });

  it('shows the start error when the engine refuses the match header', async () => {
    await renderApp({ seed: 'not-a-seed' as SeedHex });
    await fireEvent.press(await screen.findByTestId('home.playNow'));
    expect(await screen.findByText("Couldn't start the match. Try again.")).toBeTruthy();
  });

  it('arms and zooms on the first Overview tap, then places on the next tap (D-2)', async () => {
    screenReader = false;
    const seed = humanStarts(lexicon, 701);
    await renderApp({ seed });
    await startMatch();
    const [first] = screen.getAllByLabelText(/^Rack, tile 1 of 7: /);
    if (first === undefined) throw new Error('empty rack');
    await fireEvent.press(first);
    expect(
      screen.getAllByLabelText(/^Rack, tile 1 of 7: /)[0]?.props.accessibilityState,
    ).toMatchObject({
      selected: true,
    });
    const { width: size } = StyleSheet.flatten(screen.getByTestId('board.root').props.style) as {
      width: number;
    };
    const cell = size / 15;
    const tap = async (x: number, y: number) => {
      fireGestureHandler(getByGestureTestId('board.tap'), [
        { state: State.BEGAN, x, y },
        { state: State.ACTIVE, x, y },
        { state: State.END, x, y },
      ]);
      // renderRouter installs fake timers, which also hold the microtask `scheduleOnRN` queues.
      await act(async () => {
        jest.runAllTicks();
        await Promise.resolve();
      });
    };
    // Overview: the first tap on the start square frames it in Focus and places nothing.
    await tap(7.5 * cell, 7.5 * cell);
    expect(screen.queryByTestId('match.action.recall')).toBeNull();
    // Focus is centred on that square: the next tap there places the tile.
    await tap(size / 2, size / 2);
    if (screen.queryByTestId('match.blank.A') !== null) {
      await fireEvent.press(screen.getByTestId('match.blank.A'));
    }
    expect(screen.getByTestId('match.action.recall')).toBeTruthy();
    expect(screen.getAllByLabelText(/^Rack, tile \d+ of 6: /)).toHaveLength(6);
  });
});

describe('coach marks (D-26)', () => {
  // coach.1 says "Tap a tile, then a square — or drag it onto the board". Drag-to-place is not built yet (S1 has the
  // tap path only), so no coach mark and no coach copy may ship until it is: add the keys with the drag gesture.
  it('ships no coach copy and shows no drag hint while drag-to-place does not exist', async () => {
    expect(Object.keys(CATALOGS.en).filter((key) => key.startsWith('coach.'))).toEqual([]);
    await renderApp({ seed: humanStarts(lexicon, 901) });
    await startMatch();
    expect(screen.queryByText(/drag/i)).toBeNull();
  });
});

describe('play_vs_bot.enabled off (AC-19)', () => {
  it('shows the paused card instead of PLAY NOW and keeps the match route closed', async () => {
    await renderApp({ seed: humanStarts(lexicon, 801), playEnabled: false });
    expect(await screen.findByText('Matches are paused for an update — back soon')).toBeTruthy();
    expect(screen.queryByTestId('home.playNow')).toBeNull();
  });

  it('sends a direct /match link back Home', async () => {
    const seed = humanStarts(lexicon, 801);
    await renderApp({ seed, playEnabled: false });
    await screen.findByTestId('home.paused');
    await act(async () => {
      router.push('/match');
      await Promise.resolve();
    });
    expect(await screen.findByTestId('home.paused')).toBeTruthy();
    expect(screen.queryByTestId('match.status')).toBeNull();
  });
});
