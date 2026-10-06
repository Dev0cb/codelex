/**
 * E-1.5 slice S2 model behaviour: rack actions (Shuffle, Exchange, Resign; AC-7, AC-10), the move log and score
 * explanation (AC-4, D-14) and the lexicon-free live preview (AC-5, R-SCORE-009). Every outcome is compared with
 * the engine's own answer for the same action; nothing here re-derives a rule.
 */
import {
  apply,
  observe,
  previewScore,
  type EngineContext,
  type MatchState,
  type PlaceWordAction,
} from '@codelex/game-engine';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import type { LoadedLexicon } from '../lexicon/load-lexicon';
import {
  canExchange,
  livePreview,
  reduceMatch,
  shuffledOrder,
  startModel,
  visibleRack,
  type MatchCommand,
  type MatchModel,
} from './match-model';
import { BOT_SEAT, HUMAN_SEAT } from './play-config';
import {
  firstWordFor,
  humanStarts,
  loadBundledLexicon,
  newPlayState,
  placeCommands,
  seedWhereFirst,
} from './test-support';

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

const withBag = (state: MatchState, size: number): MatchState => ({
  ...state,
  bag: state.bag.slice(0, size),
});

describe('Shuffle (AC-7: local, no turn)', () => {
  it('reorders the rack slots without touching the engine state', () => {
    const state = newPlayState(humanStarts(lexicon), lexicon);
    const model = startModel(state);
    const order = [...model.slots.map((s) => s.id)].reverse();
    const shuffled = run(model, { type: 'shuffle', order });
    expect(shuffled.state).toBe(state);
    expect(shuffled.slots.map((s) => s.id)).toEqual(order);
    expect(shuffled.log).toEqual([]);
  });

  it('ignores an order that is not a permutation of the rack', () => {
    const model = startModel(newPlayState(humanStarts(lexicon), lexicon));
    const ids = model.slots.map((s) => s.id);
    expect(run(model, { type: 'shuffle', order: ids.slice(1) })).toBe(model);
    expect(run(model, { type: 'shuffle', order: [...ids.slice(1), 999] })).toBe(model);
  });

  it('also works during the bot turn (D-4)', () => {
    const model = startModel(newPlayState(seedWhereFirst(BOT_SEAT, lexicon), lexicon));
    const order = [...model.slots.map((s) => s.id)].reverse();
    expect(run(model, { type: 'shuffle', order }).slots.map((s) => s.id)).toEqual(order);
  });

  it('draws a permutation from the given source (presentation only)', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7];
    const slots = ids.map((id) => ({ id, tile: 'A' as const }));
    const order = shuffledOrder(slots, () => 0);
    expect([...order].sort((a, b) => a - b)).toEqual(ids);
    expect(order).not.toEqual(ids);
    expect(shuffledOrder(slots, () => 0.999999)).toEqual(ids);
  });
});

describe('Exchange (AC-7, R-TURN-001, R-BAG-005)', () => {
  it('is available only on the player turn with at least the rules minimum in the bag', () => {
    const state = newPlayState(humanStarts(lexicon), lexicon);
    expect(canExchange(state)).toBe(true);
    expect(canExchange(withBag(state, 7))).toBe(true);
    expect(canExchange(withBag(state, 6))).toBe(false);
    expect(canExchange(newPlayState(seedWhereFirst(BOT_SEAT, lexicon), lexicon))).toBe(false);
  });

  it('swaps the chosen tiles through the engine, recalls pending tiles first and logs only a count', () => {
    const state = newPlayState(humanStarts(lexicon), lexicon);
    const model = startModel(state);
    const [a, b, c] = model.slots;
    if (a === undefined || b === undefined || c === undefined) throw new Error('setup');
    const planned = run(
      model,
      { type: 'select', slotId: c.id },
      { type: 'press_square', row: 7, col: 7 },
      ...(c.tile === '?' ? [{ type: 'choose_blank', letter: 'A' } as const] : []),
    );
    const exchanged = run(planned, { type: 'exchange', slotIds: [a.id, b.id] });
    const expected = apply(
      state,
      { seat: HUMAN_SEAT, type: 'EXCHANGE', tiles: [a.tile, b.tile].sort() },
      ctx,
    );
    if (!expected.ok) throw new Error('engine refused the exchange');
    expect(exchanged.state).toEqual(expected.value.state);
    expect(exchanged.pending).toEqual([]);
    expect(exchanged.lastMove).toEqual({ kind: 'exchange', seat: HUMAN_SEAT, count: 2, turn: 1 });
    expect(
      exchanged.slots
        .map((s) => s.tile)
        .sort()
        .join(''),
    ).toBe(expected.value.state.seats[HUMAN_SEAT]?.rack);
    // The kept tile keeps its slot id; the two new tiles get fresh ids.
    expect(exchanged.slots.some((s) => s.id === c.id)).toBe(true);
    expect(exchanged.slots.some((s) => s.id === a.id || s.id === b.id)).toBe(false);
  });

  it('does nothing without tiles, with unknown slots, out of turn or below the bag minimum', () => {
    const state = newPlayState(humanStarts(lexicon), lexicon);
    const model = startModel(state);
    const [a] = model.slots;
    if (a === undefined) throw new Error('setup');
    expect(run(model, { type: 'exchange', slotIds: [] })).toBe(model);
    expect(run(model, { type: 'exchange', slotIds: [999] })).toBe(model);
    const low = startModel(withBag(state, 6));
    expect(run(low, { type: 'exchange', slotIds: [a.id] })).toBe(low);
    const bot = startModel(newPlayState(seedWhereFirst(BOT_SEAT, lexicon), lexicon));
    expect(run(bot, { type: 'exchange', slotIds: [bot.slots[0]?.id ?? 0] })).toBe(bot);
  });

  it('explains why Exchange is unavailable until the player does something else', () => {
    const model = startModel(withBag(newPlayState(humanStarts(lexicon), lexicon), 5));
    const explained = run(model, { type: 'explain_exchange' });
    expect(explained.notice).toBe('exchange_unavailable');
    const [a] = model.slots;
    if (a === undefined) throw new Error('setup');
    expect(run(explained, { type: 'select', slotId: a.id }).notice).toBeNull();
  });
});

describe('Resign (AC-10, R-END-002)', () => {
  it('ends the match through the engine as a defeat without rack adjustments, even on the bot turn', () => {
    for (const seed of [humanStarts(lexicon), seedWhereFirst(BOT_SEAT, lexicon)]) {
      const state = newPlayState(seed, lexicon);
      const resigned = run(startModel(state), { type: 'resign' });
      const expected = apply(state, { seat: HUMAN_SEAT, type: 'RESIGN' }, ctx);
      if (!expected.ok) throw new Error('engine refused RESIGN');
      expect(resigned.state).toEqual(expected.value.state);
      expect(resigned.state.result?.end).toEqual({ reason: 'resign', seat: HUMAN_SEAT });
      expect(resigned.state.result?.adjustments).toEqual([0, 0]);
      expect(resigned.lastMove).toEqual({ kind: 'resign', seat: HUMAN_SEAT, turn: 1 });
      expect(run(resigned, { type: 'resign' })).toBe(resigned);
    }
  });
});

describe('move log and score explanation (AC-4, D-14)', () => {
  it('keeps the engine breakdown verbatim and the word as played, blanks in lowercase', () => {
    const state = newPlayState(humanStarts(lexicon), lexicon);
    const action = firstWordFor(state, lexicon);
    // Play the same word with one lettered tile as a blank: the engine scores it 0 (R-BAG-002).
    const at = action.tiles.findIndex((t) => t.tile === t.tile.toUpperCase());
    const lettered = action.tiles[at];
    if (lettered === undefined) throw new Error('setup');
    const rack = state.seats[HUMAN_SEAT]?.rack ?? '';
    const withBlank: MatchState = {
      ...state,
      seats: state.seats.map((s, i) =>
        i === HUMAN_SEAT ? { ...s, rack: `?${rack.replace(lettered.tile, '')}` } : s,
      ),
    };
    const blanked = {
      ...action,
      tiles: action.tiles.map((t, i) => (i === at ? { ...t, tile: t.tile.toLowerCase() } : t)),
    } as PlaceWordAction;
    const model = startModel(withBlank);
    const played = run(model, ...placeCommands(model, blanked), { type: 'play' });
    const expected = apply(withBlank, blanked, ctx);
    if (!expected.ok) throw new Error('engine refused the blank word');
    const event = expected.value.events.find((e) => e.type === 'WORD_PLACED');
    if (event?.type !== 'WORD_PLACED') throw new Error('no WORD_PLACED');
    const entry = played.lastMove;
    if (entry?.kind !== 'word') throw new Error('not a word');
    expect(entry.breakdown).toEqual(event.breakdown);
    expect(entry.points).toBe(event.breakdown.total);
    const main = event.breakdown.words.find((w) => w.main);
    expect(entry.form.toUpperCase()).toBe(main?.form);
    expect(entry.form).toMatch(/[a-z]/);
    expect(entry.chainFrom).toBeNull();
  });

  it('names the linked previous term, canonically, when the engine awards a chain (R-SCORE-005)', () => {
    const state = newPlayState(humanStarts(lexicon), lexicon);
    const action = firstWordFor(state, lexicon);
    const plain = apply(state, action, ctx);
    if (!plain.ok) throw new Error('setup');
    const placed = plain.value.events.find((e) => e.type === 'WORD_PLACED');
    const main = placed?.type === 'WORD_PLACED' ? placed.breakdown.words.find((w) => w.main) : null;
    const ref = lexicon.index.lookup(main?.form ?? '');
    if (ref === undefined) throw new Error('main word not in the lexicon');
    const term = lexicon.index.termOf(ref);
    const neighbour = lexicon.index.neighbours(term).find((n) => n !== term);
    if (neighbour === undefined) throw new Error('the scripted word has no related term');
    const previous = lexicon.index.meta(neighbour).form;
    // The player's previous main word was a related term: the engine links this move to it.
    const linked: MatchState = {
      ...state,
      seats: state.seats.map((s, i) => (i === HUMAN_SEAT ? { ...s, lastMainForm: previous } : s)),
    };
    const model = startModel(linked);
    const played = run(model, ...placeCommands(model, action), { type: 'play' });
    const entry = played.lastMove;
    if (entry?.kind !== 'word') throw new Error('not a word');
    expect(entry.breakdown.chain).toBeGreaterThan(0);
    expect(entry.chainFrom).toBe(previous);
  });
});

describe('live preview (AC-5, R-SCORE-009)', () => {
  it('is the engine preview of the pending tiles on the player turn, null otherwise', () => {
    const state = newPlayState(humanStarts(lexicon), lexicon);
    const model = startModel(state);
    expect(livePreview(model)).toBeNull();
    const action = firstWordFor(state, lexicon);
    const placed = run(model, ...placeCommands(model, action));
    expect(livePreview(placed)).toEqual(
      previewScore(observe(state, HUMAN_SEAT), [...action.tiles]),
    );
    expect(livePreview(placed)).not.toBeNull();
    // Illegal geometry (no start square): no preview at all.
    const slot = model.slots.find((s) => s.tile !== '?');
    if (slot === undefined) throw new Error('setup');
    const corner = run(
      model,
      { type: 'select', slotId: slot.id },
      { type: 'press_square', row: 0, col: 0 },
    );
    expect(livePreview(corner)).toBeNull();
    // Out of turn: nothing to preview.
    const bot = startModel(newPlayState(seedWhereFirst(BOT_SEAT, lexicon), lexicon));
    expect(livePreview(bot)).toBeNull();
    expect(visibleRack(placed)).toHaveLength(7 - action.tiles.length);
  });
});
