/**
 * `createMatch` (API note §13.1, §7.2): validates a `MatchConfig`, draws the first seat, shuffles and deals.
 * Same config ⇒ deep-equal state (P-CORE-001-c).
 */
import { err, ok, type Result } from '@codelex/config/result';
import { engineError, lexiconMismatch, rulesVersionError } from '../errors.js';
import { deriveRng } from '../rng/index.js';
import { getLayout, getLetterTable, RULES } from '../rules/constants.js';
import { chars, EMPTY_SQUARE, initialBag, sortTiles } from '../tiles.js';
import type {
  BoardRow,
  EngineContext,
  EngineError,
  MatchConfig,
  MatchEvent,
  MatchSetup,
  MatchState,
  SeatState,
} from '../types.js';
import { ENGINE_RULES_VERSION } from '../version.js';

/** RNG stream names of ADR-0013 §D1. */
export const BAG_STREAM = 'bag';
export const FIRST_PLAYER_STREAM = 'first-player';

const HEX16 = /^[0-9a-f]{16}$/;
/** Printable ASCII without spaces: profile ids are identifiers (`global-ranked`, `org-<id>`). */
const PROFILE_ID = /^[\x21-\x7e]{1,128}$/;

const CONFIG_KEYS = [
  'config',
  'definitionHash',
  'engineRulesVersion',
  'lexiconVersion',
  'profileId',
  'seed',
];
const SETUP_KEYS = ['format', 'layout', 'letters', 'mode', 'requireWinner', 'seats', 'teams'];

/** Canonical team partitions per seat count (API note §6). */
const CANONICAL_TEAMS: Readonly<Record<number, readonly string[]>> = {
  2: ['[[0],[1]]'],
  3: ['[[0],[1],[2]]'],
  4: ['[[0],[1],[2],[3]]', '[[0,2],[1,3]]'],
};

export function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** First key of `value` outside `allowed` or missing from it, in sorted order (deterministic reporting). */
export function keyProblem(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): string | undefined {
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const extra = keys.find((k) => !allowed.includes(k));
  if (extra !== undefined) return extra;
  return allowed.find((k) => !Object.hasOwn(value, k));
}

function invalid(field: string): EngineError {
  return engineError('INVALID_CONFIG', `invalid match config at ${field}`, { field });
}

function teamsKey(teams: unknown): string | undefined {
  if (!Array.isArray(teams)) return undefined;
  const parts: string[] = [];
  for (const team of teams as readonly unknown[]) {
    if (!Array.isArray(team)) return undefined;
    const seats = team as readonly unknown[];
    if (!seats.every((s) => Number.isSafeInteger(s))) return undefined;
    parts.push(`[${seats.join(',')}]`);
  }
  return `[${parts.join(',')}]`;
}

/** Returns the first invalid field of the config (shape and values of API note §6), or undefined. */
export function configProblem(config: MatchConfig): string | undefined {
  if (!isPlainObject(config)) return '';
  const top = keyProblem(config, CONFIG_KEYS);
  if (top !== undefined) return top;
  if (typeof config.seed !== 'string' || !HEX16.test(config.seed)) return 'seed';
  if (typeof config.lexiconVersion !== 'string' || !HEX16.test(config.lexiconVersion)) {
    return 'lexiconVersion';
  }
  if (typeof config.profileId !== 'string' || !PROFILE_ID.test(config.profileId))
    return 'profileId';
  if (typeof config.definitionHash !== 'string' || !HEX16.test(config.definitionHash)) {
    return 'definitionHash';
  }
  const setup: unknown = config.config;
  if (!isPlainObject(setup)) return 'config';
  const inner = keyProblem(setup, SETUP_KEYS);
  if (inner !== undefined) return `config.${inner}`;
  if (setup['mode'] !== 'classic') return 'config.mode';
  const format = setup['format'];
  if (format !== 'untimed-vs-bot' && format !== 'untimed') return 'config.format';
  const seats = setup['seats'];
  if (typeof seats !== 'number' || !Number.isSafeInteger(seats) || seats < 2 || seats > 4) {
    return 'config.seats';
  }
  if (format === 'untimed-vs-bot' && seats !== 2) return 'config.seats';
  const key = teamsKey(setup['teams']);
  if (key === undefined || !(CANONICAL_TEAMS[seats] ?? []).includes(key)) return 'config.teams';
  if (setup['layout'] !== 'classic-v1') return 'config.layout';
  if (setup['letters'] !== 'letters-v1') return 'config.letters';
  const requireWinner = setup['requireWinner'];
  if (requireWinner !== 0 && requireWinner !== 1) return 'config.requireWinner';
  return undefined;
}

/** A plain copy of the setup (the state never aliases caller objects). */
function copySetup(setup: MatchSetup): MatchSetup {
  return {
    mode: setup.mode,
    format: setup.format,
    seats: setup.seats,
    teams: setup.teams.map((team) => [...team]),
    layout: setup.layout,
    letters: setup.letters,
    requireWinner: setup.requireWinner,
  };
}

/**
 * Creates a match. Checks, in order: `engineRulesVersion` (`RULES_VERSION_UNSUPPORTED`), shape and values of
 * the config (`INVALID_CONFIG`, `details.field`), lexicon identity (`LEXICON_MISMATCH`). Then: first seat from
 * the `first-player` stream (R-CORE-004), bag = `letters-v1` multiset in ascending order shuffled with the `bag`
 * stream, 7 tiles dealt per seat from the head, seat 0 first (R-BAG-005), racks sorted.
 */
export function createMatch(
  config: MatchConfig,
  ctx: EngineContext,
): Result<{ readonly state: MatchState; readonly events: readonly MatchEvent[] }, EngineError> {
  const version: unknown = isPlainObject(config) ? config.engineRulesVersion : undefined;
  if (version !== ENGINE_RULES_VERSION) return err(rulesVersionError(version));
  const problem = configProblem(config);
  if (problem !== undefined) return err(invalid(problem));
  const mismatch = lexiconMismatch(config, ctx);
  if (mismatch !== undefined) return err(mismatch);

  const setup = copySetup(config.config);
  const seed = config.seed;
  const firstSeat = deriveRng(seed, FIRST_PLAYER_STREAM).int(0, setup.seats);

  const bagRng = deriveRng(seed, BAG_STREAM);
  const fullBag = initialBag(getLetterTable(setup.letters));
  let bag = bagRng.shuffle(chars(fullBag)).join('');
  const [s0, s1, s2, s3] = bagRng.state();

  const events: MatchEvent[] = [{ type: 'MATCH_STARTED', firstSeat, bagCount: fullBag.length }];
  const seats: SeatState[] = [];
  for (let seat = 0; seat < setup.seats; seat += 1) {
    const drawn = bag.slice(0, RULES.rackSize);
    bag = bag.slice(RULES.rackSize);
    const rack = sortTiles(drawn);
    seats.push({ rack, score: 0, chainK: 0, lastMainForm: '', bestTurnScore: 0, status: 'active' });
    events.push({
      type: 'TILES_DRAWN',
      seat,
      cause: 'deal',
      count: drawn.length,
      tiles: rack,
      bagCount: bag.length,
    });
  }
  events.push({ type: 'TURN_STARTED', seat: firstSeat, turnNumber: 0 });

  const layout = getLayout(setup.layout);
  const emptyRow: BoardRow = EMPTY_SQUARE.repeat(layout.size);
  const state: MatchState = {
    engineRulesVersion: ENGINE_RULES_VERSION,
    seed,
    lexiconVersion: config.lexiconVersion,
    profileId: config.profileId,
    definitionHash: config.definitionHash,
    config: setup,
    firstSeat,
    status: 'in_progress',
    seatOnTurn: firstSeat,
    turnNumber: 0,
    scorelessTurns: 0,
    actionCount: 0,
    board: new Array<BoardRow>(layout.size).fill(emptyRow),
    bag,
    rng: { bag: [s0, s1, s2, s3] },
    seats,
  };
  return ok({ state, events });
}
