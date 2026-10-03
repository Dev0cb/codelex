/**
 * End of match (R-SCORE-006, R-END-001…003): rack adjustments, team scores, places and tie-breaks. Called by
 * `apply` (E4) once it has detected the end reason; pure over the seats it is given.
 *
 * Default readings of API note §16 (tests tagged `@ambiguous`):
 * - Q-GD-2: racks of non-active seats are out of play (neither added nor subtracted).
 * - Q-GD-3: non-active teams rank below every active team. The state does not record the order of earlier
 *   resignations, so non-active teams share that place (see the note's §16 update).
 * - Q-GD-4: among teams still tied after the best-turn tie-break, the team whose earliest seat in turn order
 *   (from `firstSeat`) moves latest wins.
 */
import { getLetterTable } from '../rules/constants.js';
import { tileValue } from '../tiles.js';
import type { MatchEnd, MatchResult, MatchSetup, Seat, SeatState, TileString } from '../types.js';

export interface EndInput {
  readonly config: MatchSetup;
  readonly firstSeat: Seat;
  /** Scores before R-SCORE-006, final racks, statuses and best turns. */
  readonly seats: readonly SeatState[];
  readonly end: MatchEnd;
}

export interface Finished {
  /** Seats with adjusted scores; everything else unchanged. */
  readonly seats: readonly SeatState[];
  readonly result: MatchResult;
}

/** Face value of a rack: blanks count 0 (R-BAG-006). */
export function rackValue(rack: TileString, config: MatchSetup): number {
  const letters = getLetterTable(config.letters);
  let sum = 0;
  for (let i = 0; i < rack.length; i += 1) sum += tileValue(letters, rack.charAt(i));
  return sum;
}

/** R-SCORE-006 per seat: applied on going out and on scoreless turns only, among active seats. */
export function endAdjustments(input: EndInput): number[] {
  const { seats, end, config } = input;
  const adjustments = seats.map(() => 0);
  if (end.reason === 'resign') return adjustments;
  seats.forEach((seat, i) => {
    if (seat.status !== 'active') return;
    const value = rackValue(seat.rack, config);
    adjustments[i] = (adjustments[i] ?? 0) - value;
    if (end.reason === 'going_out' && i !== end.seat) {
      adjustments[end.seat] = (adjustments[end.seat] ?? 0) + value;
    }
  });
  return adjustments;
}

/** Position of `seat` in turn order starting at `firstSeat` (0 = moves first). */
function turnPosition(seat: Seat, firstSeat: Seat, seatCount: number): number {
  return (seat - firstSeat + seatCount) % seatCount;
}

/** Applies R-SCORE-006 and computes the result (R-END-003). */
export function finishMatch(input: EndInput): Finished {
  const { config, firstSeat, end } = input;
  const adjustments = endAdjustments(input);
  const seats = input.seats.map((seat, i) => ({
    ...seat,
    score: seat.score + (adjustments[i] ?? 0),
  }));

  const teamScores = config.teams.map((team) =>
    team.reduce((sum, s) => sum + (seats[s]?.score ?? 0), 0),
  );
  const activeTeam = config.teams.map((team) => team.every((s) => seats[s]?.status === 'active'));
  const activeCount = activeTeam.filter(Boolean).length;

  // "1224" ranking: active teams by score; non-active teams share the place after them (Q-GD-3).
  const places = teamScores.map((score, t) => {
    if (!activeTeam[t]) return activeCount + 1;
    return 1 + teamScores.filter((other, u) => activeTeam[u] && other > score).length;
  });

  let decidedBy: MatchResult['decidedBy'] = end.reason === 'resign' ? 'resign' : 'score';
  const tied = places.flatMap((place, t) => (place === 1 ? [t] : []));
  if (config.requireWinner === 1 && tied.length > 1) {
    // (1) best single-turn score of the team (max over members).
    const best = (t: number): number =>
      Math.max(...(config.teams[t] ?? []).map((s) => seats[s]?.bestTurnScore ?? 0));
    const top = Math.max(...tied.map(best));
    let contenders = tied.filter((t) => best(t) === top);
    decidedBy = 'tiebreak_best_turn';
    if (contenders.length > 1) {
      // (2) the team whose earliest-moving seat moves latest (Q-GD-4; 1v1: the seat that did not move first).
      const firstMover = (t: number): number =>
        Math.min(...(config.teams[t] ?? []).map((s) => turnPosition(s, firstSeat, config.seats)));
      const latest = Math.max(...contenders.map(firstMover));
      contenders = contenders.filter((t) => firstMover(t) === latest);
      decidedBy = 'tiebreak_second_mover';
    }
    for (const t of tied) places[t] = contenders.includes(t) ? 1 : 2;
  }

  return { seats, result: { end, adjustments, teamScores, places, decidedBy } };
}
