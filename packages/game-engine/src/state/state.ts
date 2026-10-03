/**
 * State serialisation and hash (API note §13.6, ADR-0013 §D3): `serializeState` is the JCS text of the state,
 * `stateHash` its truncated SHA-256, `parseState` the only trusted re-entry point for a persisted state. It checks
 * every field and invariant (shapes, ranges, sorted racks, tile conservation, `result` iff finished).
 */
import { err, ok, type Result } from '@codelex/config/result';
import { engineError, rulesVersionError } from '../errors.js';
import { canonicalJson, hash16, isJcsInteger } from '../hash/jcs.js';
import { configProblem, isPlainObject, keyProblem } from '../match/create.js';
import { getLayout, getLetterTable, RULES } from '../rules/constants.js';
import { finishMatch } from '../scoring/end.js';
import { countTiles, initialBag, isBlankOnBoard, sortTiles } from '../tiles.js';
import type {
  EngineError,
  MatchConfig,
  MatchResult,
  MatchState,
  SeatState,
  StateHash,
} from '../types.js';
import { ENGINE_RULES_VERSION } from '../version.js';

/** The JCS text of the state: the hashed bytes. Throws on a value outside the ADR-0013 subset. */
export function serializeState(state: MatchState): string {
  return canonicalJson(state);
}

/** `hex(SHA-256(JCS(state)))[0..16)`; computed on demand only, never inside `apply`. */
export function stateHash(state: MatchState): StateHash {
  return hash16(state) as StateHash;
}

const STATE_KEYS = [
  'actionCount',
  'bag',
  'board',
  'config',
  'definitionHash',
  'engineRulesVersion',
  'firstSeat',
  'lexiconVersion',
  'profileId',
  'rng',
  'scorelessTurns',
  'seatOnTurn',
  'seats',
  'seed',
  'status',
  'turnNumber',
];
const SEAT_KEYS = ['bestTurnScore', 'chainK', 'lastMainForm', 'rack', 'score', 'status'];
const RESULT_KEYS = ['adjustments', 'decidedBy', 'end', 'places', 'teamScores'];
/** v1 produces only these; 'forfeited' (Blitz) and 'eliminated' (Arena) are reserved (API note §7). */
const SEAT_STATUSES = ['active', 'resigned'];
const DECIDED_BY = ['score', 'resign', 'tiebreak_best_turn', 'tiebreak_second_mover'];
const RACK = /^[?A-Z]*$/;
const BOARD_ROW = /^[.A-Za-z]+$/;
const FORM = /^[A-Z]{2,15}$/;
const TWO_POW_32 = 0x1_0000_0000;
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// `JSON.parse('-0')` is `-0`, which the JCS subset rejects (ADR-0013 §D3): never accept it.
const isInt = (x: unknown): x is number => isJcsInteger(x);
const isCount = (x: unknown): x is number => isInt(x) && x >= 0;
const isU32 = (x: unknown): boolean => isCount(x) && x < TWO_POW_32;
const intArray = (x: unknown, length: number): boolean =>
  Array.isArray(x) && x.length === length && (x as unknown[]).every(isInt);

function seatProblem(value: unknown, index: number): string | undefined {
  const path = `seats[${String(index)}]`;
  if (!isPlainObject(value)) return path;
  const key = keyProblem(value, SEAT_KEYS);
  if (key !== undefined) return `${path}.${key}`;
  const rack = value['rack'];
  if (
    typeof rack !== 'string' ||
    !RACK.test(rack) ||
    rack.length > RULES.rackSize ||
    sortTiles(rack) !== rack
  ) {
    return `${path}.rack`;
  }
  if (!isInt(value['score'])) return `${path}.score`;
  const chainK = value['chainK'];
  if (!isCount(chainK) || chainK > RULES.chainCap) return `${path}.chainK`;
  const form = value['lastMainForm'];
  if (typeof form !== 'string' || (form !== '' && !FORM.test(form))) return `${path}.lastMainForm`;
  // R-SCORE-005: a chain extends a previous main word, so k > 0 needs one.
  if (chainK > 0 && form === '') return `${path}.chainK`;
  if (!isCount(value['bestTurnScore'])) return `${path}.bestTurnScore`;
  if (!SEAT_STATUSES.includes(value['status'] as string)) return `${path}.status`;
  return undefined;
}

function resultProblem(value: unknown, seats: number, teams: number): string | undefined {
  if (!isPlainObject(value)) return 'result';
  const key = keyProblem(value, RESULT_KEYS);
  if (key !== undefined) return `result.${key}`;
  const end = value['end'];
  if (!isPlainObject(end)) return 'result.end';
  const reason = end['reason'];
  if (reason === 'scoreless_turns') {
    if (keyProblem(end, ['reason']) !== undefined) return 'result.end';
  } else if (reason === 'going_out' || reason === 'resign') {
    const seat = end['seat'];
    if (keyProblem(end, ['reason', 'seat']) !== undefined || !isCount(seat) || seat >= seats) {
      return 'result.end';
    }
  } else {
    return 'result.end';
  }
  if (!intArray(value['adjustments'], seats)) return 'result.adjustments';
  if (!intArray(value['teamScores'], teams)) return 'result.teamScores';
  const places = value['places'];
  if (!intArray(places, teams) || !(places as number[]).every((p) => p >= 1 && p <= teams)) {
    return 'result.places';
  }
  if (!DECIDED_BY.includes(value['decidedBy'] as string)) return 'result.decidedBy';
  return undefined;
}

/** First invalid field of a parsed state document, or undefined. */
function stateProblem(doc: Readonly<Record<string, unknown>>): string | undefined {
  // First unknown key in code-unit order, not in document order (deterministic reporting).
  const extra = Object.keys(doc)
    .sort(byCodeUnit)
    .find((k) => !STATE_KEYS.includes(k) && k !== 'result');
  if (extra !== undefined) return extra;
  const missing = STATE_KEYS.find((k) => !Object.hasOwn(doc, k));
  if (missing !== undefined) return missing;

  const config = configProblem({
    seed: doc['seed'],
    engineRulesVersion: doc['engineRulesVersion'],
    lexiconVersion: doc['lexiconVersion'],
    profileId: doc['profileId'],
    definitionHash: doc['definitionHash'],
    config: doc['config'],
  } as unknown as MatchConfig);
  if (config !== undefined) return config;
  const setup = doc['config'] as MatchConfig['config'];
  const seatCount = setup.seats;

  const status = doc['status'];
  if (status !== 'in_progress' && status !== 'finished') return 'status';
  for (const key of ['firstSeat', 'seatOnTurn']) {
    const seat = doc[key];
    if (!isCount(seat) || seat >= seatCount) return key;
  }
  for (const key of ['turnNumber', 'scorelessTurns', 'actionCount']) {
    if (!isCount(doc[key])) return key;
  }

  const layout = getLayout(setup.layout);
  const board = doc['board'];
  if (
    !Array.isArray(board) ||
    board.length !== layout.size ||
    !(board as unknown[]).every(
      (r) => typeof r === 'string' && r.length === layout.size && BOARD_ROW.test(r),
    )
  ) {
    return 'board';
  }
  const bag = doc['bag'];
  if (typeof bag !== 'string' || !RACK.test(bag)) return 'bag';
  const rng = doc['rng'];
  if (!isPlainObject(rng) || keyProblem(rng, ['bag']) !== undefined) return 'rng';
  const words = rng['bag'];
  if (
    !Array.isArray(words) ||
    words.length !== 4 ||
    !(words as unknown[]).every(isU32) ||
    (words as number[]).every((w) => w === 0)
  ) {
    return 'rng.bag';
  }

  const seats = doc['seats'];
  if (!Array.isArray(seats) || seats.length !== seatCount) return 'seats';
  for (let i = 0; i < seatCount; i += 1) {
    const problem = seatProblem((seats as unknown[])[i], i);
    if (problem !== undefined) return problem;
  }

  // R-BAG-004: board ∪ racks ∪ bag = initial bag (blanks counted as blanks).
  let all = bag + (seats as { rack: string }[]).map((s) => s.rack).join('');
  for (const line of board as string[]) {
    for (let c = 0; c < line.length; c += 1) {
      const tile = line.charAt(c);
      if (tile !== '.') all += isBlankOnBoard(tile) ? '?' : tile;
    }
  }
  const expected = countTiles(initialBag(getLetterTable(setup.letters)));
  const actual = countTiles(all);
  if (expected.some((n, slot) => actual[slot] !== n)) return 'conservation';

  const hasResult = Object.hasOwn(doc, 'result');
  if (hasResult !== (status === 'finished')) return 'result';
  if (!hasResult) return progressProblem(doc as unknown as MatchState);
  const shape = resultProblem(doc['result'], seatCount, setup.teams.length);
  if (shape !== undefined) return shape;
  const state = doc as unknown as MatchState;
  return finishedProblem(state, doc['result'] as MatchResult);
}

const isActive = (seat: SeatState | undefined): boolean => seat?.status === 'active';

function activeTeamCount(state: MatchState): number {
  return state.config.teams.filter((team) => team.every((s) => isActive(state.seats[s]))).length;
}

/** In progress: the seat on turn can act and the match is not already over by R-END-002 (no wedged state). */
function progressProblem(state: MatchState): string | undefined {
  if (!isActive(state.seats[state.seatOnTurn])) return 'seatOnTurn';
  if (activeTeamCount(state) < 2) return 'seats';
  return undefined;
}

/**
 * Finished: the end reason must be possible for these seats (R-END-001, R-END-002, R-TURN-004), and the rest of
 * the result must be exactly what `finishMatch` computes from the seats (R-SCORE-006, R-END-003). Racks, statuses
 * and best turns are final; scores before the end adjustments are `score − adjustment`.
 */
function finishedProblem(state: MatchState, result: MatchResult): string | undefined {
  const { end } = result;
  const activeTeams = activeTeamCount(state);
  if (end.reason === 'resign') {
    if (isActive(state.seats[end.seat]) || activeTeams >= 2) return 'result.end';
  } else if (activeTeams < 2) {
    return 'result.end';
  } else if (end.reason === 'going_out') {
    const seat = state.seats[end.seat];
    if (!isActive(seat) || seat?.rack !== '' || state.bag !== '') return 'result.end';
  } else {
    const activeSeats = state.seats.filter(isActive).length;
    if (state.scorelessTurns < RULES.scorelessTurnsPerSeat * activeSeats) return 'result.end';
  }
  const expected = finishMatch({
    config: state.config,
    firstSeat: state.firstSeat,
    seats: state.seats.map((s, i) => ({ ...s, score: s.score - (result.adjustments[i] ?? 0) })),
    end,
  }).result;
  for (const key of ['adjustments', 'teamScores', 'places', 'decidedBy'] as const) {
    if (canonicalJson(expected[key]) !== canonicalJson(result[key])) return `result.${key}`;
  }
  return undefined;
}

function malformedState(field: string): EngineError {
  return engineError('MALFORMED_STATE', `malformed state at ${field === '' ? '<root>' : field}`, {
    field,
  });
}

/**
 * Parses a persisted state. `RULES_VERSION_UNSUPPORTED` is checked before `MALFORMED_STATE`. Returns a state
 * deep-equal to the one serialised (P-GLOBAL-04).
 */
export function parseState(text: string): Result<MatchState, EngineError> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return err(malformedState(''));
  }
  if (!isPlainObject(doc)) return err(malformedState(''));
  if (doc['engineRulesVersion'] !== ENGINE_RULES_VERSION) {
    return err(rulesVersionError(doc['engineRulesVersion']));
  }
  const problem = stateProblem(doc);
  if (problem !== undefined) return err(malformedState(problem));
  return ok(doc as unknown as MatchState);
}
