/**
 * What the match status strip says (E-1.5 §5.5.1, §5.5.3, §5.5.4, §5.5.5, §5.5.6, §5.5.7; D-5, D-6, D-13, D-14), as
 * i18n notices. Information never auto-dismisses: a line changes only when the match or the player's placement
 * changes.
 */
import { rulesFor, type MatchState, type PreviewScore } from '@codelex/game-engine';

import { exchangeStatus, type LastMove, type MatchModel, type Notice } from './match-model';
import { BOT_SEAT, HUMAN_SEAT } from './play-config';

export interface StatusLines {
  readonly tone: 'neutral' | 'thinking' | 'error';
  readonly primary: Notice;
  readonly secondary: Notice | null;
}

/** Display names, already translated (`match.you`, `bot.<id>.name`). */
export interface Names {
  readonly you: string;
  readonly bot: string;
}

/** D-13: the scoreless counter shows from this many consecutive scoreless turns, the end warning one later. */
const SCORELESS_VISIBLE_FROM = 3;
const SCORELESS_WARNING_FROM = 4;

const scorelessMax = (state: MatchState): number =>
  rulesFor(state.engineRulesVersion).rules.scorelessTurnsPerSeat * state.seats.length;

/** D-13: "The match ends after 6 scoreless turns in a row", from 4 consecutive scoreless turns. */
export function scorelessWarning(state: MatchState): Notice | null {
  if (state.status !== 'in_progress' || state.scorelessTurns < SCORELESS_WARNING_FROM) return null;
  return { key: 'match.scoreless.warning', params: { max: scorelessMax(state) } };
}

function lastMoveLine(move: LastMove, names: Names): Notice {
  const actor = move.seat === HUMAN_SEAT ? names.you : names.bot;
  switch (move.kind) {
    case 'word':
      return move.seat === HUMAN_SEAT
        ? { key: 'match.breakdown.you_scored', params: { points: move.points } }
        : { key: 'match.breakdown.bot_scored', params: { bot: names.bot, points: move.points } };
    case 'pass':
      return { key: 'match.log.entry.pass', params: { actor } };
    case 'exchange':
      return { key: 'match.log.entry.exchange', params: { actor, count: move.count } };
    case 'resign':
      return { key: 'match.log.entry.resign', params: { actor } };
  }
}

const isBoardEmpty = (board: readonly string[]): boolean => board.every((row) => !/[^.]/.test(row));

/**
 * The strip lines. `preview` is the engine's R-SCORE-009 projection of the pending tiles (null when the flag
 * `match.live_score_preview` is off or the geometry fails): it reads "Base N", never a validity cue (AC-5, D-5).
 */
export function statusLines(
  model: MatchModel,
  names: Names,
  preview: PreviewScore | null = null,
): StatusLines {
  const { state } = model;
  if (model.failure !== null) {
    return { tone: 'error', primary: { key: 'match.error', params: {} }, secondary: null };
  }
  if (model.rejection !== null) return { tone: 'error', primary: model.rejection, secondary: null };
  const scoreless: Notice | null =
    state.scorelessTurns >= SCORELESS_VISIBLE_FROM
      ? {
          key: 'match.scoreless',
          params: { count: state.scorelessTurns, max: scorelessMax(state) },
        }
      : null;
  if (state.status === 'in_progress' && state.seatOnTurn === BOT_SEAT) {
    const secondary: Notice | null =
      state.actionCount === 0
        ? { key: 'match.bot_starts', params: { bot: names.bot } }
        : model.lastMove !== null
          ? lastMoveLine(model.lastMove, names)
          : scoreless;
    return {
      tone: 'thinking',
      primary: { key: 'match.bot_thinking', params: { bot: names.bot } },
      secondary,
    };
  }
  const yourTurn: Notice = { key: 'match.your_turn', params: {} };
  if (model.notice === 'tile_conflict') {
    return {
      tone: 'neutral',
      primary: { key: 'match.tile_conflict', params: {} },
      secondary: yourTurn,
    };
  }
  if (model.notice === 'exchange_unavailable') {
    return {
      tone: 'neutral',
      primary: {
        key: 'match.exchange.disabled',
        params: { count: state.bag.length, min: exchangeStatus(state).minBag },
      },
      secondary: yourTurn,
    };
  }
  if (preview !== null && model.pending.length > 0) {
    return {
      tone: 'neutral',
      primary: {
        key: preview.fullStack > 0 ? 'match.preview.base_full_stack' : 'match.preview.base',
        params: { points: preview.total },
      },
      secondary: { key: 'match.preview.hint', params: {} },
    };
  }
  if (state.actionCount === 0 && model.pending.length === 0) {
    return {
      tone: 'neutral',
      primary: { key: 'match.you_start', params: {} },
      secondary: { key: 'match.first_move_hint', params: {} },
    };
  }
  if (model.pending.length === 0 && model.lastMove !== null && model.lastMove.seat === BOT_SEAT) {
    return { tone: 'neutral', primary: lastMoveLine(model.lastMove, names), secondary: yourTurn };
  }
  const secondary: Notice | null = isBoardEmpty(state.board)
    ? { key: 'match.first_move_hint', params: {} }
    : scoreless;
  return { tone: 'neutral', primary: yourTurn, secondary };
}
