import { chooseAction, PERSONALITIES } from '@codelex/bots';
import {
  apply,
  deriveRng,
  observe,
  type Action,
  type EngineContext,
  type MatchResult,
  type MatchState,
  type PlaceWordAction,
  type Rejection,
} from '@codelex/game-engine';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import type { LoadedLexicon } from '../lexicon/load-lexicon';
import {
  arrangeRack,
  endReason,
  matchOutcome,
  reduceMatch,
  rejectionNotice,
  startModel,
  visibleRack,
  type MatchCommand,
  type MatchModel,
} from './match-model';
import { BOT_SEAT, HUMAN_SEAT, PLAY_BOT } from './play-config';
import { humanStarts, loadBundledLexicon, newPlayState, seedWhereFirst } from './test-support';

jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));

let lexicon: LoadedLexicon;
let ctx: EngineContext;
beforeAll(async () => {
  lexicon = await loadBundledLexicon();
  ctx = { lexicon: lexicon.index };
});

const run = (model: MatchModel, ...commands: MatchCommand[]): MatchModel =>
  commands.reduce((m, c) => reduceMatch(m, c, ctx), model);

/** The Beginner's choice for the seat on turn, from a test-only stream (never the bot's own). */
function scriptedAction(state: MatchState, stream: string): Action {
  const decided = chooseAction(observe(state, state.seatOnTurn), {
    lexicon: lexicon.index,
    rng: deriveRng(state.seed, stream),
    personality: PLAY_BOT,
    budget: PERSONALITIES[PLAY_BOT].budget,
  });
  if (!decided.ok) throw new Error(decided.error.message);
  return decided.value.action;
}

/** Commands that place `action`'s tiles through the rack, as a player would (tap tile, tap square, blank letter). */
function placeCommands(model: MatchModel, action: PlaceWordAction): MatchCommand[] {
  const used = new Set<number>();
  const commands: MatchCommand[] = [];
  for (const tile of action.tiles) {
    const isBlank = tile.tile === tile.tile.toLowerCase();
    const slot = model.slots.find((s) => !used.has(s.id) && s.tile === (isBlank ? '?' : tile.tile));
    if (slot === undefined) throw new Error(`no rack tile for ${tile.tile}`);
    used.add(slot.id);
    commands.push({ type: 'select', slotId: slot.id });
    commands.push({ type: 'press_square', row: tile.row, col: tile.col });
    if (isBlank) {
      commands.push({ type: 'choose_blank', letter: tile.tile.toUpperCase() as 'A' });
    }
  }
  return commands;
}

function firstWord(state: MatchState): PlaceWordAction {
  for (let n = 0; n < 50; n += 1) {
    const action = scriptedAction(state, `test:${String(n)}`);
    if (action.type === 'PLACE_WORD') return action;
  }
  throw new Error('no word found');
}

describe('rack arrangement', () => {
  it('keeps the player order of surviving tiles and appends new tiles with fresh ids', () => {
    const slots = [
      { id: 1, tile: 'Z' as const },
      { id: 2, tile: 'A' as const },
      { id: 3, tile: '?' as const },
    ];
    expect(arrangeRack(slots, 'ABZ', 10)).toEqual({
      slots: [
        { id: 1, tile: 'Z' },
        { id: 2, tile: 'A' },
        { id: 10, tile: 'B' },
      ],
      nextSlotId: 11,
    });
    expect(arrangeRack([], '?AA', 1).slots.map((s) => s.tile)).toEqual(['?', 'A', 'A']);
  });
});

describe('match model', () => {
  it('starts from the engine state with the player rack as slots and nothing pending', () => {
    const state = newPlayState(humanStarts(lexicon), lexicon);
    const model = startModel(state);
    expect(model.slots.map((s) => s.tile).join('')).toBe(state.seats[HUMAN_SEAT]?.rack);
    expect(model.pending).toEqual([]);
    expect(model.failure).toBeNull();
  });

  it('places a selected tile on an empty square and returns it to the rack when tapped again', () => {
    const model = startModel(newPlayState(humanStarts(lexicon), lexicon));
    const slot = model.slots.find((s) => s.tile !== '?');
    if (slot === undefined) throw new Error('rack of blanks');
    const placed = run(
      model,
      { type: 'select', slotId: slot.id },
      { type: 'press_square', row: 7, col: 7 },
    );
    expect(placed.pending).toEqual([{ slotId: slot.id, row: 7, col: 7, tile: slot.tile }]);
    expect(placed.selectedSlotId).toBeNull();
    expect(visibleRack(placed).some((s) => s.id === slot.id)).toBe(false);
    const back = run(placed, { type: 'press_square', row: 7, col: 7 });
    expect(back.pending).toEqual([]);
    expect(visibleRack(back).some((s) => s.id === slot.id)).toBe(true);
    // A square press without a selected tile does nothing.
    expect(run(back, { type: 'press_square', row: 0, col: 0 })).toBe(back);
  });

  it('toggles the selection and ignores selecting a pending tile', () => {
    const model = startModel(newPlayState(humanStarts(lexicon), lexicon));
    const [a] = model.slots;
    if (a === undefined) throw new Error('empty rack');
    expect(run(model, { type: 'select', slotId: a.id }).selectedSlotId).toBe(a.id);
    expect(run(model, { type: 'select', slotId: a.id }, { type: 'select', slotId: a.id })).toEqual(
      expect.objectContaining({ selectedSlotId: null }),
    );
    if (a.tile === '?') return;
    const placed = run(
      model,
      { type: 'select', slotId: a.id },
      { type: 'press_square', row: 7, col: 7 },
    );
    expect(run(placed, { type: 'select', slotId: a.id })).toBe(placed);
  });

  it('asks for a letter when the blank is placed, and puts it back on cancel', () => {
    const state = newPlayState(humanStarts(lexicon), lexicon);
    const withBlank: MatchState = {
      ...state,
      seats: state.seats.map((s, i) => (i === HUMAN_SEAT ? { ...s, rack: '?ABCDEF' } : s)),
    };
    const model = startModel(withBlank);
    const blank = model.slots.find((s) => s.tile === '?');
    if (blank === undefined) throw new Error('no blank');
    const asked = run(
      model,
      { type: 'select', slotId: blank.id },
      { type: 'press_square', row: 7, col: 7 },
    );
    expect(asked.blankRequest).toEqual({ slotId: blank.id, row: 7, col: 7 });
    expect(asked.pending).toEqual([]);
    expect(run(asked, { type: 'press_square', row: 7, col: 8 })).toBe(asked);
    const chosen = run(asked, { type: 'choose_blank', letter: 'K' });
    expect(chosen.pending).toEqual([{ slotId: blank.id, row: 7, col: 7, tile: 'k' }]);
    expect(chosen.blankRequest).toBeNull();
    const cancelled = run(asked, { type: 'cancel_blank' });
    expect(cancelled.blankRequest).toBeNull();
    expect(cancelled.pending).toEqual([]);
    expect(run(model, { type: 'choose_blank', letter: 'K' })).toBe(model);
  });

  it('rejects an illegal placement without changing the engine state or the pending tiles (AC-6)', () => {
    const state = newPlayState(humanStarts(lexicon), lexicon);
    const model = startModel(state);
    const slot = model.slots.find((s) => s.tile !== '?');
    if (slot === undefined) throw new Error('rack of blanks');
    const pendingOne = run(
      model,
      { type: 'select', slotId: slot.id },
      { type: 'press_square', row: 0, col: 0 },
    );
    const rejected = run(pendingOne, { type: 'play' });
    expect(rejected.state).toBe(state);
    expect(rejected.pending).toEqual(pendingOne.pending);
    expect(rejected.rejection?.key).toBe('match.reject.must_cover_start');
    // Any placement change clears the reason.
    expect(run(rejected, { type: 'press_square', row: 0, col: 0 }).rejection).toBeNull();
  });

  it('applies a legal word through the engine, shows the engine score and refills the rack (AC-4)', () => {
    const state = newPlayState(humanStarts(lexicon), lexicon);
    const model = startModel(state);
    const action = firstWord(state);
    const expected = apply(state, action, ctx);
    if (!expected.ok) throw new Error('engine refused the scripted word');
    const played = run(model, ...placeCommands(model, action), { type: 'play' });
    expect(played.rejection).toBeNull();
    expect(played.state).toEqual(expected.value.state);
    expect(played.pending).toEqual([]);
    expect(
      played.slots
        .map((s) => s.tile)
        .sort()
        .join(''),
    ).toBe(expected.value.state.seats[HUMAN_SEAT]?.rack);
    const placed = expected.value.events.find((e) => e.type === 'WORD_PLACED');
    expect(played.lastMove).toEqual({
      kind: 'word',
      seat: HUMAN_SEAT,
      points: placed?.type === 'WORD_PLACED' ? placed.breakdown.total : -1,
      squares: action.tiles.map(({ row, col }) => ({ row, col })),
    });
    for (const { row, col } of action.tiles) {
      expect(played.owners[`${String(row)},${String(col)}`]).toBe(HUMAN_SEAT);
    }
    // PLAY is a no-op out of turn.
    expect(run(played, { type: 'play' })).toBe(played);
  });

  it('passes (AC-7) and records it as the last move; nothing happens out of turn', () => {
    const state = newPlayState(humanStarts(lexicon), lexicon);
    const passed = run(startModel(state), { type: 'pass' });
    expect(passed.state.scorelessTurns).toBe(1);
    expect(passed.state.seatOnTurn).toBe(BOT_SEAT);
    expect(passed.lastMove).toEqual({ kind: 'pass', seat: HUMAN_SEAT });
    expect(run(passed, { type: 'pass' })).toBe(passed);
    expect(run(passed, { type: 'recall' }).pending).toEqual([]);
  });

  it('applies the bot decision for the current action count only (stale results are dropped)', () => {
    const state = newPlayState(seedWhereFirst(BOT_SEAT, lexicon), lexicon);
    const model = startModel(state);
    const action = scriptedAction(state, `bot:${String(BOT_SEAT)}:0`);
    const decision = {
      action,
      nodesUsed: 1,
      candidatesEvaluated: 1,
      candidatesRefused: 0,
      budgetExhausted: false,
    };
    const stale = run(model, {
      type: 'bot_decided',
      tag: 5,
      result: { ok: true, value: decision },
    });
    expect(stale).toBe(model);
    const applied = run(model, {
      type: 'bot_decided',
      tag: 0,
      result: { ok: true, value: decision },
    });
    expect(applied.state.actionCount).toBe(1);
    expect(applied.lastMove?.seat).toBe(BOT_SEAT);
    if (action.type === 'PLACE_WORD') {
      for (const { row, col } of action.tiles) {
        expect(applied.owners[`${String(row)},${String(col)}`]).toBe(BOT_SEAT);
      }
    }
  });

  it('returns a pending tile to the rack when the bot takes its square (D-4)', () => {
    const state = newPlayState(seedWhereFirst(BOT_SEAT, lexicon), lexicon);
    const model = startModel(state);
    const action = scriptedAction(state, `bot:${String(BOT_SEAT)}:0`);
    expect(action.type).toBe('PLACE_WORD');
    if (action.type !== 'PLACE_WORD') return;
    const target = action.tiles[0];
    const slot = model.slots.find((s) => s.tile !== '?');
    if (target === undefined || slot === undefined) throw new Error('setup');
    const planned = run(
      model,
      { type: 'select', slotId: slot.id },
      { type: 'press_square', row: target.row, col: target.col },
    );
    expect(planned.pending).toHaveLength(1);
    const decision = {
      action,
      nodesUsed: 1,
      candidatesEvaluated: 1,
      candidatesRefused: 0,
      budgetExhausted: false,
    };
    const after = run(planned, {
      type: 'bot_decided',
      tag: 0,
      result: { ok: true, value: decision },
    });
    expect(after.pending).toEqual([]);
    expect(after.notice).toBe('tile_conflict');
    expect(visibleRack(after).some((s) => s.id === slot.id)).toBe(true);
  });

  it('stops on a bot error or an action the engine refuses (never a silent substitute)', () => {
    const state = newPlayState(seedWhereFirst(BOT_SEAT, lexicon), lexicon);
    const model = startModel(state);
    const failed = run(model, {
      type: 'bot_decided',
      tag: 0,
      result: { ok: false, error: { kind: 'bot', code: 'MATCH_OVER', message: 'x' } },
    });
    expect(failed.failure).toBe('bot');
    expect(failed.state).toBe(state);
    const refused = run(model, {
      type: 'bot_decided',
      tag: 0,
      result: {
        ok: true,
        value: {
          action: { seat: BOT_SEAT, type: 'PLACE_WORD', tiles: [{ row: 0, col: 0, tile: 'Q' }] },
          nodesUsed: 1,
          candidatesEvaluated: 1,
          candidatesRefused: 0,
          budgetExhausted: false,
        },
      },
    });
    expect(refused.failure).toBe('bot');
    expect(refused.state).toBe(state);
    expect(run(model, { type: 'bot_failed', tag: 0 }).failure).toBe('bot');
    expect(run(model, { type: 'bot_failed', tag: 3 })).toBe(model);
    // Once failed, later results are ignored.
    expect(run(failed, { type: 'bot_failed', tag: 0 })).toBe(failed);
  });

  it('recalls every pending tile', () => {
    const model = startModel(newPlayState(humanStarts(lexicon), lexicon));
    const [a, b] = model.slots.filter((s) => s.tile !== '?');
    if (a === undefined || b === undefined) throw new Error('setup');
    const placed = run(
      model,
      { type: 'select', slotId: a.id },
      { type: 'press_square', row: 7, col: 7 },
      { type: 'select', slotId: b.id },
      { type: 'press_square', row: 7, col: 8 },
    );
    expect(placed.pending).toHaveLength(2);
    expect(run(placed, { type: 'recall' }).pending).toEqual([]);
  });
});

describe('rejection copy (AC-6)', () => {
  const placement = (violation: string): Rejection =>
    ({ kind: 'rejection', code: 'placement', message: '', details: { violation } }) as Rejection;
  it.each([
    ['not_collinear', 'match.reject.not_in_line'],
    ['gap', 'match.reject.gap'],
    ['not_connected', 'match.reject.not_connected'],
    ['start_not_covered', 'match.reject.must_cover_start'],
    ['first_move_too_short', 'match.reject.first_two_tiles'],
    ['occupied', 'match.reject.placement'],
  ])('maps placement %s to %s', (violation, key) => {
    expect(rejectionNotice(placement(violation)).key).toBe(key);
  });

  it('names every offending form, main word first, truncated to 3', () => {
    const words = (forms: string[]): Rejection => ({
      kind: 'rejection',
      code: 'not_in_lexicon',
      message: '',
      details: { words: forms.map((form, i) => ({ form, main: i === 0 })) },
    });
    expect(rejectionNotice(words(['KUBECTL']))).toEqual({
      key: 'match.reject.not_in_lexicon',
      params: { word: 'KUBECTL' },
    });
    expect(rejectionNotice(words(['AB', 'CD']))).toEqual({
      key: 'match.reject.not_in_lexicon_many',
      params: { count: 2, words: 'AB, CD' },
    });
    expect(rejectionNotice(words(['AB', 'CD', 'EF', 'GH']))).toEqual({
      key: 'match.reject.not_in_lexicon_many',
      params: { count: 4, words: 'AB, CD, EF, …' },
    });
  });

  it('falls back to the generic reason', () => {
    expect(rejectionNotice({ kind: 'rejection', code: 'match_over', message: '' }).key).toBe(
      'match.reject.generic',
    );
  });
});

describe('outcome', () => {
  const finished = (result: MatchResult): MatchState => ({
    ...newPlayState(humanStarts(lexicon), lexicon),
    status: 'finished',
    result,
  });
  const result = (places: number[], end: MatchResult['end']): MatchResult => ({
    end,
    adjustments: [0, 0],
    teamScores: [0, 0],
    places,
    decidedBy: 'score',
  });

  it('maps places to victory, defeat or draw for the player', () => {
    expect(matchOutcome(finished(result([1, 2], { reason: 'scoreless_turns' })))).toBe('victory');
    expect(matchOutcome(finished(result([2, 1], { reason: 'scoreless_turns' })))).toBe('defeat');
    expect(matchOutcome(finished(result([1, 1], { reason: 'scoreless_turns' })))).toBe('draw');
    expect(matchOutcome(newPlayState(humanStarts(lexicon), lexicon))).toBeNull();
  });

  it('explains the end', () => {
    expect(endReason(finished(result([1, 2], { reason: 'going_out', seat: HUMAN_SEAT })))).toEqual({
      key: 'summary.end.out_you',
      params: {},
    });
    expect(endReason(finished(result([1, 2], { reason: 'going_out', seat: BOT_SEAT })))).toEqual({
      key: 'summary.end.out_bot',
      params: {},
    });
    expect(endReason(finished(result([1, 2], { reason: 'scoreless_turns' })))).toEqual({
      key: 'summary.end.scoreless',
      params: { count: 6 },
    });
    expect(endReason(finished(result([1, 2], { reason: 'resign', seat: HUMAN_SEAT })))).toBeNull();
    expect(endReason(newPlayState(humanStarts(lexicon), lexicon))).toBeNull();
  });
});
