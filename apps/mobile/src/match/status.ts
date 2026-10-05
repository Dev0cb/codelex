/**
 * What the match status strip says (E-1.5 §5.5.1, §5.5.4, §5.5.5, §5.5.7; D-6, D-13, D-14), as i18n notices.
 * Information never auto-dismisses: a line changes only when the match or the player's placement changes.
 */
import { rulesFor } from '@codelex/game-engine';

import type { LastMove, MatchModel, Notice } from './match-model';
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

/** D-13: the scoreless counter shows from this many consecutive scoreless turns. */
const SCORELESS_VISIBLE_FROM = 3;

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
  }
}

const isBoardEmpty = (board: readonly string[]): boolean => board.every((row) => !/[^.]/.test(row));

export function statusLines(model: MatchModel, names: Names): StatusLines {
  const { state } = model;
  if (model.failure !== null) {
    return { tone: 'error', primary: { key: 'match.error', params: {} }, secondary: null };
  }
  if (model.rejection !== null) return { tone: 'error', primary: model.rejection, secondary: null };
  const max = rulesFor(state.engineRulesVersion).rules.scorelessTurnsPerSeat * state.seats.length;
  const scoreless: Notice | null =
    state.scorelessTurns >= SCORELESS_VISIBLE_FROM
      ? { key: 'match.scoreless', params: { count: state.scorelessTurns, max } }
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
