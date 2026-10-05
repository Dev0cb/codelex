/**
 * The match as the app holds it (E-1.5 slice S1): the engine `MatchState` (host only, never rendered directly), the
 * player's rack arrangement and pending tiles (presentation state, never persisted, D-4), and what the status strip
 * explains. Every outcome comes from `@codelex/game-engine` (`apply`); this module never scores, validates or
 * decides anything itself (CLAUDE.md §1.1, §1.2). Pure: same model and command give the same model.
 */
import type { BotDecision, BotError } from '@codelex/bots';
import type { Result } from '@codelex/config/result';
import {
  apply,
  rulesFor,
  type Action,
  type Applied,
  type BoardTile,
  type EngineContext,
  type Letter,
  type MatchState,
  type Placement,
  type RackTile,
  type Rejection,
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

export type LastMove =
  | {
      readonly kind: 'word';
      readonly seat: Seat;
      readonly points: number;
      readonly squares: readonly Square[];
    }
  | { readonly kind: 'pass'; readonly seat: Seat }
  | { readonly kind: 'exchange'; readonly seat: Seat; readonly count: number };

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
  readonly lastMove: LastMove | null;
  /** The engine's reason for the last rejected PLAY, until the placement changes (D-6). */
  readonly rejection: Notice | null;
  /** One-line notice: a pending tile went back because the bot took its square (D-4). */
  readonly notice: 'tile_conflict' | null;
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
  | { readonly type: 'play' }
  | { readonly type: 'pass' }
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

function lastMoveOf(applied: Applied): LastMove | null {
  for (const event of applied.events) {
    if (event.type === 'WORD_PLACED') {
      return {
        kind: 'word',
        seat: event.seat,
        points: event.breakdown.total,
        squares: event.tiles.map(({ row, col }) => ({ row, col })),
      };
    }
    if (event.type === 'PASSED') return { kind: 'pass', seat: event.seat };
    if (event.type === 'TILES_EXCHANGED') {
      return { kind: 'exchange', seat: event.seat, count: event.count };
    }
  }
  return null;
}

/** The model after the engine accepted an action; `used` = slots the player just played. */
function afterApplied(model: MatchModel, applied: Applied, used: ReadonlySet<number>): MatchModel {
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
    lastMove: lastMoveOf(applied),
    rejection: null,
    notice: conflict ? 'tile_conflict' : model.notice,
    blankRequest:
      blank !== null && alive.has(blank.slotId) && isEmpty(state, blank.row, blank.col)
        ? blank
        : null,
  };
}

const sortPlacements = (a: Placement, b: Placement): number => a.row - b.row || a.col - b.col;

function play(model: MatchModel, ctx: EngineContext): MatchModel {
  const { state } = model;
  if (state.status !== 'in_progress' || state.seatOnTurn !== HUMAN_SEAT) return model;
  if (model.pending.length === 0) return model;
  const action: Action = {
    seat: HUMAN_SEAT,
    type: 'PLACE_WORD',
    tiles: model.pending.map(({ row, col, tile }) => ({ row, col, tile })).sort(sortPlacements),
  };
  const applied = apply(state, action, ctx);
  if (!applied.ok) {
    // The app builds only well-formed actions from its own rack, so an engine error here is a rejection.
    const rejection: Notice =
      applied.error.kind === 'rejection'
        ? rejectionNotice(applied.error)
        : { key: 'match.reject.generic', params: {} };
    return { ...model, rejection, notice: null };
  }
  return afterApplied(model, applied.value, new Set(model.pending.map((p) => p.slotId)));
}

function pass(model: MatchModel, ctx: EngineContext): MatchModel {
  const { state } = model;
  if (state.status !== 'in_progress' || state.seatOnTurn !== HUMAN_SEAT) return model;
  const applied = apply(state, { seat: HUMAN_SEAT, type: 'PASS' }, ctx);
  if (!applied.ok) return model;
  // Pending tiles go back to the rack (D-12).
  return afterApplied({ ...model, pending: [], blankRequest: null }, applied.value, new Set());
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
  return afterApplied(model, applied.value, new Set());
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
      return { ...model, selectedSlotId };
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
    case 'play':
      return play(model, ctx);
    case 'pass':
      return pass(model, ctx);
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

/** Why the match ended (E-1.5 §10.4 `summary.end.*`); resignation is not offered in S1. */
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
      return null;
  }
}
