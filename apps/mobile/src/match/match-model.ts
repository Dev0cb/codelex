/**
 * The match as the app holds it (E-1.5 slices S1 and S2): the engine `MatchState` (host only, never rendered
 * directly), the player's rack arrangement and pending tiles (presentation state, never persisted, D-4), the move
 * log with the engine's score breakdowns (D-14) and what the status strip explains. Every outcome comes from
 * `@codelex/game-engine` (`apply`, `previewScore`); this module never scores, validates or decides anything itself
 * (CLAUDE.md §1.1, §1.2). Pure: same model and command give the same model.
 */
import type { BotDecision, BotError } from '@codelex/bots';
import type { Result } from '@codelex/config/result';
import {
  apply,
  exchangeEligibility,
  observe,
  previewScore,
  rulesFor,
  type Action,
  type Applied,
  type BoardTile,
  type EngineContext,
  type ExchangeEligibility,
  type Letter,
  type MatchState,
  type Placement,
  type PreviewScore,
  type RackTile,
  type Rejection,
  type ScoreBreakdown,
  type Seat,
  type Square,
} from '@codelex/game-engine';
import type { MessageKey, MessageParams } from '@codelex/i18n';

import { BOT_SEAT, HUMAN_SEAT } from './play-config';

/** A rack tile with a stable id, so the player's arrangement survives refills (the engine rack is a sorted set). */
export interface RackSlot {
  readonly id: number;
  readonly tile: RackTile;
}

/** A tile the player put on the board but has not played yet (UI only, D-4). Blanks carry their letter, lowercase. */
export interface PendingTile {
  readonly slotId: number;
  readonly row: number;
  readonly col: number;
  readonly tile: BoardTile;
}

/**
 * One accepted action, as the move log shows it (§5.5.1). `turn` = the engine's action count after it (1-based).
 * Exchanged tiles are never named, only counted.
 */
export type MoveEntry =
  | {
      readonly kind: 'word';
      readonly seat: Seat;
      readonly turn: number;
      readonly points: number;
      readonly squares: readonly Square[];
      /** The main word as played, read from the board: blanks in lowercase (§5.5.1, D-21). */
      readonly form: string;
      /** The engine's `ScoreBreakdown`, verbatim (R-SCORE-008). */
      readonly breakdown: ScoreBreakdown;
      /** Canonical form of the previous main term this move chained from, when the engine awarded a chain. */
      readonly chainFrom: string | null;
    }
  | { readonly kind: 'pass'; readonly seat: Seat; readonly turn: number }
  | {
      readonly kind: 'exchange';
      readonly seat: Seat;
      readonly turn: number;
      readonly count: number;
    }
  | { readonly kind: 'resign'; readonly seat: Seat; readonly turn: number };

export type LastMove = MoveEntry;

/** An i18n message (key + ICU params) the UI formats. */
export interface Notice {
  readonly key: MessageKey;
  readonly params: MessageParams;
}

export interface MatchModel {
  readonly state: MatchState;
  readonly slots: readonly RackSlot[];
  readonly nextSlotId: number;
  readonly pending: readonly PendingTile[];
  readonly selectedSlotId: number | null;
  /** Who played each committed tile, `"row,col"` → seat (presentation: the engine board has no owner). */
  readonly owners: Readonly<Record<string, Seat>>;
  /** Accepted actions, oldest first. */
  readonly log: readonly MoveEntry[];
  readonly lastMove: LastMove | null;
  /** The engine's reason for the last rejected PLAY, until the placement changes (D-6). */
  readonly rejection: Notice | null;
  /**
   * One-line notice: a pending tile went back because the bot took its square (D-4), or why Exchange is not
   * available now (§5.5.6: the "why" is never hidden).
   */
  readonly notice: 'tile_conflict' | 'exchange_unavailable' | null;
  /** The blank was dropped on a square and waits for its letter. */
  readonly blankRequest: {
    readonly slotId: number;
    readonly row: number;
    readonly col: number;
  } | null;
  /** The bot failed or produced an action the engine refused: the match stops (spec halt criterion). */
  readonly failure: 'bot' | null;
}

export type MatchCommand =
  | { readonly type: 'select'; readonly slotId: number }
  | { readonly type: 'press_square'; readonly row: number; readonly col: number }
  | { readonly type: 'choose_blank'; readonly letter: Letter }
  | { readonly type: 'cancel_blank' }
  | { readonly type: 'recall' }
  /** Local reorder (AC-7): `order` is a permutation of the slot ids, e.g. from {@link shuffledOrder}. */
  | { readonly type: 'shuffle'; readonly order: readonly number[] }
  | { readonly type: 'play' }
  | { readonly type: 'pass' }
  /** Swap these rack slots (1–7) through the engine (AC-7, R-BAG-005). */
  | { readonly type: 'exchange'; readonly slotIds: readonly number[] }
  /** The player tapped the unavailable Exchange: say why. */
  | { readonly type: 'explain_exchange' }
  /** R-END-002: allowed at any time while the match runs; the engine ends the match. */
  | { readonly type: 'resign' }
  | {
      readonly type: 'bot_decided';
      /** `actionCount` the request was made for; any other value is a stale result. */
      readonly tag: number;
      readonly result: Result<BotDecision, BotError>;
    }
  /** The runner itself failed (threw): no decision exists for `tag`. */
  | { readonly type: 'bot_failed'; readonly tag: number };

const squareKey = (row: number, col: number): string => `${String(row)},${String(col)}`;

/**
 * The new rack as slots: tiles still on the rack keep their order and ids, new tiles are appended in rack order with
 * fresh ids.
 */
export function arrangeRack(
  slots: readonly RackSlot[],
  rack: string,
  nextSlotId: number,
): { readonly slots: RackSlot[]; readonly nextSlotId: number } {
  const remaining: string[] = [];
  for (let i = 0; i < rack.length; i += 1) remaining.push(rack.charAt(i));
  const kept: RackSlot[] = [];
  for (const slot of slots) {
    const at = remaining.indexOf(slot.tile);
    if (at === -1) continue;
    remaining.splice(at, 1);
    kept.push(slot);
  }
  let next = nextSlotId;
  for (const tile of remaining) {
    kept.push({ id: next, tile: tile as RackTile });
    next += 1;
  }
  return { slots: kept, nextSlotId: next };
}

export function startModel(state: MatchState): MatchModel {
  const { slots, nextSlotId } = arrangeRack([], state.seats[HUMAN_SEAT]?.rack ?? '', 1);
  return {
    state,
    slots,
    nextSlotId,
    pending: [],
    selectedSlotId: null,
    owners: {},
    log: [],
    lastMove: null,
    rejection: null,
    notice: null,
    blankRequest: null,
    failure: null,
  };
}

/** Rack slots not on the board. */
export function visibleRack(model: MatchModel): readonly RackSlot[] {
  const placed = new Set(model.pending.map((p) => p.slotId));
  if (model.blankRequest !== null) placed.add(model.blankRequest.slotId);
  return model.slots.filter((s) => !placed.has(s.id));
}

/**
 * Slot ids in a shuffled order (Fisher–Yates over `random()` in [0, 1)). Presentation only (Shuffle, AC-7): the rack
 * order never reaches the engine, so a non-seeded source is fine.
 */
export function shuffledOrder(slots: readonly RackSlot[], random: () => number): number[] {
  const order = slots.map((s) => s.id);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(Math.max(random(), 0) * (i + 1)));
    const a = order[i] ?? 0;
    order[i] = order[j] ?? 0;
    order[j] = a;
  }
  return order;
}

const playerOnTurn = (state: MatchState): boolean =>
  state.status === 'in_progress' && state.seatOnTurn === HUMAN_SEAT;

/**
 * Whether the player may exchange now, as the engine answers it (R-TURN-001, `exchangeEligibility`): the app never
 * restates the rule. `apply` still validates the action itself.
 */
export function exchangeStatus(state: MatchState): ExchangeEligibility {
  return exchangeEligibility(observe(state, HUMAN_SEAT));
}

export const canExchange = (state: MatchState): boolean => exchangeStatus(state).ok;

const sortPlacements = (a: Placement, b: Placement): number => a.row - b.row || a.col - b.col;

const pendingPlacements = (model: MatchModel): Placement[] =>
  model.pending.map(({ row, col, tile }) => ({ row, col, tile })).sort(sortPlacements);

/**
 * AC-5: the engine's lexicon-free preview (R-SCORE-009) of the pending tiles, on the player's turn only. Null when
 * the geometry fails, so nothing hints at validity before PLAY.
 */
export function livePreview(model: MatchModel): PreviewScore | null {
  if (!playerOnTurn(model.state) || model.failure !== null || model.pending.length === 0) {
    return null;
  }
  return previewScore(observe(model.state, HUMAN_SEAT), pendingPlacements(model));
}

const isEmpty = (state: MatchState, row: number, col: number): boolean =>
  state.board[row]?.charAt(col) === '.';

/** E-1.5 §5.5.5 copy for an engine rejection. */
export function rejectionNotice(rejection: Rejection): Notice {
  switch (rejection.code) {
    case 'not_in_lexicon': {
      const forms = rejection.details.words.map((w) => w.form);
      if (forms.length === 1) {
        return { key: 'match.reject.not_in_lexicon', params: { word: forms[0] ?? '' } };
      }
      const shown = forms.length > 3 ? [...forms.slice(0, 3), '…'] : forms;
      return {
        key: 'match.reject.not_in_lexicon_many',
        params: { count: forms.length, words: shown.join(', ') },
      };
    }
    case 'placement':
      switch (rejection.details.violation) {
        case 'not_collinear':
          return { key: 'match.reject.not_in_line', params: {} };
        case 'gap':
          return { key: 'match.reject.gap', params: {} };
        case 'not_connected':
          return { key: 'match.reject.not_connected', params: {} };
        case 'start_not_covered':
          return { key: 'match.reject.must_cover_start', params: {} };
        case 'first_move_too_short':
          return { key: 'match.reject.first_two_tiles', params: {} };
        case 'occupied':
        case 'duplicate_square':
        case 'off_board':
        case 'tile_count':
          return { key: 'match.reject.placement', params: {} };
      }
      break;
    case 'rack':
    case 'exchange':
    case 'malformed':
    case 'match_over':
    case 'not_your_turn':
      break;
  }
  return { key: 'match.reject.generic', params: {} };
}

/** The main word as it now reads on the board (blanks stay lowercase). */
function playedForm(board: readonly string[], start: Square, across: boolean, length: number) {
  let form = '';
  for (let i = 0; i < length; i += 1) {
    const row = across ? start.row : start.row + i;
    const col = across ? start.col + i : start.col;
    form += board[row]?.charAt(col) ?? '';
  }
  return form;
}

/** Canonical form of a played form, for the chain line (display only: the engine already decided the link). */
function canonicalOf(form: string, ctx: EngineContext): string {
  const ref = ctx.lexicon.lookup(form);
  return ref === undefined ? form : ctx.lexicon.meta(ctx.lexicon.termOf(ref)).form;
}

function entryOf(applied: Applied, before: MatchState, ctx: EngineContext): MoveEntry | null {
  const turn = applied.state.actionCount;
  for (const event of applied.events) {
    switch (event.type) {
      case 'WORD_PLACED': {
        const { breakdown } = event;
        const main = breakdown.words.find((w) => w.main);
        const previous = before.seats[event.seat]?.lastMainForm ?? '';
        return {
          kind: 'word',
          seat: event.seat,
          turn,
          points: breakdown.total,
          squares: event.tiles.map(({ row, col }) => ({ row, col })),
          form:
            main === undefined
              ? ''
              : playedForm(
                  applied.state.board,
                  main.start,
                  main.direction === 'row',
                  main.form.length,
                ),
          breakdown,
          chainFrom: breakdown.chain > 0 && previous !== '' ? canonicalOf(previous, ctx) : null,
        };
      }
      case 'PASSED':
        return { kind: 'pass', seat: event.seat, turn };
      case 'TILES_EXCHANGED':
        return { kind: 'exchange', seat: event.seat, turn, count: event.count };
      case 'RESIGNED':
        return { kind: 'resign', seat: event.seat, turn };
      case 'MATCH_STARTED':
      case 'TILES_DRAWN':
      case 'TURN_STARTED':
      case 'MATCH_ENDED':
        break;
    }
  }
  return null;
}

/** The model after the engine accepted an action; `used` = slots that left the rack (played or exchanged). */
function afterApplied(
  model: MatchModel,
  applied: Applied,
  used: ReadonlySet<number>,
  ctx: EngineContext,
): MatchModel {
  const { state, action } = applied;
  const owners =
    action.type === 'PLACE_WORD'
      ? {
          ...model.owners,
          ...Object.fromEntries(action.tiles.map((t) => [squareKey(t.row, t.col), action.seat])),
        }
      : model.owners;
  const { slots, nextSlotId } = arrangeRack(
    model.slots.filter((s) => !used.has(s.id)),
    state.seats[HUMAN_SEAT]?.rack ?? '',
    model.nextSlotId,
  );
  const alive = new Set(slots.map((s) => s.id));
  const pending = model.pending.filter(
    (p) => alive.has(p.slotId) && !used.has(p.slotId) && isEmpty(state, p.row, p.col),
  );
  const conflict = pending.length < model.pending.filter((p) => !used.has(p.slotId)).length;
  const blank = model.blankRequest;
  const entry = entryOf(applied, model.state, ctx);
  return {
    ...model,
    state,
    slots,
    nextSlotId,
    pending,
    selectedSlotId:
      model.selectedSlotId !== null && alive.has(model.selectedSlotId)
        ? model.selectedSlotId
        : null,
    owners,
    log: entry === null ? model.log : [...model.log, entry],
    lastMove: entry ?? model.lastMove,
    rejection: null,
    notice: conflict ? 'tile_conflict' : model.notice === 'tile_conflict' ? 'tile_conflict' : null,
    blankRequest:
      blank !== null && alive.has(blank.slotId) && isEmpty(state, blank.row, blank.col)
        ? blank
        : null,
  };
}

function play(model: MatchModel, ctx: EngineContext): MatchModel {
  const { state } = model;
  if (!playerOnTurn(state)) return model;
  if (model.pending.length === 0) return model;
  const action: Action = { seat: HUMAN_SEAT, type: 'PLACE_WORD', tiles: pendingPlacements(model) };
  const applied = apply(state, action, ctx);
  if (!applied.ok) {
    // The app builds only well-formed actions from its own rack, so an engine error here is a rejection.
    const rejection: Notice =
      applied.error.kind === 'rejection'
        ? rejectionNotice(applied.error)
        : { key: 'match.reject.generic', params: {} };
    return { ...model, rejection, notice: null };
  }
  return afterApplied(model, applied.value, new Set(model.pending.map((p) => p.slotId)), ctx);
}

/** Pending tiles go back to the rack before a Pass or an Exchange (D-12). */
const recalled = (model: MatchModel): MatchModel => ({ ...model, pending: [], blankRequest: null });

function pass(model: MatchModel, ctx: EngineContext): MatchModel {
  const { state } = model;
  if (!playerOnTurn(state)) return model;
  const applied = apply(state, { seat: HUMAN_SEAT, type: 'PASS' }, ctx);
  if (!applied.ok) return model;
  return afterApplied(recalled(model), applied.value, new Set(), ctx);
}

function exchange(model: MatchModel, slotIds: readonly number[], ctx: EngineContext): MatchModel {
  if (!canExchange(model.state) || slotIds.length === 0) return model;
  const chosen = new Set(slotIds);
  const tiles = model.slots.filter((s) => chosen.has(s.id)).map((s) => s.tile);
  if (tiles.length !== chosen.size) return model;
  const applied = apply(
    model.state,
    { seat: HUMAN_SEAT, type: 'EXCHANGE', tiles: [...tiles].sort() },
    ctx,
  );
  if (!applied.ok) return model;
  return afterApplied(recalled(model), applied.value, chosen, ctx);
}

function resign(model: MatchModel, ctx: EngineContext): MatchModel {
  if (model.state.status !== 'in_progress') return model;
  const applied = apply(model.state, { seat: HUMAN_SEAT, type: 'RESIGN' }, ctx);
  if (!applied.ok) return model;
  return afterApplied(recalled(model), applied.value, new Set(), ctx);
}

function shuffle(model: MatchModel, order: readonly number[]): MatchModel {
  const byId = new Map(model.slots.map((s) => [s.id, s]));
  if (order.length !== byId.size || new Set(order).size !== order.length) return model;
  const slots: RackSlot[] = [];
  for (const id of order) {
    const slot = byId.get(id);
    if (slot === undefined) return model;
    slots.push(slot);
  }
  return { ...model, slots };
}

/** True when a bot result tagged `tag` still answers the current position. */
function isCurrentBotTurn(model: MatchModel, tag: number): boolean {
  const { state } = model;
  return (
    model.failure === null &&
    state.status === 'in_progress' &&
    state.seatOnTurn === BOT_SEAT &&
    tag === state.actionCount
  );
}

function botDecided(
  model: MatchModel,
  command: Extract<MatchCommand, { type: 'bot_decided' }>,
  ctx: EngineContext,
): MatchModel {
  const { state } = model;
  if (!isCurrentBotTurn(model, command.tag)) return model;
  if (!command.result.ok) return { ...model, failure: 'bot' };
  const applied = apply(state, command.result.value.action, ctx);
  if (!applied.ok) return { ...model, failure: 'bot' };
  return afterApplied(model, applied.value, new Set(), ctx);
}

function pressSquare(model: MatchModel, row: number, col: number): MatchModel {
  if (model.blankRequest !== null) return model;
  const at = model.pending.find((p) => p.row === row && p.col === col);
  if (at !== undefined) {
    return {
      ...model,
      pending: model.pending.filter((p) => p !== at),
      rejection: null,
      notice: null,
    };
  }
  const slot = model.slots.find((s) => s.id === model.selectedSlotId);
  if (slot === undefined || !isEmpty(model.state, row, col)) return model;
  if (slot.tile === '?') {
    return { ...model, blankRequest: { slotId: slot.id, row, col }, selectedSlotId: null };
  }
  return {
    ...model,
    pending: [...model.pending, { slotId: slot.id, row, col, tile: slot.tile }],
    selectedSlotId: null,
    rejection: null,
    notice: null,
  };
}

export function reduceMatch(
  model: MatchModel,
  command: MatchCommand,
  ctx: EngineContext,
): MatchModel {
  switch (command.type) {
    case 'select': {
      if (model.pending.some((p) => p.slotId === command.slotId)) return model;
      const selectedSlotId = model.selectedSlotId === command.slotId ? null : command.slotId;
      return {
        ...model,
        selectedSlotId,
        notice: model.notice === 'exchange_unavailable' ? null : model.notice,
      };
    }
    case 'press_square':
      return pressSquare(model, command.row, command.col);
    case 'choose_blank': {
      const request = model.blankRequest;
      if (request === null) return model;
      const tile = command.letter.toLowerCase() as BoardTile;
      return {
        ...model,
        pending: [...model.pending, { ...request, tile }],
        blankRequest: null,
        rejection: null,
        notice: null,
      };
    }
    case 'cancel_blank':
      return { ...model, blankRequest: null };
    case 'recall':
      return { ...model, pending: [], blankRequest: null, rejection: null, notice: null };
    case 'shuffle':
      return shuffle(model, command.order);
    case 'play':
      return play(model, ctx);
    case 'pass':
      return pass(model, ctx);
    case 'exchange':
      return exchange(model, command.slotIds, ctx);
    case 'explain_exchange':
      return { ...model, notice: 'exchange_unavailable', rejection: null };
    case 'resign':
      return resign(model, ctx);
    case 'bot_decided':
      return botDecided(model, command, ctx);
    case 'bot_failed':
      return isCurrentBotTurn(model, command.tag) ? { ...model, failure: 'bot' } : model;
  }
}

/** The player's result once the match is over (R-END-003: equal places are a draw). */
export function matchOutcome(state: MatchState): 'victory' | 'defeat' | 'draw' | null {
  const places = state.result?.places;
  if (places === undefined) return null;
  const mine = places[HUMAN_SEAT];
  const theirs = places[BOT_SEAT];
  if (mine === theirs) return 'draw';
  return mine === 1 ? 'victory' : 'defeat';
}

/** Why the match ended (E-1.5 §10.4 `summary.end.*`). */
export function endReason(state: MatchState): Notice | null {
  const end = state.result?.end;
  if (end === undefined) return null;
  switch (end.reason) {
    case 'going_out':
      return {
        key: end.seat === HUMAN_SEAT ? 'summary.end.out_you' : 'summary.end.out_bot',
        params: {},
      };
    case 'scoreless_turns':
      return {
        key: 'summary.end.scoreless',
        params: {
          count:
            rulesFor(state.engineRulesVersion).rules.scorelessTurnsPerSeat * state.seats.length,
        },
      };
    case 'resign':
      // Only the player can resign in a vs-bot match; the bots never do (R-END-002).
      return end.seat === HUMAN_SEAT ? { key: 'summary.end.resign', params: {} } : null;
  }
}
