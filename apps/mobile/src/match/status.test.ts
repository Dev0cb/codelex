import type { MatchState } from '@codelex/game-engine';
import { describe, expect, it } from '@jest/globals';

import type { MatchModel } from './match-model';
import { BOT_SEAT, HUMAN_SEAT } from './play-config';
import { statusLines } from './status';

const names = { you: 'You', bot: 'Beginner Bot' };
const emptyBoard = Array.from({ length: 15 }, () => '.'.repeat(15));
const boardWithTile = emptyBoard.map((row, i) => (i === 7 ? '.......A.......' : row));

function model(state: Partial<MatchState>, over: Partial<MatchModel> = {}): MatchModel {
  return {
    state: {
      engineRulesVersion: 1,
      seats: [{}, {}],
      status: 'in_progress',
      seatOnTurn: HUMAN_SEAT,
      actionCount: 2,
      scorelessTurns: 0,
      board: boardWithTile,
      ...state,
    } as MatchState,
    slots: [],
    nextSlotId: 1,
    pending: [],
    selectedSlotId: null,
    owners: {},
    lastMove: null,
    rejection: null,
    notice: null,
    blankRequest: null,
    failure: null,
    ...over,
  };
}

describe('status strip (E-1.5 §5.5)', () => {
  it('announces who starts and the first-move hint (AC-3)', () => {
    expect(statusLines(model({ actionCount: 0, board: emptyBoard }), names)).toEqual({
      tone: 'neutral',
      primary: { key: 'match.you_start', params: {} },
      secondary: { key: 'match.first_move_hint', params: {} },
    });
  });

  it('shows the bot thinking with the player last score under it (AC-8, D-14)', () => {
    const m = model(
      { seatOnTurn: BOT_SEAT },
      { lastMove: { kind: 'word', seat: HUMAN_SEAT, points: 14, squares: [] } },
    );
    expect(statusLines(m, names)).toEqual({
      tone: 'thinking',
      primary: { key: 'match.bot_thinking', params: { bot: 'Beginner Bot' } },
      secondary: { key: 'match.breakdown.you_scored', params: { points: 14 } },
    });
    expect(statusLines(model({ seatOnTurn: BOT_SEAT, actionCount: 0 }), names).secondary).toEqual({
      key: 'match.bot_starts',
      params: { bot: 'Beginner Bot' },
    });
  });

  it('explains the bot move until the player picks up a tile (D-14)', () => {
    const m = model({}, { lastMove: { kind: 'word', seat: BOT_SEAT, points: 21, squares: [] } });
    expect(statusLines(m, names)).toEqual({
      tone: 'neutral',
      primary: { key: 'match.breakdown.bot_scored', params: { bot: 'Beginner Bot', points: 21 } },
      secondary: { key: 'match.your_turn', params: {} },
    });
    const picking = { ...m, pending: [{ slotId: 1, row: 0, col: 0, tile: 'A' as const }] };
    expect(statusLines(picking, names).primary).toEqual({ key: 'match.your_turn', params: {} });
  });

  it('describes passes and exchanges by actor', () => {
    expect(
      statusLines(model({}, { lastMove: { kind: 'pass', seat: BOT_SEAT } }), names).primary,
    ).toEqual({ key: 'match.log.entry.pass', params: { actor: 'Beginner Bot' } });
    expect(
      statusLines(model({}, { lastMove: { kind: 'exchange', seat: BOT_SEAT, count: 3 } }), names)
        .primary,
    ).toEqual({ key: 'match.log.entry.exchange', params: { actor: 'Beginner Bot', count: 3 } });
    expect(
      statusLines(
        model({ seatOnTurn: BOT_SEAT }, { lastMove: { kind: 'pass', seat: HUMAN_SEAT } }),
        names,
      ).secondary,
    ).toEqual({ key: 'match.log.entry.pass', params: { actor: 'You' } });
  });

  it('keeps the rejection reason until the placement changes (D-6) and flags failures', () => {
    const rejection = { key: 'match.reject.gap' as const, params: {} };
    expect(statusLines(model({}, { rejection }), names)).toEqual({
      tone: 'error',
      primary: rejection,
      secondary: null,
    });
    expect(statusLines(model({}, { failure: 'bot' }), names)).toEqual({
      tone: 'error',
      primary: { key: 'match.error', params: {} },
      secondary: null,
    });
    expect(statusLines(model({}, { notice: 'tile_conflict' }), names).primary).toEqual({
      key: 'match.tile_conflict',
      params: {},
    });
  });

  it('surfaces the scoreless counter from 3 of 6 (D-13)', () => {
    expect(statusLines(model({ scorelessTurns: 3 }), names).secondary).toEqual({
      key: 'match.scoreless',
      params: { count: 3, max: 6 },
    });
    expect(statusLines(model({ scorelessTurns: 2 }), names).secondary).toBeNull();
  });
});
