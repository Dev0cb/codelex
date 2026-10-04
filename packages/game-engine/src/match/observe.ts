/**
 * Per-viewer projections (API note §10, §13.3–§13.5): `observe`, `eventsFor`, and the two functions that work
 * on an observation only, `evaluateMove` (bots, API-6) and `previewScore` (R-SCORE-009, API-7). An observation
 * holds no seed, no RNG state, no bag order and no other rack (P-GLOBAL-07).
 */
import { err, ok, type Result } from '@codelex/config/result';
import { parseAction } from '../actions/parse.js';
import { lexiconMismatch, malformed, matchOver, notYourTurn } from '../errors.js';
import { checkPlacement, checkPlacementGeometry } from '../placement/check.js';
import { getLayout, getLetterTable } from '../rules/constants.js';
import { isRulesVersion, resolveRules, rulesFor } from '../rules/registry.js';
import { previewPlacement, scorePlacement } from '../scoring/score.js';
import { BLANK_SLOT, countTiles, isBlankOnBoard } from '../tiles.js';
import type {
  ApplyFailure,
  EngineContext,
  MatchEvent,
  MatchState,
  MoveEvaluation,
  Observation,
  PlaceWordAction,
  Placement,
  PreviewScore,
  SeatView,
  Viewer,
} from '../types.js';
import { comparePlacements } from '../actions/parse.js';

const CODE_A = 65;

/** Tiles the viewer cannot see: initial bag − board − own rack, as 27 counts (blank at 26). */
function unseenCounts(state: MatchState, ownRack: string): number[] {
  const letters = getLetterTable(state.config.letters);
  const unseen = [...letters.counts, letters.blanks];
  const own = countTiles(ownRack);
  for (let slot = 0; slot <= BLANK_SLOT; slot += 1)
    unseen[slot] = (unseen[slot] ?? 0) - (own[slot] ?? 0);
  for (const row of state.board) {
    for (let col = 0; col < row.length; col += 1) {
      const tile = row.charAt(col);
      if (tile === '.') continue;
      const slot = isBlankOnBoard(tile) ? BLANK_SLOT : tile.charCodeAt(0) - CODE_A;
      unseen[slot] = (unseen[slot] ?? 0) - 1;
    }
  }
  return unseen;
}

/**
 * What `viewer` may know of `state`. A seat outside the match is a programmer error (throws `RangeError`).
 * Two states that differ only in hidden information give deep-equal observations (P-API-03).
 */
export function observe(state: MatchState, viewer: Viewer): Observation {
  if (
    viewer !== 'spectator' &&
    (!Number.isSafeInteger(viewer) || state.seats[viewer] === undefined)
  ) {
    throw new RangeError('observe: viewer is not a seat of this match');
  }
  const rack = viewer === 'spectator' ? '' : (state.seats[viewer]?.rack ?? '');
  const teamOf = (seat: number): number =>
    state.config.teams.findIndex((team) => team.includes(seat));
  const seats: SeatView[] = state.seats.map((s, seat) => ({
    seat,
    team: teamOf(seat),
    rackCount: s.rack.length,
    score: s.score,
    chainK: s.chainK,
    lastMainForm: s.lastMainForm,
    bestTurnScore: s.bestTurnScore,
    status: s.status,
  }));
  const observation: Observation = {
    engineRulesVersion: state.engineRulesVersion,
    lexiconVersion: state.lexiconVersion,
    profileId: state.profileId,
    definitionHash: state.definitionHash,
    config: state.config,
    viewer,
    status: state.status,
    firstSeat: state.firstSeat,
    seatOnTurn: state.seatOnTurn,
    turnNumber: state.turnNumber,
    scorelessTurns: state.scorelessTurns,
    actionCount: state.actionCount,
    board: state.board,
    bagCount: state.bag.length,
    rack,
    unseen: unseenCounts(state, rack),
    seats,
    teamScores: state.config.teams.map((team) =>
      team.reduce((sum, s) => sum + (state.seats[s]?.score ?? 0), 0),
    ),
  };
  if (state.result === undefined) return observation;
  return { ...observation, result: state.result, finalRacks: state.seats.map((s) => s.rack) };
}

/** Each viewer's copy of `events`: other seats' drawn and returned tiles are removed (P-API-04). */
export function eventsFor(events: readonly MatchEvent[], viewer: Viewer): readonly MatchEvent[] {
  return events.map((event) => {
    if (event.type === 'TILES_DRAWN' && event.seat !== viewer) {
      return {
        type: event.type,
        seat: event.seat,
        cause: event.cause,
        count: event.count,
        bagCount: event.bagCount,
      };
    }
    if (event.type === 'TILES_EXCHANGED' && event.seat !== viewer) {
      return { type: event.type, seat: event.seat, count: event.count };
    }
    return event;
  });
}

/**
 * The bots' only scoring path (API note §13.4): the checks and arithmetic of `apply` for a PLACE_WORD by
 * `observation.viewer`, minus the turn check. P-API-01: same acceptance, rejection and breakdown as `apply`.
 */
export function evaluateMove(
  observation: Observation,
  action: PlaceWordAction,
  ctx: EngineContext,
): Result<MoveEvaluation, ApplyFailure> {
  // Same resolution as `apply` (draft opt-in and candidate included), so P-API-01 holds for every version.
  const resolved = resolveRules(observation.engineRulesVersion, ctx.draft);
  if (!resolved.ok) return resolved;
  const { rules } = resolved.value;
  const mismatch = lexiconMismatch(observation, ctx);
  if (mismatch !== undefined) return err(mismatch);
  if (observation.status === 'finished') return err(matchOver());
  const parsed = parseAction(action, observation.config.seats);
  if (!parsed.ok) return parsed;
  const canonical = parsed.value;
  if (canonical.type !== 'PLACE_WORD') return err(malformed('unknown_type', 'type'));
  if (observation.viewer === 'spectator' || canonical.seat !== observation.viewer) {
    return err(malformed('seat_out_of_range', 'seat'));
  }
  const seat = observation.seats[canonical.seat];
  if (seat === undefined || seat.status !== 'active') {
    return err(notYourTurn(observation.seatOnTurn, true));
  }
  const layout = getLayout(observation.config.layout);
  const placement = checkPlacement(
    { board: observation.board, layout, rack: observation.rack, tiles: canonical.tiles, rules },
    ctx.lexicon,
  );
  if (!placement.ok) return placement;
  const breakdown = scorePlacement(
    placement.value,
    layout,
    getLetterTable(observation.config.letters),
    seat,
    ctx.lexicon,
    rules,
  );
  return ok({
    action: canonical,
    breakdown,
    leave: placement.value.rackAfter,
    goesOut: placement.value.rackAfter === '' && observation.bagCount === 0,
  });
}

/**
 * R-SCORE-009: projected score of a tentative placement for the viewer, or `null` when the match is over, the
 * viewer is a spectator or no longer active, the version is not registered, or the placement fails geometry or
 * the viewer's rack (P-SCORE-009-d). No lexicon and no context: it reads the set's default `rules`, whose rack
 * size, first-move minimum and Full Stack are literal types shared by every candidate (ADR-0014 §D2); a
 * candidate only changes the term bonus, which a preview never shows.
 */
export function previewScore(
  observation: Observation,
  tiles: readonly Placement[],
): PreviewScore | null {
  if (observation.status === 'finished' || observation.viewer === 'spectator') return null;
  if (!isRulesVersion(observation.engineRulesVersion)) return null;
  const { rules } = rulesFor(observation.engineRulesVersion);
  // A resigned seat can never move again: no preview (review R1 n7).
  if (observation.seats[observation.viewer]?.status !== 'active') return null;
  const parsed = parseAction(
    { seat: observation.viewer, type: 'PLACE_WORD', tiles },
    observation.config.seats,
  );
  if (!parsed.ok || parsed.value.type !== 'PLACE_WORD') return null;
  const layout = getLayout(observation.config.layout);
  const geometry = checkPlacementGeometry({
    board: observation.board,
    layout,
    rack: observation.rack,
    tiles: [...parsed.value.tiles].sort(comparePlacements),
    rules,
  });
  if (!geometry.ok) return null;
  return previewPlacement(
    geometry.value.words,
    geometry.value.tiles.length,
    layout,
    getLetterTable(observation.config.letters),
    rules,
  );
}
