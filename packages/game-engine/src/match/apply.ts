/**
 * `apply` (API note §13.2): validates (§8.3, `validateAction`), then performs PLACE_WORD, EXCHANGE, PASS or
 * RESIGN and detects the end of the match (R-END-001, R-END-002, R-TURN-004). On failure the error is the only
 * output and the input state is untouched (P-GLOBAL-03). Unchanged rows and seats are shared with the input.
 */
import { ok, type Result } from '@codelex/config/result';
import { validateAction } from '../actions/validate.js';
import { assertNever } from '../errors.js';
import { refillRack } from '../bag/bag.js';
import { placeTiles } from '../placement/check.js';
import { getLayout, getLetterTable } from '../rules/constants.js';
import { finishMatch } from '../scoring/end.js';
import { scorePlacement } from '../scoring/score.js';
import { sortTiles } from '../tiles.js';
import type {
  Action,
  ApplyFailure,
  EngineContext,
  MatchEnd,
  MatchEvent,
  MatchState,
  Rules,
  Seat,
  SeatState,
} from '../types.js';

export interface Applied {
  readonly state: MatchState;
  readonly events: readonly MatchEvent[];
  /** Canonical action to append to the log (ADR-0013 §D2). */
  readonly action: Action;
}

const isActive = (seat: SeatState | undefined): boolean => seat?.status === 'active';

/** Next active seat after `from` in increasing index modulo the seat count (R-CORE-004 d). */
function nextActiveSeat(seats: readonly SeatState[], from: Seat): Seat {
  for (let step = 1; step <= seats.length; step += 1) {
    const candidate = (from + step) % seats.length;
    if (isActive(seats[candidate])) return candidate;
  }
  return from;
}

function withSeat(seats: readonly SeatState[], index: Seat, seat: SeatState): SeatState[] {
  return seats.map((s, i) => (i === index ? seat : s));
}

function activeTeamCount(state: MatchState, seats: readonly SeatState[]): number {
  return state.config.teams.filter((team) => team.every((s) => isActive(seats[s]))).length;
}

/** Ends the match: R-SCORE-006, result, `status` finished, `seatOnTurn` unchanged (API note §7). */
function finish(
  state: MatchState,
  seats: readonly SeatState[],
  end: MatchEnd,
  events: MatchEvent[],
): MatchState {
  const finished = finishMatch({ config: state.config, firstSeat: state.firstSeat, seats, end });
  events.push({
    type: 'MATCH_ENDED',
    result: finished.result,
    finalRacks: finished.seats.map((s) => s.rack),
  });
  return { ...state, status: 'finished', seats: finished.seats, result: finished.result };
}

/** After a turn-ending action: end on R-TURN-004 (3 × active seats) or pass the turn. */
function endTurn(next: MatchState, events: MatchEvent[], rules: Rules): MatchState {
  const active = next.seats.filter(isActive).length;
  if (next.scorelessTurns >= rules.scorelessTurnsPerSeat * active) {
    return finish(next, next.seats, { reason: 'scoreless_turns' }, events);
  }
  const seatOnTurn = nextActiveSeat(next.seats, next.seatOnTurn);
  events.push({ type: 'TURN_STARTED', seat: seatOnTurn, turnNumber: next.turnNumber });
  return { ...next, seatOnTurn };
}

/** Applies an untrusted action. Same inputs ⇒ deep-equal outputs (P-GLOBAL-01). */
export function apply(
  state: MatchState,
  input: Action,
  ctx: EngineContext,
): Result<Applied, ApplyFailure> {
  const validated = validateAction(state, input, ctx);
  if (!validated.ok) return validated;
  const v = validated.value;
  const { rules } = v;
  const mover = v.action.seat;
  const seat = state.seats[mover] as SeatState;
  const events: MatchEvent[] = [];
  const base = { ...state, actionCount: state.actionCount + 1 };

  switch (v.type) {
    case 'PLACE_WORD': {
      const breakdown = scorePlacement(
        v.placement,
        getLayout(state.config.layout),
        getLetterTable(state.config.letters),
        seat,
        ctx.lexicon,
        rules,
      );
      const refill = refillRack(v.placement.rackAfter, state.bag, rules);
      const main = v.placement.words[0];
      const updated: SeatState = {
        ...seat,
        rack: refill.rack,
        score: seat.score + breakdown.total,
        chainK: breakdown.chainKAfter,
        lastMainForm: main?.form ?? seat.lastMainForm,
        bestTurnScore: Math.max(seat.bestTurnScore, breakdown.total),
      };
      const seats = withSeat(state.seats, mover, updated);
      events.push({
        type: 'WORD_PLACED',
        seat: mover,
        tiles: v.action.tiles,
        breakdown,
        seatScore: updated.score,
      });
      if (refill.drawn !== '') {
        events.push({
          type: 'TILES_DRAWN',
          seat: mover,
          cause: 'refill',
          count: refill.drawn.length,
          tiles: sortTiles(refill.drawn),
          bagCount: refill.bag.length,
        });
      }
      const next: MatchState = {
        ...base,
        board: placeTiles(state.board, v.action.tiles),
        bag: refill.bag,
        seats,
        turnNumber: state.turnNumber + 1,
        scorelessTurns: 0,
      };
      if (refill.rack === '') {
        // R-END-001: the rack is empty after the refill only when the bag is empty too.
        return ok({
          state: finish(next, seats, { reason: 'going_out', seat: mover }, events),
          events,
          action: v.action,
        });
      }
      return ok({ state: endTurn(next, events, rules), events, action: v.action });
    }
    case 'EXCHANGE': {
      const x = v.exchange;
      events.push({
        type: 'TILES_EXCHANGED',
        seat: mover,
        count: x.returned.length,
        returned: x.returned,
      });
      events.push({
        type: 'TILES_DRAWN',
        seat: mover,
        cause: 'exchange',
        count: x.drawn.length,
        tiles: sortTiles(x.drawn),
        bagCount: x.bag.length,
      });
      const next: MatchState = {
        ...base,
        bag: x.bag,
        rng: { bag: x.rng },
        seats: withSeat(state.seats, mover, { ...seat, rack: x.rack }),
        turnNumber: state.turnNumber + 1,
        scorelessTurns: state.scorelessTurns + 1,
      };
      return ok({ state: endTurn(next, events, rules), events, action: v.action });
    }
    case 'PASS': {
      const scorelessTurns = state.scorelessTurns + 1;
      events.push({ type: 'PASSED', seat: mover, scorelessTurns });
      const next: MatchState = { ...base, turnNumber: state.turnNumber + 1, scorelessTurns };
      return ok({ state: endTurn(next, events, rules), events, action: v.action });
    }
    case 'RESIGN': {
      const seats = withSeat(state.seats, mover, { ...seat, status: 'resigned' });
      events.push({ type: 'RESIGNED', seat: mover });
      const next: MatchState = { ...base, seats };
      // R-END-002: the match ends unless ≥ 2 sides remain (FFA); a RESIGN never triggers R-TURN-004.
      if (activeTeamCount(state, seats) < 2) {
        return ok({
          state: finish(next, seats, { reason: 'resign', seat: mover }, events),
          events,
          action: v.action,
        });
      }
      if (mover !== state.seatOnTurn) return ok({ state: next, events, action: v.action });
      const seatOnTurn = nextActiveSeat(seats, mover);
      events.push({ type: 'TURN_STARTED', seat: seatOnTurn, turnNumber: state.turnNumber });
      return ok({ state: { ...next, seatOnTurn }, events, action: v.action });
    }
    default:
      return assertNever(v);
  }
}
