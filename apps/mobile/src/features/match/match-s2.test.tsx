/**
 * E-1.5 slice S2 acceptance (sprint 3 row S2): HUD, scores, rack interactions (Shuffle, Exchange, Pass, Resign),
 * score explanation, live preview and the Summary, behind `play_vs_bot.enabled`. Scripted full matches end
 * naturally and by Resign, driven only through the UI, with 0 score mismatches against an independent engine
 * replica after every action and on the Summary.
 */
import { getTokens } from '@codelex/design-system';
import {
  apply,
  observe,
  previewScore,
  type Action,
  type MatchEvent,
  type MatchState,
  type RackTile,
  type SeedHex,
} from '@codelex/game-engine';
import type { Locale } from '@codelex/i18n';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { JSX } from 'react';
import { AccessibilityInfo, Dimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import * as boardScene from '../../board/board-scene';
import { FlagsProvider } from '../../config/flags-provider';
import type { FlagKey } from '../../config/flags';
import { I18nProvider } from '../../i18n/i18n-provider';
import { createBundledLexiconSource } from '../../lexicon/bundled-lexicon-source';
import { LexiconGate } from '../../lexicon/lexicon-gate';
import type { LoadedLexicon } from '../../lexicon/load-lexicon';
import { createJsThreadBotRunner, type BotRunner } from '../../match/bot-runner';
import { BOT_SEAT, HUMAN_SEAT } from '../../match/play-config';
import {
  firstWordFor,
  humanStarts,
  loadBundledLexicon,
  newPlayState,
  scriptedAction,
  seedWhereFirst,
} from '../../match/test-support';
import { MatchServicesContext, type MatchServices } from '../../match/use-match';
import { HomeScreen } from '../home/home-screen';
import { MatchScreen, MORE_FONT_SCALE } from './match-screen';

jest.mock('expo-asset', () => jest.requireActual('../../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../../jest/expo-file-system.cjs'));

const lexiconSource = createBundledLexiconSource();
let lexicon: LoadedLexicon;

beforeAll(async () => {
  lexicon = await loadBundledLexicon();
});

let reduceMotion = true;
beforeEach(() => {
  reduceMotion = true;
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => Promise.resolve(reduceMotion));
  // Screen-reader mode exposes the accessible board grid the script taps (D-21).
  jest
    .spyOn(AccessibilityInfo, 'isScreenReaderEnabled')
    .mockImplementation(() => Promise.resolve(true));
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
  readonly flags?: Partial<Record<FlagKey, boolean>>;
  readonly runner?: BotRunner;
}

async function renderApp({ seed, locale = 'en', flags = {}, runner }: Setup) {
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
          <FlagsProvider flags={{ 'play_vs_bot.enabled': true, ...flags }}>
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
  await fireEvent.press(await screen.findByTestId('home.playNow'));
  await screen.findByTestId('match.status');
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

/** Places a word through the UI: rack tile, accessible square, (blank letter). */
async function placeThroughUi(action: Extract<Action, { type: 'PLACE_WORD' }>): Promise<void> {
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
}

/** Exchanges `tiles` through the Exchange sheet (AC-7). */
async function exchangeThroughUi(tiles: readonly string[]): Promise<void> {
  await fireEvent.press(screen.getByTestId('match.action.exchange'));
  const sheet = await screen.findByTestId('match.exchange.confirm');
  expect(sheet).toBeTruthy();
  for (const tile of tiles) {
    const label = tile === '?' ? /^Blank tile, 0 points$/ : new RegExp(`^Letter ${tile}, `);
    const candidate = screen
      .getAllByLabelText(label)
      .find(
        (el) =>
          (el.props as { accessibilityState?: { checked?: boolean } }).accessibilityState
            ?.checked === false,
      );
    if (candidate === undefined) throw new Error(`no unselected ${tile} in the exchange sheet`);
    await fireEvent.press(candidate);
  }
  expect(
    within(screen.getByTestId('match.exchange.confirm')).getByText(
      tiles.length === 1 ? 'Exchange 1 tile' : `Exchange ${String(tiles.length)} tiles`,
    ),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('match.exchange.confirm'));
}

async function resignThroughUi(): Promise<void> {
  await fireEvent.press(screen.getByTestId('match.menu.open'));
  await fireEvent.press(await screen.findByTestId('match.menu.resign'));
  expect(await screen.findByText('It counts as a defeat.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('match.resign.confirm'));
}

interface Played {
  readonly replica: MatchState;
  readonly events: MatchEvent[];
  readonly exchanges: number;
  readonly words: number;
}

/**
 * Plays a full match through the UI. The player's moves are the Beginner's choices on test-only streams: words,
 * exchanges and passes all go through the real controls. `resignAfter`: resign once that many actions are applied.
 */
async function playThroughUi(seed: SeedHex, resignAfter?: number): Promise<Played> {
  const gate = gatedRunner(lexicon.index);
  await renderApp({ seed, runner: gate.runner });
  let replica = newPlayState(seed, lexicon);
  const events: MatchEvent[] = [];
  let bot = 0;
  let exchanges = 0;
  let words = 0;
  /** Read through a call: `applyReplica` reassigns `replica`, which flow analysis cannot see. */
  const running = (): boolean => replica.status === 'in_progress';
  const applyReplica = (action: Action): MatchEvent[] => {
    const applied = apply(replica, action, { lexicon: lexicon.index });
    if (!applied.ok) throw new Error(`replica refused ${action.type}: ${applied.error.message}`);
    replica = applied.value.state;
    events.push(...applied.value.events);
    return [...applied.value.events];
  };
  for (let steps = 0; running(); steps += 1) {
    if (steps > 300) throw new Error('the match did not end');
    if (resignAfter !== undefined && replica.actionCount >= resignAfter) {
      await resignThroughUi();
      applyReplica({ seat: HUMAN_SEAT, type: 'RESIGN' });
      break;
    }
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
      const placed = applyReplica(gate.actions[bot] as Action).find(
        (e) => e.type === 'WORD_PLACED',
      );
      bot += 1;
      if (placed?.type === 'WORD_PLACED' && running()) {
        await waitFor(() => {
          expect(text('match.status.primary')).toBe(
            `Beginner Bot scored ${String(placed.breakdown.total)}`,
          );
        });
      }
    } else {
      await waitFor(() => {
        expect(screen.getByTestId('match.action.pass').props.accessibilityState).toMatchObject({
          disabled: false,
        });
      });
      const action = scriptedAction(replica, `ui-player:${String(replica.actionCount)}`, lexicon);
      if (action.type === 'PLACE_WORD') {
        // Shuffle first (no turn used): the scripted placement must still find its tiles.
        await fireEvent.press(screen.getByTestId('match.action.shuffle'));
        await placeThroughUi(action);
        await fireEvent.press(screen.getByTestId('match.action.play'));
        const placed = applyReplica(action).find((e) => e.type === 'WORD_PLACED');
        words += 1;
        if (placed?.type === 'WORD_PLACED' && running()) {
          // The strip shows exactly the engine's score for this move (AC-4).
          await waitFor(() => {
            expect(text('match.status.secondary')).toBe(
              `You scored ${String(placed.breakdown.total)}`,
            );
          });
        }
      } else if (action.type === 'EXCHANGE') {
        await exchangeThroughUi(action.tiles);
        applyReplica({ ...action, seat: HUMAN_SEAT });
        exchanges += 1;
      } else {
        await fireEvent.press(screen.getByTestId('match.action.pass'));
        await fireEvent.press(await screen.findByTestId('match.pass.confirm'));
        applyReplica({ seat: HUMAN_SEAT, type: 'PASS' });
      }
    }
    if (running()) {
      await waitFor(() => {
        expectSameAsEngine(replica);
      });
    }
  }
  return { replica, events, exchanges, words };
}

function expectSummaryScores(replica: MatchState): void {
  const final = observe(replica, HUMAN_SEAT);
  const you = final.seats[HUMAN_SEAT]?.score ?? NaN;
  const them = final.seats[BOT_SEAT]?.score ?? NaN;
  expect(text('summary.score.you')).toBe(String(you));
  expect(text('summary.score.bot')).toBe(String(them));
  expect(text('summary.margin')).toBe(`Margin: ${String(Math.abs(you - them))}`);
}

const signed = (n: number): string => (n > 0 ? `+${String(n)}` : n < 0 ? `−${String(-n)}` : '0');

describe('S2 scripted full matches through the UI (0 engine/app mismatches)', () => {
  it.each([
    ['the player starts', (l: LoadedLexicon) => humanStarts(l, 2101), 0],
    // This seed's scripted player exchanges late in the match: the Exchange sheet is part of the full match.
    ['the bot starts', (l: LoadedLexicon) => seedWhereFirst(BOT_SEAT, l, 2201), 1],
  ])(
    'ends naturally and the Summary equals the engine (%s)',
    async (_case, seedFor, minExchanges) => {
      const { replica, events, words, exchanges } = await playThroughUi(seedFor(lexicon));
      expect(replica.result?.end.reason).not.toBe('resign');
      expect(words).toBeGreaterThan(2);
      expect(exchanges).toBeGreaterThanOrEqual(minExchanges);
      await screen.findByTestId('summary.result');
      expectSummaryScores(replica);
      const places = replica.result?.places ?? [];
      expect(text('summary.result')).toBe(
        places[HUMAN_SEAT] === places[BOT_SEAT]
          ? 'Draw'
          : places[HUMAN_SEAT] === 1
            ? 'Victory'
            : 'Defeat',
      );
      const adj = replica.result?.adjustments ?? [];
      expect(text('summary.rackAdjust')).toBe(
        `Racks: you ${signed(adj[HUMAN_SEAT] ?? 0)}, Beginner Bot ${signed(adj[BOT_SEAT] ?? 0)}`,
      );
      // Best word: the highest engine turn total of the match.
      const totals = events.flatMap((e) => (e.type === 'WORD_PLACED' ? [e.breakdown.total] : []));
      expect(text('summary.bestWord')).toContain(`· ${String(Math.max(...totals))} pts ·`);
      // Terms the player played are listed once each (canonical, deduplicated).
      const mine = new Set(
        events.flatMap((e) =>
          e.type === 'WORD_PLACED' && e.seat === HUMAN_SEAT
            ? e.breakdown.words.map((w) => w.canonicalForm)
            : [],
        ),
      );
      const chips = within(screen.getByTestId('summary.terms.you')).getAllByText(/^[A-Z]+$/);
      expect(new Set(chips.map((c) => String(c.props.children)))).toEqual(mine);
      expect(chips).toHaveLength(mine.size);
      // Play again starts a fresh match from the Summary's sticky bar.
      await fireEvent.press(screen.getByTestId('summary.playAgain'));
      await waitFor(() => {
        expectSameAsEngine(newPlayState(replica.seed, lexicon));
      });
    },
    300_000,
  );

  it('exchanges the chosen tiles through the sheet; the scores and bag equal the engine', async () => {
    const seed = humanStarts(lexicon, 2401);
    const state = newPlayState(seed, lexicon);
    await renderApp({ seed });
    const rack = state.seats[HUMAN_SEAT]?.rack ?? '';
    const tiles = [rack.charAt(0), rack.charAt(1)];
    await exchangeThroughUi(tiles);
    const expected = apply(
      state,
      { seat: HUMAN_SEAT, type: 'EXCHANGE', tiles: [...tiles].sort() as RackTile[] },
      { lexicon: lexicon.index },
    );
    if (!expected.ok) throw new Error('engine refused the exchange');
    await waitFor(() => {
      expectSameAsEngine(expected.value.state);
    });
    // The log counts exchanged tiles and never names them.
    expect(text('match.status.secondary')).toBe('You exchanged 2 tiles');
  });

  it('ends by Resign: Defeat, no rack adjustment or bot rack, scores equal the engine', async () => {
    const { replica } = await playThroughUi(humanStarts(lexicon, 2501), 5);
    expect(replica.result?.end).toEqual({ reason: 'resign', seat: HUMAN_SEAT });
    await screen.findByTestId('summary.result');
    expect(text('summary.result')).toBe('Defeat');
    expect(text('summary.reason')).toBe('You resigned.');
    expect(screen.queryByTestId('summary.rackAdjust')).toBeNull();
    expect(screen.queryByTestId('summary.botRack')).toBeNull();
    expectSummaryScores(replica);
    await fireEvent.press(screen.getByTestId('summary.home'));
    expect(await screen.findByTestId('home.playNow')).toBeTruthy();
  }, 300_000);
});

describe('HUD and score explanation', () => {
  it('shows the engine preview as "Base N" only with the flag on, never a validity cue (AC-5)', async () => {
    const seed = humanStarts(lexicon, 2601);
    const state = newPlayState(seed, lexicon);
    const action = firstWordFor(state, lexicon);
    const expected = previewScore(observe(state, HUMAN_SEAT), action.tiles);
    if (expected === null) throw new Error('no preview for a legal word');
    await renderApp({ seed });
    await placeThroughUi(action);
    expect(text('match.status.primary')).toBe(
      expected.fullStack > 0
        ? `Base ${String(expected.total)} (Full Stack included)`
        : `Base ${String(expected.total)}`,
    );
    expect(text('match.status.secondary')).toBe(
      'Term, chain and other bonuses are added when you play.',
    );
    expect(screen.queryByText(/valid/i)).toBeNull();
  });

  it('shows the same "Base N" line for a legal placement that is not a word: no validity leak (AC-5)', async () => {
    const seed = humanStarts(lexicon, 2601);
    const state = newPlayState(seed, lexicon);
    const rack = (state.seats[HUMAN_SEAT]?.rack ?? '').replace(/\?/g, '');
    // Two rack letters across the start square whose string is not a playable form.
    let pair: [string, string] | null = null;
    for (let i = 0; i < rack.length && pair === null; i += 1) {
      for (let j = 0; j < rack.length && pair === null; j += 1) {
        const a = rack.charAt(i);
        const b = rack.charAt(j);
        if (i !== j && !lexicon.index.has(a + b)) pair = [a, b];
      }
    }
    if (pair === null) throw new Error('every pair on this rack is a word');
    const action = {
      seat: HUMAN_SEAT,
      type: 'PLACE_WORD' as const,
      tiles: [
        { row: 7, col: 7, tile: pair[0] as 'A' },
        { row: 7, col: 8, tile: pair[1] as 'A' },
      ],
    };
    const expected = previewScore(observe(state, HUMAN_SEAT), action.tiles);
    if (expected === null) throw new Error('legal geometry must preview');
    await renderApp({ seed });
    await placeThroughUi(action);
    // Exactly the line a real word gets: "Base N" and the bonus hint, nothing else.
    expect(text('match.status.primary')).toBe(`Base ${String(expected.total)}`);
    expect(text('match.status.secondary')).toBe(
      'Term, chain and other bonuses are added when you play.',
    );
    expect(screen.queryByText(/valid|lexicon/i)).toBeNull();
    // Validity is revealed only on PLAY.
    await fireEvent.press(screen.getByTestId('match.action.play'));
    expect(text('match.status.primary')).toBe(`Not in the CODELEX lexicon: ${pair[0]}${pair[1]}`);
  });

  it('does not rebuild the board squares on Shuffle or tile selection (E-1.4 §2.4)', async () => {
    const seed = humanStarts(lexicon, 2601);
    const spy = jest.spyOn(boardScene, 'boardSquares');
    await renderApp({ seed });
    const before = spy.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('match.action.shuffle'));
    const [tile] = screen.getAllByLabelText(/^Rack, tile 1 of 7: /);
    if (tile === undefined) throw new Error('empty rack');
    await fireEvent.press(tile);
    await fireEvent.press(tile);
    expect(spy.mock.calls.length).toBe(before);
    // A placement does rebuild them.
    await fireEvent.press(tile);
    await fireEvent.press(screen.getByLabelText(/, row 8 column 8, empty$/));
    if (screen.queryByTestId('match.blank.A') !== null) {
      await fireEvent.press(screen.getByTestId('match.blank.A'));
    }
    expect(spy.mock.calls.length).toBeGreaterThan(before);
  });

  it('renders no preview with match.live_score_preview off (AC-5)', async () => {
    const seed = humanStarts(lexicon, 2601);
    const action = firstWordFor(newPlayState(seed, lexicon), lexicon);
    await renderApp({ seed, flags: { 'match.live_score_preview': false } });
    await placeThroughUi(action);
    expect(text('match.status.primary')).toBe('Your move');
    expect(screen.queryByText(/^Base /)).toBeNull();
  });

  it('explains a committed move with chips and the full engine breakdown (AC-4, D-14)', async () => {
    const seed = humanStarts(lexicon, 2701);
    const state = newPlayState(seed, lexicon);
    const action = firstWordFor(state, lexicon);
    const applied = apply(state, action, { lexicon: lexicon.index });
    if (!applied.ok) throw new Error('setup');
    const placed = applied.value.events.find((e) => e.type === 'WORD_PLACED');
    if (placed?.type !== 'WORD_PLACED') throw new Error('setup');
    // Hold the bot so the explanation stays on screen.
    const gate = gatedRunner(lexicon.index);
    await renderApp({ seed, runner: gate.runner });
    await placeThroughUi(action);
    await fireEvent.press(screen.getByTestId('match.action.play'));
    expect(text('match.status.secondary')).toBe(`You scored ${String(placed.breakdown.total)}`);
    // The first move covers the DW start square: the word multiplier chip is shown.
    expect(
      within(screen.getByTestId('match.breakdown.chips')).getByText(/^Word ×\d$/),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('match.status'));
    expect(await screen.findByText('Score breakdown')).toBeTruthy();
    expect(text('match.breakdown.total')).toBe(`Total ${String(placed.breakdown.total)}`);
    const main = placed.breakdown.words.find((w) => w.main);
    expect(
      screen.getByText(
        `Letters ${String(main?.letterSum)} × ${String(main?.wordMult)} = ${String(main?.base)}`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/tech/i)).toBeNull();
    await fireEvent.press(screen.getByText('Close'));
    await act(async () => {
      gate.release();
      await Promise.resolve();
    });
  });

  it('lists moves newest first in the log and counts squares from the layout in the legend', async () => {
    const seed = humanStarts(lexicon, 2801);
    const gate = gatedRunner(lexicon.index);
    await renderApp({ seed, runner: gate.runner });
    await fireEvent.press(screen.getByTestId('match.menu.open'));
    await fireEvent.press(await screen.findByTestId('match.menu.log'));
    expect(await screen.findByText('No moves yet')).toBeTruthy();
    await fireEvent.press(screen.getByText('Close'));
    await fireEvent.press(screen.getByTestId('match.action.pass'));
    await fireEvent.press(await screen.findByTestId('match.pass.confirm'));
    await fireEvent.press(screen.getByTestId('match.menu.open'));
    await fireEvent.press(await screen.findByTestId('match.menu.log'));
    expect(text('match.log.entry.1')).toBe('You passed');
    await fireEvent.press(screen.getByText('Close'));
    await fireEvent.press(screen.getByTestId('match.menu.open'));
    await fireEvent.press(await screen.findByTestId('match.menu.legend'));
    expect(within(screen.getByTestId('match.legend.TW')).getByText('8 squares')).toBeTruthy();
    expect(within(screen.getByTestId('match.legend.DW')).getByText('13 squares')).toBeTruthy();
    expect(within(screen.getByTestId('match.legend.TL')).getByText('12 squares')).toBeTruthy();
    expect(within(screen.getByTestId('match.legend.DL')).getByText('28 squares')).toBeTruthy();
    await fireEvent.press(screen.getByText('Close'));
    await act(async () => {
      gate.release();
      await Promise.resolve();
    });
  });

  it('keeps Exchange focusable below the bag minimum and says why on tap (§5.5.6)', async () => {
    // Drive a match until the bag runs low, then tap Exchange.
    const seed = humanStarts(lexicon, 2901);
    const { replica } = await playUntilLowBag(seed);
    const exchange = screen.getByTestId('match.action.exchange');
    expect(exchange.props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(exchange);
    expect(text('match.status.primary')).toBe(
      `Exchange needs at least 7 tiles in the bag (now ${String(replica.bag.length)}).`,
    );
    expect(screen.queryByTestId('match.exchange.confirm')).toBeNull();
  }, 300_000);

  it('speaks French on the Summary (AC-15)', async () => {
    const seed = humanStarts(lexicon, 3001);
    await renderApp({ seed, locale: 'fr' });
    await fireEvent.press(screen.getByTestId('match.menu.open'));
    await fireEvent.press(await screen.findByTestId('match.menu.resign'));
    expect(await screen.findByText('Déclarer forfait ?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('match.resign.confirm'));
    expect(await screen.findByText('Défaite')).toBeTruthy();
    expect(screen.getByText('Tu as déclaré forfait.')).toBeTruthy();
    expect(screen.getByText('Aucun mot marqué dans cette partie.')).toBeTruthy();
    expect(screen.getByText('Rejouer')).toBeTruthy();
  });
});

/** Plays through the UI (words and passes) on the player's turns until the bag holds fewer than 7 tiles. */
async function playUntilLowBag(seed: SeedHex): Promise<{ replica: MatchState }> {
  const gate = gatedRunner(lexicon.index);
  await renderApp({ seed, runner: gate.runner });
  let replica = newPlayState(seed, lexicon);
  let bot = 0;
  for (let steps = 0; steps < 200; steps += 1) {
    if (replica.status !== 'in_progress') throw new Error('the match ended before the bag ran low');
    if (replica.seatOnTurn === HUMAN_SEAT && replica.bag.length < 7) break;
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
      const next = apply(replica, gate.actions[bot] as Action, { lexicon: lexicon.index });
      if (!next.ok) throw new Error('replica refused the bot');
      replica = next.value.state;
      bot += 1;
    } else {
      await waitFor(() => {
        expect(screen.getByTestId('match.action.pass').props.accessibilityState).toMatchObject({
          disabled: false,
        });
      });
      const action = scriptedAction(replica, `ui-player:${String(replica.actionCount)}`, lexicon);
      const move: Action =
        action.type === 'PLACE_WORD' ? action : { seat: HUMAN_SEAT, type: 'PASS' };
      if (move.type === 'PLACE_WORD') {
        await placeThroughUi(move);
        await fireEvent.press(screen.getByTestId('match.action.play'));
      } else {
        await fireEvent.press(screen.getByTestId('match.action.pass'));
        await fireEvent.press(await screen.findByTestId('match.pass.confirm'));
      }
      const next = apply(replica, move, { lexicon: lexicon.index });
      if (!next.ok) throw new Error('replica refused the player');
      replica = next.value.state;
    }
    await waitFor(() => {
      expectSameAsEngine(replica);
    });
  }
  await waitFor(() => {
    expect(screen.getByTestId('match.action.pass').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });
  return { replica };
}

describe('large text and long labels (E-1.5 D-20, AC-15, AC-16)', () => {
  // Set before rendering: `useWindowDimensions` reads it on mount.
  const setFontScale = (fontScale: number): void => {
    Dimensions.set({
      window: { ...Dimensions.get('window'), fontScale },
      screen: { ...Dimensions.get('screen'), fontScale },
    });
  };
  afterEach(() => {
    setFontScale(1);
  });

  it('keeps PLAY in the action row at font scale 1.5; Shuffle, Exchange and Pass move to More', async () => {
    const seed = humanStarts(lexicon, 2601);
    const action = firstWordFor(newPlayState(seed, lexicon), lexicon);
    setFontScale(MORE_FONT_SCALE);
    await renderApp({ seed });
    expect(screen.getByTestId('match.action.play')).toBeTruthy();
    expect(screen.getByTestId('match.action.more')).toBeTruthy();
    expect(screen.queryByTestId('match.action.pass')).toBeNull();
    // PLAY stays usable: place a word, PLAY is enabled without leaving the screen.
    await placeThroughUi(action);
    expect(screen.getByTestId('match.action.play').props.accessibilityState).toMatchObject({
      disabled: false,
    });
    await fireEvent.press(screen.getByTestId('match.action.recall'));
    // The secondary actions are one tap away in the More sheet.
    await fireEvent.press(screen.getByTestId('match.action.more'));
    expect(await screen.findByTestId('match.action.pass')).toBeTruthy();
    expect(screen.getByTestId('match.action.exchange')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('match.action.shuffle'));
    expect(screen.queryByTestId('match.action.pass')).toBeNull();
  });

  it('shows all secondary actions inline below the threshold', async () => {
    setFontScale(1.3);
    await renderApp({ seed: humanStarts(lexicon, 2601) });
    expect(screen.getByTestId('match.action.pass')).toBeTruthy();
    expect(screen.queryByTestId('match.action.more')).toBeNull();
  });

  it('fits the FR Resign label on one line at 360 dp (width estimate; Jest has no text layout)', () => {
    // Upper bound for bold system sans glyphs: 0.62 em per character (Roboto/SF bold average is about 0.55).
    const { space, type } = getTokens('dark');
    const sheetContent = 360 - 2 * space[5]; // Sheet padding
    const labelBox = sheetContent - 2 * space[5]; // Button horizontal padding
    for (const label of ['Déclarer forfait', 'Déclarer forfait ?', 'Continuer']) {
      expect(label.length * 0.62 * type.body.fontSize).toBeLessThanOrEqual(labelBox);
    }
  });
});
