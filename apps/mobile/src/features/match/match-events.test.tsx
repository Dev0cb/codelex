/**
 * Gameplay analytics through the app (E-1.5 AC-17, design §11; sprint 4 EV). Every test drives the real screens
 * (Home, Match, Summary) with the real match session and recorder, then reads what the recorder queued, as the
 * export file holds it: `bot_match_started`, `bot_word_played`, `bot_decision_made`, `word_rejected`,
 * `bot_match_finished`, `bot_match_abandoned`, `bot_match_resumed`, `match_summary_action` and
 * `onboarding_step_completed`, with exactly the catalogue properties. Nothing is recorded or written with the flag
 * off or consent off.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { BOT_VERSION, type BotDecision } from '@codelex/bots';
import { apply, type Action, type MatchState, type SeedHex } from '@codelex/game-engine';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { JSX } from 'react';
import { AccessibilityInfo, AppState, type AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnalyticsProvider, CreateAnalyticsContext } from '../../analytics/analytics-provider';
import type { AnalyticsEvent, EventName, EventProperties } from '../../analytics/events';
import { ONBOARDING_FILE, PLAY_FILE, PlaytestAnalytics } from '../../analytics/recorder';
import { eventId } from '../../analytics/test-support';
import { FlagsProvider } from '../../config/flags-provider';
import { decodePlaytestExport } from '../../export/playtest-data';
import { I18nProvider } from '../../i18n/i18n-provider';
import { createBundledLexiconSource } from '../../lexicon/bundled-lexicon-source';
import { LexiconGate } from '../../lexicon/lexicon-gate';
import type { LoadedLexicon } from '../../lexicon/load-lexicon';
import { createJsThreadBotRunner, type BotRunner } from '../../match/bot-runner';
import { MatchSessionProvider } from '../../match/match-session';
import { MAX_REJECTED_EVENTS_PER_TURN } from '../../match/match-telemetry';
import { BOT_SEAT, HUMAN_SEAT, PLAY_RULES_VERSION, playMatchConfig } from '../../match/play-config';
import {
  humanStarts,
  loadBundledLexicon,
  newPlayState,
  scriptedAction,
  seedWhereFirst,
} from '../../match/test-support';
import { MatchServicesContext, type MatchServices } from '../../match/use-match';
import { DataStore } from '../../persistence/data-store';
import { FILES } from '../../persistence/match-journal';
import { MemoryFs } from '../../persistence/memory-fs';
import { createPersistence } from '../../persistence/saved-match';
import { HomeScreen } from '../home/home-screen';
import { MatchScreen } from './match-screen';

jest.mock('expo-asset', () => jest.requireActual('../../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../../jest/expo-file-system.cjs'));

const T0 = Date.parse('2026-10-16T09:00:00.000Z');
/** What the test bot runner "spends" per decision on the analytics clock. */
const COMPUTE_MS = 600;
/** What the scripted player "thinks" before each PLAY. */
const THINK_MS = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const lexiconSource = createBundledLexiconSource();
let lexicon: LoadedLexicon;
let listeners: ((state: AppStateStatus) => void)[] = [];

beforeAll(async () => {
  lexicon = await loadBundledLexicon();
});
beforeEach(() => {
  listeners = [];
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener);
    return {
      remove: () => {
        listeners = listeners.filter((l) => l !== listener);
      },
    };
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

interface Clock {
  wall: number;
  mono: number;
}

/** Ids are unique across the "processes" of one test (one install keeps its queue across them). */
let ids = 0;
/** The `session_id` of each recorder (its first UUID): one per process. */
const sessions = new WeakMap<PlaytestAnalytics, string>();

function recorder(fs: MemoryFs, clock: Clock, enabled = true): PlaytestAnalytics {
  const session = eventId(ids + 1);
  const analytics = new PlaytestAnalytics(
    {
      fs,
      randomUUID: () => {
        ids += 1;
        return eventId(ids);
      },
      wallMs: () => clock.wall,
      monoMs: () => clock.mono,
      sinceProcessStartMs: () => 1000,
      context: () => ({ app_version: '0.1.0', platform: 'android', locale: 'en-US' }),
      sweepShareDirectory: () => undefined,
    },
    enabled,
  );
  sessions.set(analytics, session);
  return analytics;
}

/** A recorder of an install that already enrolled (no first-time flow), consent on, notice seen. */
function enrolled(fs: MemoryFs, clock: Clock, enabled = true): PlaytestAnalytics {
  new DataStore(fs).replace('analytics.consent', ['{"v":1,"consent":true,"noticeSeen":true}']);
  return recorder(fs, clock, enabled);
}

/**
 * The bot: real decisions, recorded; each one costs {@link COMPUTE_MS} on the clock; optionally held. `frameMs`: what
 * the wait for the next frame costs on the clock before the search starts (not compute time).
 */
function botRunner(clock: Clock, gated = false, frameMs = 0) {
  const decisions: BotDecision[] = [];
  const waiting: (() => void)[] = [];
  const inner = createJsThreadBotRunner(lexicon.index, {
    nextFrame: () => {
      clock.mono += frameMs;
      return Promise.resolve();
    },
  });
  const runner: BotRunner = {
    async decide(request, onStart) {
      if (gated) await new Promise<void>((resolve) => waiting.push(resolve));
      // After the next frame, as the device runner computes (the previous move is drawn by then).
      const result = await inner.decide(request, onStart);
      clock.mono += COMPUTE_MS;
      if (result.ok) decisions.push(result.value);
      return result;
    },
  };
  return {
    runner,
    decisions,
    /** Decisions the test has already applied to its replica. */
    used: 0,
    pending: () => waiting.length,
    release: () => waiting.shift()?.(),
  };
}

interface Setup {
  readonly analytics: PlaytestAnalytics;
  readonly seed: SeedHex;
  readonly runner: BotRunner;
  readonly disk?: MemoryFs;
  readonly enabled?: boolean;
  /** The bot's presentation delay (D-29); 0 by default. */
  readonly thinkDelayMs?: number;
}

async function renderApp({
  analytics,
  seed,
  runner,
  disk,
  enabled = true,
  thinkDelayMs = 0,
}: Setup) {
  const services: MatchServices = {
    newSeed: () => seed,
    createBotRunner: () => runner,
    thinkDelayMs: () => thinkDelayMs,
    shuffleRandom: () => 0,
    ...(disk === undefined ? {} : { persistence: () => createPersistence(disk) }),
  };
  function Layout(): JSX.Element {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <I18nProvider locale="en">
          <FlagsProvider
            flags={{ 'play_vs_bot.enabled': true, 'analytics.upload.enabled': enabled }}
          >
            <CreateAnalyticsContext value={() => analytics}>
              <AnalyticsProvider>
                <MatchServicesContext value={services}>
                  <LexiconGate source={lexiconSource}>
                    <MatchSessionProvider>
                      <Stack screenOptions={{ headerShown: false }} />
                    </MatchSessionProvider>
                  </LexiconGate>
                </MatchServicesContext>
              </AnalyticsProvider>
            </CreateAnalyticsContext>
          </FlagsProvider>
        </I18nProvider>
      </GestureHandlerRootView>
    );
  }
  const result = await renderRouter(
    { _layout: Layout, index: HomeScreen, match: MatchScreen },
    { initialUrl: '/' },
  );
  await waitFor(() => {
    expect(
      screen.queryByTestId('home.resume') ??
        screen.queryByTestId('home.cannotResume') ??
        screen.queryByTestId('home.playNow'),
    ).toBeTruthy();
  });
  return result;
}

async function moveAppTo(next: AppStateStatus): Promise<void> {
  await act(async () => {
    for (const listener of [...listeners]) listener(next);
    await Promise.resolve();
  });
}

/** The events this process (recorder) queued, as the export file holds them (oldest first). */
function queued(analytics: PlaytestAnalytics): AnalyticsEvent[] {
  const prepared = analytics.prepareExport('1');
  if (!prepared.ok) return [];
  const { events } = JSON.parse(prepared.file.text) as { events: AnalyticsEvent[] };
  return events.filter((e) => e.session_id === sessions.get(analytics));
}

/** Every event the install's queue holds, whichever process queued it. */
function allQueued(analytics: PlaytestAnalytics): AnalyticsEvent[] {
  const prepared = analytics.prepareExport('1');
  if (!prepared.ok) return [];
  return (JSON.parse(prepared.file.text) as { events: AnalyticsEvent[] }).events;
}

function propsOf<N extends EventName>(analytics: PlaytestAnalytics, name: N): EventProperties<N>[] {
  return queued(analytics)
    .filter((e) => e.event === name)
    .map((e) => e.properties as EventProperties<N>);
}

const GAMEPLAY: readonly string[] = [
  'bot_match_started',
  'bot_match_finished',
  'bot_match_abandoned',
  'bot_match_resumed',
  'bot_decision_made',
  'bot_word_played',
  'word_rejected',
  'match_summary_action',
  'onboarding_step_completed',
];
const gameplay = (analytics: PlaytestAnalytics): AnalyticsEvent[] =>
  queued(analytics).filter((e) => GAMEPLAY.includes(e.event));

async function pressPlayNow(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('home.playNow').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });
  await fireEvent.press(screen.getByTestId('home.playNow'));
  await screen.findByTestId('match.status');
}

async function waitForPlayerTurn(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('match.action.pass').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });
}

function applyOrThrow(state: MatchState, action: Action) {
  const applied = apply(state, action, { lexicon: lexicon.index });
  if (!applied.ok) throw new Error(`replica refused ${action.type}`);
  return applied.value;
}

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
    if (isBlank) {
      await fireEvent.press(await screen.findByTestId(`match.blank.${tile.tile.toUpperCase()}`));
    }
  }
}

async function resignThroughUi(): Promise<void> {
  await fireEvent.press(screen.getByTestId('match.menu.open'));
  await fireEvent.press(await screen.findByTestId('match.menu.resign'));
  await fireEvent.press(await screen.findByTestId('match.resign.confirm'));
}

/** One applied action of the replica, with what the events must say about it. */
interface Step {
  readonly before: MatchState;
  readonly after: MatchState;
  readonly action: Action;
  readonly breakdown:
    | Extract<
        ReturnType<typeof applyOrThrow>['events'][number],
        { type: 'WORD_PLACED' }
      >['breakdown']
    | null;
}

/** The player's scripted move through the controls (a word after {@link THINK_MS}, or a Pass). */
async function playerMove(clock: Clock, replica: MatchState): Promise<Step> {
  await waitForPlayerTurn();
  const action = scriptedAction(replica, `ui-ev:${String(replica.actionCount)}`, lexicon);
  let done: Action;
  if (action.type === 'PLACE_WORD') {
    await placeThroughUi(action);
    clock.mono += THINK_MS;
    await fireEvent.press(screen.getByTestId('match.action.play'));
    done = action;
  } else {
    await fireEvent.press(screen.getByTestId('match.action.pass'));
    await fireEvent.press(await screen.findByTestId('match.pass.confirm'));
    done = { seat: HUMAN_SEAT, type: 'PASS' };
  }
  return stepOf(replica, done);
}

function stepOf(before: MatchState, action: Action): Step {
  const applied = applyOrThrow(before, action);
  const placed = applied.events.find((e) => e.type === 'WORD_PLACED');
  return {
    before,
    after: applied.state,
    action,
    breakdown: placed?.type === 'WORD_PLACED' ? placed.breakdown : null,
  };
}

async function botMove(bot: ReturnType<typeof botRunner>, replica: MatchState): Promise<Step> {
  const before = bot.used;
  bot.used += 1;
  await waitFor(() => {
    expect(bot.decisions.length).toBeGreaterThan(before);
  });
  const decision = bot.decisions[before] as BotDecision;
  const step = stepOf(replica, decision.action);
  // Applied and rendered: the move log follows the engine.
  await waitFor(() => {
    expect(screen.getByTestId('match.score.bot').props.children).toBe(
      step.after.seats[BOT_SEAT]?.score,
    );
  });
  return step;
}

/** The catalogue `bot_word_played` of a step, from the engine's breakdown and the lexicon. */
function expectedWord(id: string, step: Step, thinkMs: number): EventProperties<'bot_word_played'> {
  const breakdown = step.breakdown;
  if (breakdown === null) throw new Error('not a word');
  const main = breakdown.words.find((w) => w.main);
  const ref = main === undefined ? undefined : lexicon.index.lookup(main.form);
  if (main === undefined || ref === undefined) throw new Error('no main word');
  const flags: EventProperties<'bot_word_played'>['bonus_flags'] = [];
  if (breakdown.words.some((w) => w.termBonus > 0)) flags.push('term');
  if (breakdown.fullStack > 0) flags.push('full_stack');
  if (breakdown.chain > 0) flags.push('chain');
  return {
    local_match_id: id,
    actor: step.action.seat === HUMAN_SEAT ? 'player' : 'bot',
    term_id: main.termId,
    form_kind: lexicon.index.formMeta(ref).kind,
    category: lexicon.index.meta(lexicon.index.termOf(ref))
      .categories[0] as EventProperties<'bot_word_played'>['category'],
    difficulty: main.difficulty,
    points: breakdown.total,
    bonus_flags: flags,
    think_ms: thinkMs,
    turn: step.before.turnNumber,
  };
}

describe('a full match (bot_match_started, bot_word_played, bot_decision_made, bot_match_finished)', () => {
  it('records each event with exactly the catalogue properties, and the Summary action', async () => {
    const clock = { wall: T0, mono: 0 };
    const analytics = enrolled(new MemoryFs(), clock);
    const bot = botRunner(clock);
    const seed = humanStarts(lexicon, 1401);
    await renderApp({ analytics, seed, runner: bot.runner });
    const startMono = clock.mono;
    await pressPlayNow();
    let replica = newPlayState(seed, lexicon);
    const steps: Step[] = [];
    const decisions: { before: MatchState; decision: BotDecision }[] = [];
    while (replica.status === 'in_progress') {
      if (steps.length > 300) throw new Error('the match did not end');
      let step: Step;
      if (replica.seatOnTurn === BOT_SEAT) {
        const index = bot.used;
        step = await botMove(bot, replica);
        decisions.push({ before: replica, decision: bot.decisions[index] as BotDecision });
      } else {
        step = await playerMove(clock, replica);
      }
      steps.push(step);
      replica = step.after;
    }
    await screen.findByTestId('summary.playAgain');
    const finishMono = clock.mono;

    const [started] = propsOf(analytics, 'bot_match_started');
    expect(started).toEqual({
      local_match_id: expect.stringMatching(UUID),
      mode: 'classic',
      format: 'untimed-vs-bot',
      bot_personality: 'beginner',
      first_player: 'player',
      lexicon_version: lexicon.index.version,
      engine_rules_version: PLAY_RULES_VERSION,
      bot_version: BOT_VERSION,
      is_first_match: true,
    });
    const id = started?.local_match_id ?? '';

    // Every word, the player's (think time on the analytics clock) and the bot's (its compute time).
    expect(propsOf(analytics, 'bot_word_played')).toEqual(
      steps
        .filter((s) => s.breakdown !== null)
        .map((s) => expectedWord(id, s, s.action.seat === HUMAN_SEAT ? THINK_MS : COMPUTE_MS)),
    );
    expect(propsOf(analytics, 'bot_decision_made')).toEqual(
      decisions.map(({ before, decision }) => ({
        local_match_id: id,
        action_index: before.actionCount,
        bot_personality: 'beginner',
        bot_version: BOT_VERSION,
        engine_rules_version: PLAY_RULES_VERSION,
        compute_ms_bucket: '500_1000',
        total_ms_bucket: '500_1000',
        budget_exhausted: decision.budgetExhausted,
        nodes_used_bucket: expect.stringMatching(
          /^(lt_1k|1k_10k|10k_50k|50k_100k|100k_200k|ge_200k)$/,
        ),
        automaton: lexicon.index.gaddag === undefined ? 'dawg' : 'gaddag',
        action_kind:
          decision.action.type === 'PLACE_WORD'
            ? 'place_word'
            : decision.action.type === 'EXCHANGE'
              ? 'exchange'
              : 'pass',
        fallback: decision.action.type !== 'PLACE_WORD',
        recomputed: false,
      })),
    );

    const player = replica.seats[HUMAN_SEAT]?.score ?? 0;
    const botScore = replica.seats[BOT_SEAT]?.score ?? 0;
    const places = replica.result?.places ?? [];
    const end = replica.result?.end.reason;
    const actions = steps.map((s) => s.action);
    let tail = 0;
    if (end === 'scoreless_turns' && replica.bag.length < 7) {
      for (let i = actions.length - 1; i >= 0 && actions[i]?.type === 'PASS'; i -= 1) tail += 1;
    }
    expect(propsOf(analytics, 'bot_match_finished')).toEqual([
      {
        local_match_id: id,
        bot_personality: 'beginner',
        bot_version: BOT_VERSION,
        engine_rules_version: PLAY_RULES_VERSION,
        result:
          places[HUMAN_SEAT] === places[BOT_SEAT]
            ? 'draw'
            : places[HUMAN_SEAT] === 1
              ? 'win'
              : 'loss',
        end_reason: end === 'going_out' ? 'out' : end,
        player_score: player,
        bot_score: botScore,
        score_margin: player - botScore,
        bag_count_at_end: replica.bag.length,
        tiles_on_board_at_end: replica.board.join('').replaceAll('.', '').length,
        forced_pass_tail: tail,
        active_duration_ms: finishMono - startMono,
        turns: replica.turnNumber,
        words_played: actions.filter((a) => a.type === 'PLACE_WORD').length,
        rejected_attempts: 0,
        exchanges: actions.filter((a) => a.type === 'EXCHANGE').length,
        passes: actions.filter((a) => a.type === 'PASS').length,
        resume_count: 0,
      },
    ]);

    // The Summary: 4 s on it, then Play again; the next match is not the first one.
    clock.mono += 4000;
    await fireEvent.press(screen.getByTestId('summary.playAgain'));
    await screen.findByTestId('match.status');
    expect(propsOf(analytics, 'match_summary_action')).toEqual([
      { local_match_id: id, action: 'play_again', ms_on_summary: 4000 },
    ]);
    const second = propsOf(analytics, 'bot_match_started')[1];
    expect(second?.is_first_match).toBe(false);
    expect(second?.local_match_id).not.toBe(id);
    expect(propsOf(analytics, 'bot_match_abandoned')).toEqual([]);
    // The export summary counts the finished match (it reads `bot_match_finished`).
    expect(analytics.exportSummary()?.matches).toBe(1);
  }, 240_000);
});

describe('word_rejected, resign, Home and New match', () => {
  it('records rejections (capped per turn), counts them all, and the resign result', async () => {
    const clock = { wall: T0, mono: 0 };
    const analytics = enrolled(new MemoryFs(), clock);
    const bot = botRunner(clock);
    await renderApp({ analytics, seed: humanStarts(lexicon, 1411), runner: bot.runner });
    await pressPlayNow();
    await waitForPlayerTurn();
    // One tile on the first move: a placement rejection (R-TURN first move needs two tiles).
    const [first] = screen.getAllByLabelText(/^Rack, tile 1 of 7: /);
    if (first === undefined) throw new Error('no rack');
    await fireEvent.press(first);
    await fireEvent.press(screen.getByLabelText(/, row 8 column 8, empty$/));
    const taps = MAX_REJECTED_EVENTS_PER_TURN + 2;
    for (let i = 0; i < taps; i += 1) {
      clock.mono += 100;
      await fireEvent.press(screen.getByTestId('match.action.play'));
    }
    const rejected = propsOf(analytics, 'word_rejected');
    expect(rejected).toHaveLength(MAX_REJECTED_EVENTS_PER_TURN);
    const id = propsOf(analytics, 'bot_match_started')[0]?.local_match_id;
    expect(rejected[0]).toEqual({
      local_match_id: id,
      reason: 'placement',
      word_length: 1,
      think_ms: 100,
      turn: 0,
    });
    expect(rejected.map((r) => r.think_ms)).toEqual(
      Array.from({ length: MAX_REJECTED_EVENTS_PER_TURN }, (_, i) => (i + 1) * 100),
    );
    clock.mono += 500;
    await resignThroughUi();
    await screen.findByTestId('summary.home');
    const [finished] = propsOf(analytics, 'bot_match_finished');
    expect(finished).toMatchObject({
      local_match_id: id,
      result: 'loss',
      end_reason: 'resign',
      forced_pass_tail: 0,
      rejected_attempts: taps,
      turns: 0,
      words_played: 0,
      active_duration_ms: taps * 100 + 500,
    });
    await fireEvent.press(screen.getByTestId('summary.home'));
    await screen.findByTestId('home.playNow');
    expect(propsOf(analytics, 'match_summary_action')).toEqual([
      { local_match_id: id, action: 'home', ms_on_summary: 0 },
    ]);
  }, 120_000);

  it('reports a word the lexicon refuses as not_in_lexicon with its length', async () => {
    const clock = { wall: T0, mono: 0 };
    const analytics = enrolled(new MemoryFs(), clock);
    const seed = humanStarts(lexicon, 1412);
    await renderApp({ analytics, seed, runner: botRunner(clock).runner });
    await pressPlayNow();
    await waitForPlayerTurn();
    // Two rack letters across the start square that form no playable form.
    const rack = newPlayState(seed, lexicon).seats[HUMAN_SEAT]?.rack ?? '';
    const letters = Array.from({ length: rack.length }, (_, i) => rack.charAt(i)).filter(
      (c) => c !== '?',
    );
    let pair: [string, string] | null = null;
    for (const [i, a] of letters.entries()) {
      for (const [j, b] of letters.entries()) {
        if (i !== j && pair === null && !lexicon.index.has(a + b)) pair = [a, b];
      }
    }
    if (pair === null) throw new Error('no unplayable pair');
    for (const [k, letter] of pair.entries()) {
      const [tile] = screen.getAllByLabelText(
        new RegExp(`^Rack, tile \\d+ of \\d+: Letter ${letter}, `),
      );
      if (tile === undefined) throw new Error('no tile');
      await fireEvent.press(tile);
      await fireEvent.press(
        screen.getByLabelText(new RegExp(`, row 8 column ${String(8 + k)}, empty$`)),
      );
    }
    clock.mono += 2500;
    await fireEvent.press(screen.getByTestId('match.action.play'));
    expect(propsOf(analytics, 'word_rejected')).toEqual([
      {
        local_match_id: propsOf(analytics, 'bot_match_started')[0]?.local_match_id,
        reason: 'not_in_lexicon',
        word_length: 2,
        think_ms: 2500,
        turn: 0,
      },
    ]);
  }, 120_000);

  it('abandons the saved match on New match (replaced_by_new), once', async () => {
    const clock = { wall: T0, mono: 0 };
    const disk = new MemoryFs();
    const fs = new MemoryFs();
    const seed = humanStarts(lexicon, 1421);
    const process1 = enrolled(fs, clock);
    const bot = botRunner(clock);
    const first = await renderApp({ analytics: process1, seed, runner: bot.runner, disk });
    await pressPlayNow();
    let replica = newPlayState(seed, lexicon);
    replica = (await playerMove(clock, replica)).after;
    replica = (await botMove(bot, replica)).after;
    await waitForPlayerTurn();
    await moveAppTo('background');
    const id = propsOf(process1, 'bot_match_started')[0]?.local_match_id;
    await first.unmount();

    const process2 = recorder(fs.reboot(), clock);
    await renderApp({
      analytics: process2,
      seed,
      runner: botRunner(clock).runner,
      disk: disk.reboot(),
    });
    await screen.findByTestId('home.resume');
    await fireEvent.press(await screen.findByTestId('home.newMatch'));
    await fireEvent.press(await screen.findByTestId('home.newMatch.confirm'));
    await screen.findByTestId('match.status');
    expect(propsOf(process2, 'bot_match_abandoned')).toEqual([
      {
        local_match_id: id,
        reason: 'replaced_by_new',
        turns: replica.turnNumber,
        active_duration_ms: THINK_MS + COMPUTE_MS,
      },
    ]);
    const [started] = propsOf(process2, 'bot_match_started');
    expect(started?.is_first_match).toBe(false);
    expect(started?.local_match_id).not.toBe(id);
  }, 120_000);
});

describe('bot_match_resumed', () => {
  it('reports a background return (in_memory) and leaves the background time out of the active time', async () => {
    const clock = { wall: T0, mono: 0 };
    const analytics = enrolled(new MemoryFs(), clock);
    await renderApp({
      analytics,
      seed: humanStarts(lexicon, 1431),
      runner: botRunner(clock).runner,
    });
    await pressPlayNow();
    await waitForPlayerTurn();
    clock.mono += 3000;
    await moveAppTo('background');
    clock.mono += 60_000;
    clock.wall += 60_000;
    await moveAppTo('active');
    clock.mono += 2000;
    // A second trip to the background in the same match.
    await moveAppTo('background');
    clock.mono += 30_000;
    clock.wall += 30_000;
    await moveAppTo('active');
    clock.mono += 1000;
    await resignThroughUi();
    await screen.findByTestId('summary.home');
    const id = propsOf(analytics, 'bot_match_started')[0]?.local_match_id;
    expect(propsOf(analytics, 'bot_match_resumed')).toEqual([
      {
        local_match_id: id,
        resume_source: 'background',
        away_ms: 60_000,
        restore_ms: 0,
        restore_path: 'in_memory',
      },
      {
        local_match_id: id,
        resume_source: 'background',
        away_ms: 30_000,
        restore_ms: 0,
        restore_path: 'in_memory',
      },
    ]);
    expect(propsOf(analytics, 'bot_match_finished')[0]).toMatchObject({
      local_match_id: id,
      active_duration_ms: 6000,
      resume_count: 2,
    });

    // The Summary is mounted again (a second /match on the stack): its time counts from the first time it was shown.
    clock.mono += 1000;
    await act(async () => {
      router.push('/match');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('summary.home').length).toBeGreaterThan(0);
    });
    clock.mono += 3000;
    const home = screen.getAllByTestId('summary.home').at(-1);
    if (home === undefined) throw new Error('no Summary');
    await fireEvent.press(home);
    await screen.findByTestId('home.playNow');
    expect(propsOf(analytics, 'match_summary_action')).toEqual([
      { local_match_id: id, action: 'home', ms_on_summary: 4000 },
    ]);
  }, 120_000);

  it('after a crash, counts the cold-start away time from the last background or start (an upper bound)', async () => {
    const clock = { wall: T0, mono: 0 };
    const disk = new MemoryFs();
    const fs = new MemoryFs();
    const seed = humanStarts(lexicon, 1521);
    const process1 = enrolled(fs, clock);
    const bot = botRunner(clock);
    const first = await renderApp({ analytics: process1, seed, runner: bot.runner, disk });
    await pressPlayNow();
    clock.wall += 5 * 60_000;
    let replica = (await playerMove(clock, newPlayState(seed, lexicon))).after;
    replica = (await botMove(bot, replica)).after;
    await waitForPlayerTurn();
    clock.wall += 60_000;
    // A rejected PLAY (one tile away from every word) writes the record; only a background moves its time.
    const [tile] = screen.getAllByLabelText(/^Rack, tile 1 of \d+: /);
    if (tile === undefined) throw new Error('no rack');
    await fireEvent.press(tile);
    await fireEvent.press(screen.getByLabelText(/, row 1 column 1, empty$/));
    await fireEvent.press(screen.getByTestId('match.action.play'));
    expect(propsOf(process1, 'word_rejected')).toHaveLength(1);
    const id = propsOf(process1, 'bot_match_started')[0]?.local_match_id;
    // The process crashes (no background); the player opens the app 10 minutes later.
    await first.unmount();
    clock.wall += 10 * 60_000;
    clock.mono = 0;
    const process2 = recorder(fs.reboot(), clock);
    await renderApp({
      analytics: process2,
      seed,
      runner: botRunner(clock).runner,
      disk: disk.reboot(),
    });
    await screen.findByTestId('home.resume');
    // Away since the start (no background before the crash): the 6 minutes played count as away.
    expect(propsOf(process2, 'bot_match_resumed')).toEqual([
      expect.objectContaining({
        local_match_id: id,
        resume_source: 'cold_start',
        away_ms: 16 * 60_000,
      }),
    ]);
    // The record holds the start time, not a time per move.
    expect(new TextDecoder().decode(fs.files.get(PLAY_FILE))).toContain(`"lastWall":${String(T0)}`);
    expect(replica.turnNumber).toBe(2);
  }, 120_000);

  it('reports a cold start: same id, away time, restore path, recomputed bot decision', async () => {
    const clock = { wall: T0, mono: 0 };
    const disk = new MemoryFs();
    const fs = new MemoryFs();
    const seed = humanStarts(lexicon, 1441);
    const process1 = enrolled(fs, clock);
    const held = botRunner(clock, true);
    const first = await renderApp({ analytics: process1, seed, runner: held.runner, disk });
    await pressPlayNow();
    const replica = (await playerMove(clock, newPlayState(seed, lexicon))).after;
    await waitFor(() => {
      expect(held.pending()).toBe(1);
    });
    clock.wall += 1000;
    await moveAppTo('background');
    const id = propsOf(process1, 'bot_match_started')[0]?.local_match_id;
    await first.unmount();

    // The OS killed the process in the background; 10 minutes later the player opens the app.
    clock.wall += 10 * 60_000;
    clock.mono = 0;
    const fs2 = fs.reboot();
    const process2 = recorder(fs2, clock);
    const bot = botRunner(clock);
    await renderApp({ analytics: process2, seed, runner: bot.runner, disk: disk.reboot() });
    await screen.findByTestId('home.resume');
    const [resumed] = propsOf(process2, 'bot_match_resumed');
    expect(resumed).toEqual({
      local_match_id: id,
      resume_source: 'cold_start',
      away_ms: 10 * 60_000,
      restore_ms: 0,
      restore_path: expect.stringMatching(/^(snapshot|full_replay)$/),
    });
    await pressPlayNow();
    await botMove(bot, replica);
    const [decision] = propsOf(process2, 'bot_decision_made');
    expect(decision).toMatchObject({ local_match_id: id, recomputed: true, action_index: 1 });
    await waitForPlayerTurn();
    await resignThroughUi();
    await screen.findByTestId('summary.home');
    expect(propsOf(process2, 'bot_match_finished')[0]).toMatchObject({
      local_match_id: id,
      resume_count: 1,
      rejected_attempts: 0,
    });
    // No second start for the resumed match.
    expect(propsOf(process2, 'bot_match_started')).toEqual([]);
  }, 120_000);

  it('reports a failed cold-start restore once (state_corrupt), then Start a new match adds no abandon', async () => {
    const clock = { wall: T0, mono: 0 };
    const disk = new MemoryFs();
    const fs = new MemoryFs();
    const seed = humanStarts(lexicon, 1451);
    const process1 = enrolled(fs, clock);
    const held = botRunner(clock, true);
    const first = await renderApp({ analytics: process1, seed, runner: held.runner, disk });
    await pressPlayNow();
    await playerMove(clock, newPlayState(seed, lexicon));
    await waitFor(() => {
      expect(held.pending()).toBe(1);
    });
    await moveAppTo('background');
    const id = propsOf(process1, 'bot_match_started')[0]?.local_match_id;
    await first.unmount();

    const corrupt = disk.reboot();
    const log = corrupt.files.get(FILES.log);
    if (log === undefined) throw new Error('no log');
    log[10] = log[10] === 0x41 ? 0x42 : 0x41;
    clock.wall += 5000;
    const fs2 = fs.reboot();
    const process2 = recorder(fs2, clock);
    const second = await renderApp({
      analytics: process2,
      seed,
      runner: botRunner(clock).runner,
      disk: corrupt,
    });
    await screen.findByTestId('home.cannotResume');
    expect(gameplay(process2).map((e) => [e.event, e.properties])).toEqual([
      [
        'bot_match_resumed',
        {
          local_match_id: id,
          resume_source: 'cold_start',
          away_ms: 5000,
          restore_ms: 0,
          restore_path: 'failed',
        },
      ],
      [
        'bot_match_abandoned',
        { local_match_id: id, reason: 'state_corrupt', turns: 1, active_duration_ms: THINK_MS },
      ],
    ]);
    await second.unmount();

    // The card comes back at the next launch: nothing is reported twice for the same match.
    const process3 = recorder(fs2.reboot(), clock);
    await renderApp({
      analytics: process3,
      seed: humanStarts(lexicon, 1452),
      runner: botRunner(clock).runner,
      disk: corrupt.reboot(),
    });
    await screen.findByTestId('home.cannotResume');
    expect(gameplay(process3)).toEqual([]);
    await fireEvent.press(screen.getByTestId('home.startNew'));
    await screen.findByTestId('match.status');
    expect(gameplay(process3).map((e) => e.event)).toEqual(['bot_match_started']);
  }, 180_000);

  it('reports a match finished just before a kill at the next cold start, once', async () => {
    const clock = { wall: T0, mono: 0 };
    const disk = new MemoryFs();
    const fs = new MemoryFs();
    const seed = humanStarts(lexicon, 1511);
    const process1 = enrolled(fs, clock);
    const first = await renderApp({
      analytics: process1,
      seed,
      runner: botRunner(clock).runner,
      disk,
    });
    await pressPlayNow();
    await waitForPlayerTurn();
    const id = propsOf(process1, 'bot_match_started')[0]?.local_match_id;
    // The analytics files as the kill leaves them: the final move was saved, its analytics never ran.
    const atKill = fs.reboot();
    await resignThroughUi();
    await screen.findByTestId('summary.home');
    await first.unmount();

    const process2 = recorder(atKill, clock);
    const disk2 = disk.reboot();
    const second = await renderApp({
      analytics: process2,
      seed,
      runner: botRunner(clock).runner,
      disk: disk2,
    });
    await waitFor(() => {
      expect(propsOf(process2, 'bot_match_finished')).toHaveLength(1);
    });
    expect(gameplay(process2).map((e) => e.event)).toEqual(['bot_match_finished']);
    expect(propsOf(process2, 'bot_match_finished')[0]).toMatchObject({
      local_match_id: id,
      result: 'loss',
      end_reason: 'resign',
      turns: 0,
      resume_count: 0,
    });
    // The match record is gone with the match.
    expect(atKill.files.has(PLAY_FILE)).toBe(false);
    await second.unmount();

    const process3 = recorder(atKill.reboot(), clock);
    await renderApp({
      analytics: process3,
      seed,
      runner: botRunner(clock).runner,
      disk: disk2.reboot(),
    });
    await screen.findByTestId('home.playNow');
    expect(gameplay(process3)).toEqual([]);
  }, 120_000);

  it('reports a version mismatch with a new id when no record exists', async () => {
    const clock = { wall: T0, mono: 0 };
    const seed = humanStarts(lexicon, 1461);
    const disk = new MemoryFs();
    const config = { ...playMatchConfig(seed, lexicon.index), engineRulesVersion: 99 };
    new DataStore(disk).append(FILES.log, [JSON.stringify({ logVersion: 1, header: config })]);
    const analytics = enrolled(new MemoryFs(), clock);
    await renderApp({ analytics, seed, runner: botRunner(clock).runner, disk });
    await screen.findByTestId('home.cannotResume');
    const events = gameplay(analytics);
    expect(events.map((e) => e.event)).toEqual(['bot_match_resumed', 'bot_match_abandoned']);
    expect(events[1]?.properties).toEqual({
      local_match_id: expect.stringMatching(UUID),
      reason: 'version_mismatch',
      turns: 0,
      active_duration_ms: 0,
    });
    expect(events[0]?.properties).toMatchObject({ restore_path: 'failed', away_ms: 0 });
  }, 120_000);
});

describe('onboarding_step_completed', () => {
  it('records the first-time steps once per install, with the time since the previous step', async () => {
    const clock = { wall: T0, mono: 0 };
    const fs = new MemoryFs();
    const analytics = recorder(fs, clock);
    const bot = botRunner(clock);
    const seed = humanStarts(lexicon, 1471);
    await renderApp({ analytics, seed, runner: bot.runner });
    clock.mono += 7000;
    await pressPlayNow();
    await playerMove(clock, newPlayState(seed, lexicon));
    clock.mono += 500;
    await resignThroughUi();
    await screen.findByTestId('summary.playAgain');
    await fireEvent.press(screen.getByTestId('summary.playAgain'));
    await screen.findByTestId('match.status');
    expect(propsOf(analytics, 'onboarding_step_completed')).toEqual([
      { step: 'first_launch', duration_ms: 0 },
      { step: 'home_seen', duration_ms: 0 },
      { step: 'play_now_tapped', duration_ms: 7000 },
      { step: 'first_move', duration_ms: THINK_MS },
      { step: 'first_match_completed', duration_ms: COMPUTE_MS + 500 },
    ]);
    // Hand-written from the lexicon: MAPS, plural of "map" (programming), with the term bonus.
    expect(propsOf(analytics, 'bot_word_played')[0]).toEqual({
      local_match_id: propsOf(analytics, 'bot_match_started')[0]?.local_match_id,
      actor: 'player',
      term_id: 'map',
      form_kind: 'plural',
      category: 'programming',
      difficulty: 'intermediate',
      points: 18,
      bonus_flags: ['term'],
      think_ms: THINK_MS,
      turn: 0,
    });
    // The first event of the install is first_launch.
    expect(queued(analytics)[0]?.event).toBe('onboarding_step_completed');
    expect(fs.files.has(ONBOARDING_FILE)).toBe(true);
  }, 120_000);

  it('records first_move on the player first applied action, not on the bot opening move', async () => {
    const clock = { wall: T0, mono: 0 };
    const analytics = recorder(new MemoryFs(), clock);
    const bot = botRunner(clock);
    const seed = seedWhereFirst(BOT_SEAT, lexicon, 1601);
    await renderApp({ analytics, seed, runner: bot.runner });
    await pressPlayNow();
    expect(propsOf(analytics, 'bot_match_started')[0]?.first_player).toBe('bot');
    let replica = newPlayState(seed, lexicon);
    replica = (await botMove(bot, replica)).after;
    await waitForPlayerTurn();
    const steps = () => propsOf(analytics, 'onboarding_step_completed').map((p) => p.step);
    expect(steps()).toEqual(['first_launch', 'home_seen', 'play_now_tapped']);
    await playerMove(clock, replica);
    expect(steps()).toEqual(['first_launch', 'home_seen', 'play_now_tapped', 'first_move']);
  }, 120_000);

  it('has no first-time flow on an install that enrolled before', async () => {
    const clock = { wall: T0, mono: 0 };
    const analytics = enrolled(new MemoryFs(), clock);
    await renderApp({
      analytics,
      seed: humanStarts(lexicon, 1472),
      runner: botRunner(clock).runner,
    });
    await pressPlayNow();
    await resignThroughUi();
    await screen.findByTestId('summary.home');
    expect(propsOf(analytics, 'onboarding_step_completed')).toEqual([]);
  }, 120_000);
});

describe('nothing without recording', () => {
  async function playAndResign(analytics: PlaytestAnalytics, enabled: boolean, clock: Clock) {
    const bot = botRunner(clock);
    const seed = humanStarts(lexicon, 1481);
    await renderApp({ analytics, seed, runner: bot.runner, enabled });
    await pressPlayNow();
    await playerMove(clock, newPlayState(seed, lexicon));
    await moveAppTo('background');
    await moveAppTo('active');
    await resignThroughUi();
    await fireEvent.press(await screen.findByTestId('summary.playAgain'));
    await screen.findByTestId('match.status');
  }

  it('records and writes nothing with analytics.upload.enabled off', async () => {
    const clock = { wall: T0, mono: 0 };
    const fs = new MemoryFs();
    const analytics = recorder(fs, clock, false);
    await playAndResign(analytics, false, clock);
    expect(queued(analytics)).toEqual([]);
    expect([...fs.files.keys()]).toEqual([]);
  }, 120_000);

  it('records and writes nothing with consent off', async () => {
    const clock = { wall: T0, mono: 0 };
    const fs = new MemoryFs();
    const analytics = enrolled(fs, clock);
    analytics.start();
    expect(analytics.setConsent(false)).toBe(true);
    await playAndResign(analytics, true, clock);
    await act(async () => {
      expect(analytics.setConsent(true)).toBe(true);
      await Promise.resolve();
    });
    expect(gameplay(analytics)).toEqual([]);
    expect(fs.files.has(PLAY_FILE)).toBe(false);
    expect(fs.files.has(ONBOARDING_FILE)).toBe(false);
  }, 120_000);
});

describe('consent withdrawn and given again mid-match', () => {
  it('carries nothing of the withdrawn pseudonym into the new one', async () => {
    const clock = { wall: T0, mono: 0 };
    const fs = new MemoryFs();
    const analytics = enrolled(fs, clock);
    const bot = botRunner(clock);
    const seed = humanStarts(lexicon, 1501);
    await renderApp({ analytics, seed, runner: bot.runner });
    await pressPlayNow();
    let replica = newPlayState(seed, lexicon);
    replica = (await playerMove(clock, replica)).after;
    replica = (await botMove(bot, replica)).after;
    await waitForPlayerTurn();
    await moveAppTo('background');
    await moveAppTo('active');
    clock.mono += 3000;
    const old = propsOf(analytics, 'bot_match_started')[0]?.local_match_id ?? 'none';
    // Off then on with no move in between (Settings, same process).
    await act(async () => {
      expect(analytics.setConsent(false)).toBe(true);
      expect(analytics.setConsent(true)).toBe(true);
      await Promise.resolve();
    });
    clock.mono += 500;
    await resignThroughUi();
    await fireEvent.press(await screen.findByTestId('summary.playAgain'));
    await screen.findByTestId('match.status');

    const events = allQueued(analytics);
    expect(JSON.stringify(events)).not.toContain(old);
    const of = <N extends EventName>(name: N) =>
      events.filter((e) => e.event === name).map((e) => e.properties as EventProperties<N>);
    const [finished, ...more] = of('bot_match_finished');
    expect(more).toEqual([]);
    expect(finished).toMatchObject({
      local_match_id: expect.stringMatching(UUID),
      end_reason: 'resign',
      turns: replica.turnNumber,
      rejected_attempts: 0,
      resume_count: 0,
      active_duration_ms: 500,
    });
    const id = finished?.local_match_id;
    expect(of('match_summary_action')).toEqual([
      { local_match_id: id, action: 'play_again', ms_on_summary: 0 },
    ]);
    // The next match is the first one recorded under the new install id (no match history without persistence).
    const [started] = of('bot_match_started');
    expect(started?.is_first_match).toBe(true);
    expect([old, id]).not.toContain(started?.local_match_id);
    const record = new TextDecoder().decode(fs.files.get(PLAY_FILE));
    expect(record).toContain(started?.local_match_id);
    expect(record).not.toContain(old);
  }, 120_000);
});

describe('bot timing (bot_decision_made buckets)', () => {
  it('times the search from its start: the frame wait and the player move telemetry are not compute', async () => {
    const clock = { wall: T0, mono: 0 };
    // Every analytics write costs 400 ms on the clock: the player's move telemetry runs after the bot request.
    const fs = new MemoryFs();
    const write = fs.write.bind(fs);
    const append = fs.append.bind(fs);
    fs.write = (name, bytes) => {
      clock.mono += 400;
      write(name, bytes);
    };
    fs.append = (name, bytes) => {
      clock.mono += 400;
      append(name, bytes);
    };
    const analytics = enrolled(fs, clock);
    const bot = botRunner(clock, false, 500);
    const seed = humanStarts(lexicon, 1471);
    await renderApp({ analytics, seed, runner: bot.runner });
    await pressPlayNow();
    const replica = (await playerMove(clock, newPlayState(seed, lexicon))).after;
    await botMove(bot, replica);
    const [decision] = propsOf(analytics, 'bot_decision_made');
    expect(decision?.compute_ms_bucket).toBe('500_1000');
    // The wait the player sees includes all of it.
    expect(['lt_250', '250_500', '500_1000']).not.toContain(decision?.total_ms_bucket);
  }, 120_000);

  it('includes the think delay in total_ms, not in compute_ms', async () => {
    const THINK_DELAY_MS = 1600;
    // This test's clock follows real time (the think delay is a real timer); the search itself adds nothing.
    const origin = Date.now();
    const clock = {
      wall: T0,
      offset: 0,
      get mono(): number {
        return this.offset + (Date.now() - origin);
      },
      set mono(value: number) {
        this.offset = value - (Date.now() - origin);
      },
    };
    const decisions: BotDecision[] = [];
    const inner = createJsThreadBotRunner(lexicon.index, { nextFrame: () => Promise.resolve() });
    const runner: BotRunner = {
      async decide(request, onStart) {
        const result = await inner.decide(request, onStart);
        if (result.ok) decisions.push(result.value);
        return result;
      },
    };
    const analytics = enrolled(new MemoryFs(), clock);
    const seed = humanStarts(lexicon, 1471);
    await renderApp({ analytics, seed, runner, thinkDelayMs: THINK_DELAY_MS });
    await pressPlayNow();
    await playerMove(clock, newPlayState(seed, lexicon));
    await waitFor(
      () => {
        expect(propsOf(analytics, 'bot_decision_made')).toHaveLength(1);
      },
      { timeout: 10_000 },
    );
    const [decision] = propsOf(analytics, 'bot_decision_made');
    // The search is far shorter than the delay; the player waited for the delay (bucket 1500-2000 ms).
    expect(['lt_250', '250_500', '500_1000']).toContain(decision?.compute_ms_bucket);
    expect(decision?.total_ms_bucket).toBe('1500_2000');
    expect(decisions).toHaveLength(1);
  }, 120_000);
});

describe('the exported file (S6c prompt, D1 decoder, KR readout)', () => {
  it('makes the end-of-session prompt due, decodes with D1, and gives the readout its match numbers', async () => {
    const clock = { wall: T0, mono: 0 };
    const analytics = enrolled(new MemoryFs(), clock);
    await renderApp({
      analytics,
      seed: humanStarts(lexicon, 1491),
      runner: botRunner(clock).runner,
    });
    await moveAppTo('active');
    await act(async () => {
      analytics.markInteractive();
      await Promise.resolve();
    });
    for (let i = 0; i < 2; i += 1) {
      await pressPlayNow();
      clock.mono += 60_000;
      clock.wall += 60_000;
      await resignThroughUi();
      await fireEvent.press(await screen.findByTestId('summary.home'));
      await screen.findByTestId('home.playNow');
    }
    // D-17: two completed matches this session; Home showed the card (once per session).
    expect(await screen.findByTestId('home.exportPrompt')).toBeTruthy();
    expect(analytics.sessionMatches()).toBe(2);
    expect(analytics.exportPromptDue()).toBe(false);
    expect(analytics.exportSummary()?.matches).toBe(2);
    // The session ends (31 min in the background), a new one starts.
    await moveAppTo('background');
    clock.mono += 31 * 60_000;
    clock.wall += 31 * 60_000;
    await moveAppTo('active');

    const prepared = analytics.prepareExport('1');
    if (!prepared.ok) throw new Error(prepared.reason);
    const decoded = decodePlaytestExport(prepared.file.text);
    expect(decoded.ok).toBe(true);
    const names = decoded.ok ? decoded.value.events.map((e) => e.event) : [];
    expect(names.slice(0, 1)).toEqual(['app_opened']);
    expect(names.filter((n) => n === 'bot_match_finished')).toHaveLength(2);
    expect(names.filter((n) => n === 'bot_match_started')).toHaveLength(2);
    expect(names.filter((n) => n === 'match_summary_action')).toHaveLength(2);

    // The KR readout, run as the data analyst runs it (Node, the D1 decoder, no copy of the schemas).
    const dir = mkdtempSync(join(tmpdir(), 'codelex-ev-'));
    try {
      const file = join(dir, 'export.json');
      const out = join(dir, 'readout.json');
      writeFileSync(file, prepared.file.text);
      const cli = resolve(__dirname, '../../../../../tools/readout/cli.mjs');
      execFileSync(process.execPath, [cli, '--json', out, file], { stdio: 'pipe' });
      const readout = JSON.parse(readFileSync(out, 'utf8')) as {
        population: { installs: number; activeTesters: number };
        medianSession: { sessions: { n: number; median: number | null } };
      };
      expect(readout.population).toMatchObject({ installs: 1, activeTesters: 1 });
      expect(readout.medianSession.sessions.n).toBe(1);
      expect(readout.medianSession.sessions.median).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
