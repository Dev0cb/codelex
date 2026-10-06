import type { MatchState, PreviewScore, Seat } from '@codelex/game-engine';
import { describe, expect, it } from '@jest/globals';

import type { MatchModel, MoveEntry } from './match-model';
import { BOT_SEAT, HUMAN_SEAT } from './play-config';
import { scorelessWarning, statusLines } from './status';

const wordMove = (seat: Seat, points: number): MoveEntry => ({
  kind: 'word',
  seat,
  turn: 1,
  points,
  squares: [],
  form: 'POD',
  breakdown: { words: [], tilesPlaced: 2, fullStack: 0, chain: 0, chainKAfter: 0, total: points },
  chainFrom: null,
});

const names = { you: 'You', bot: 'Beginner Bot' };
const emptyBoard = Array.from({ length: 15 }, () => '.'.repeat(15));
const boardWithTile = emptyBoard.map((row, i) => (i === 7 ? '.......A.......' : row));

function model(state: Partial<MatchState>, over: Partial<MatchModel> = {}): MatchModel {
  return {
    state: {
      engineRulesVersion: 1,
      // Enough of a real header and seats for the engine's observe / exchangeEligibility.
      config: {
        mode: 'classic',
        format: 'untimed-vs-bot',
        seats: 2,
        teams: [[0], [1]],
        layout: 'classic-v1',
        letters: 'letters-v1',
        requireWinner: 0,
      },
      seats: [
        { rack: '', score: 0, chainK: 0, lastMainForm: '', bestTurnScore: 0, status: 'active' },
        { rack: '', score: 0, chainK: 0, lastMainForm: '', bestTurnScore: 0, status: 'active' },
      ],
      bag: '',
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
    log: [],
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
    const m = model({ seatOnTurn: BOT_SEAT }, { lastMove: wordMove(HUMAN_SEAT, 14) });
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
    const m = model({}, { lastMove: wordMove(BOT_SEAT, 21) });
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
      statusLines(model({}, { lastMove: { kind: 'pass', seat: BOT_SEAT, turn: 1 } }), names)
        .primary,
    ).toEqual({ key: 'match.log.entry.pass', params: { actor: 'Beginner Bot' } });
    expect(
      statusLines(
        model({}, { lastMove: { kind: 'exchange', seat: BOT_SEAT, turn: 1, count: 3 } }),
        names,
      ).primary,
    ).toEqual({ key: 'match.log.entry.exchange', params: { actor: 'Beginner Bot', count: 3 } });
    expect(
      statusLines(
        model({ seatOnTurn: BOT_SEAT }, { lastMove: { kind: 'pass', seat: HUMAN_SEAT, turn: 1 } }),
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

  it('adds the end warning from 4 scoreless turns (D-13)', () => {
    expect(scorelessWarning(model({ scorelessTurns: 3 }).state)).toBeNull();
    expect(scorelessWarning(model({ scorelessTurns: 4 }).state)).toEqual({
      key: 'match.scoreless.warning',
      params: { max: 6 },
    });
  });

  it('says why Exchange is unavailable, with the live bag count (§5.5.6)', () => {
    expect(statusLines(model({ bag: 'ABCDE' }, { notice: 'exchange_unavailable' }), names)).toEqual(
      {
        tone: 'neutral',
        primary: { key: 'match.exchange.disabled', params: { count: 5, min: 7 } },
        secondary: { key: 'match.your_turn', params: {} },
      },
    );
  });
});

describe('live preview line (AC-5, D-5)', () => {
  const pending = [{ slotId: 1, row: 7, col: 7, tile: 'A' as const }];
  const preview = (total: number, fullStack = 0): PreviewScore => ({
    words: [],
    fullStack,
    total,
  });

  it('reads "Base N" with the bonus hint, never a validity word', () => {
    expect(statusLines(model({}, { pending }), names, preview(14))).toEqual({
      tone: 'neutral',
      primary: { key: 'match.preview.base', params: { points: 14 } },
      secondary: { key: 'match.preview.hint', params: {} },
    });
    expect(statusLines(model({}, { pending }), names, preview(70, 50)).primary).toEqual({
      key: 'match.preview.base_full_stack',
      params: { points: 70 },
    });
  });

  it('is absent without a preview (flag off or illegal geometry) and yields to a rejection', () => {
    expect(statusLines(model({}, { pending }), names, null).primary).toEqual({
      key: 'match.your_turn',
      params: {},
    });
    const rejection = { key: 'match.reject.gap' as const, params: {} };
    expect(statusLines(model({}, { pending, rejection }), names, preview(14)).primary).toBe(
      rejection,
    );
  });
});
