/**
 * B4 match player (docs/specs/E-1.3-bots/strategist.md § ST-x): the B2 simulator's host loop (`simulate.ts`, left
 * unchanged for B3) with what the Strategist readouts need per decision, and simulator-only bot variants (tuning
 * candidates, the ST-2 ablated Strategist). `engineRulesVersion` 1 only (`matchConfig`), every match replayed to
 * identical hashes. Integer-only and deterministic like the rest of `sim/`.
 */
import {
  apply,
  createMatch,
  getLayout,
  getLetterTable,
  newActionLog,
  observe,
  replay,
  stateHash,
  type Action,
  type MatchState,
  type SeedHex,
  type SquareKind,
  type StateHash,
  type WordScore,
} from '@codelex/game-engine';
import { deriveRng } from '@codelex/game-engine/rng';
import {
  GLOBAL_PROFILE,
  lexiconContentDocument,
  profileDefinitionHash,
} from '@codelex/lexicon/canonical';
import {
  buildLexiconIndex,
  decodeLexiconIndex,
  type LexiconIndex,
  type LexiconVersion,
  type ReferenceTermInput,
} from '@codelex/lexicon/index';
import { loadLexicon } from '@codelex/lexicon/validate';
import { codeOf, EMPTY } from '../src/board.js';
import { decide, type DecideOptions } from '../src/choose.js';
import { PERSONALITIES, type BotPersonalityId, type PersonalityData } from '../src/index.js';
import { STRATEGIST_STRATEGY } from '../src/personalities.js';
import { leadOf } from '../src/policy/strategist.js';
import { isHot, withTiles } from '../src/strategy/lanes.js';
import { rawLeave, tileCounts } from '../src/strategy/leave.js';
import { matchConfig, SimulationError } from './simulate.js';

/** A simulated bot: a personality plus simulator-only decision options; never a new public personality id. */
export interface SimBot {
  /** Report key; equal to the personality for plain bots. */
  readonly id: string;
  readonly personality: BotPersonalityId;
  /** Personality-data override (`BotContext.data`): tuning candidates. */
  readonly data?: PersonalityData;
  readonly options?: DecideOptions;
}

export type Player = BotPersonalityId | SimBot;

export function simBot(player: Player): SimBot {
  return typeof player === 'string' ? { id: player, personality: player } : player;
}

export interface B4Turn {
  readonly seat: number;
  readonly bagCount: number;
  /** `obs.scorelessTurns` at the decision (ST-4b, P-BOT-09). */
  readonly scorelessTurns: number;
  /** Own team score minus the best other team score at the decision (ST-4c). */
  readonly lead: number;
  /** Blanks on the rack at the decision (two-blank attribution of `budgetExhausted`, BG-5 / ST-5). */
  readonly rackBlanks: number;
  readonly type: Action['type'];
  /** EXCHANGE chosen by Strategist's X-1..X-5 rule rather than forced (ST-4b). */
  readonly voluntaryExchange: boolean;
  readonly nodesUsed: number;
  readonly candidatesEvaluated: number;
  readonly budgetExhausted: boolean;
  /** PLACE_WORD only. */
  readonly points?: number;
  readonly mainDifficulty?: WordScore['difficulty'];
  /** `raw(leave)` with the frozen Strategist leave data, whoever played (ST-4a). */
  readonly leaveRaw?: number;
  /** TW squares hot after the move that were not hot before it (ST-4c). */
  readonly hotTwOpened?: number;
  /** R-SCORE-005 k after the move; > 0 iff the main word extended a chain (ST-4d). */
  readonly chainKAfter?: number;
}

export interface B4Match {
  readonly seed: string;
  /** Bot id per seat. */
  readonly seats: readonly string[];
  readonly firstSeat: number;
  readonly endReason: 'going_out' | 'scoreless_turns' | 'resign';
  readonly scores: readonly number[];
  readonly places: readonly number[];
  readonly bagAtEnd: number;
  readonly rackTilesAtEnd: number;
  readonly finalHash: string;
  readonly turns: readonly B4Turn[];
}

function boardCodes(board: readonly string[], size: number): number[] {
  const codes: number[] = [];
  for (let row = 0; row < size; row += 1) {
    const line = board[row] ?? '';
    for (let col = 0; col < size; col += 1) codes.push(codeOf(line.charAt(col)));
  }
  return codes;
}

/** Hot TW squares of a board (spec S-2 definition, frozen Strategist reach). */
function hotTw(
  codes: readonly number[],
  squares: readonly SquareKind[],
  size: number,
): Set<number> {
  const hot = new Set<number>();
  for (let sq = 0; sq < size * size; sq += 1) {
    if (squares[sq] !== 'TW' || codes[sq] !== EMPTY) continue;
    const row = Math.floor(sq / size);
    if (isHot(codes, size, row, sq - row * size, STRATEGIST_STRATEGY.laneReach)) hot.add(sq);
  }
  return hot;
}

/** Plays one match to the end; throws `SimulationError` on any contract breach (P-BOT-01, replay). */
export function playB4Match(
  lexicon: LexiconIndex,
  seed: SeedHex,
  seats: readonly Player[],
  maxActions = 1_000,
): B4Match {
  const bots = seats.map(simBot);
  const config = matchConfig(lexicon, seed);
  const layout = getLayout(config.config.layout);
  const values = getLetterTable(config.config.letters).values;
  const created = createMatch(config, { lexicon });
  if (!created.ok) throw new SimulationError('BOT_ERROR', `createMatch: ${created.error.code}`);
  let state: MatchState = created.value.state;
  const actions: Action[] = [];
  const hashes: StateHash[] = [];
  const turns: B4Turn[] = [];
  while (state.status === 'in_progress') {
    if (state.actionCount >= maxActions) {
      throw new SimulationError('MATCH_TOO_LONG', `seed ${seed}: over ${String(maxActions)}`);
    }
    const seat = state.seatOnTurn;
    const bot = bots[seat] ?? simBot('random-legal');
    const options = bot.options ?? {};
    const obs = observe(state, seat);
    const decided = decide(
      obs,
      {
        lexicon,
        rng: deriveRng(seed, `bot:${String(seat)}:${String(obs.actionCount)}`),
        personality: bot.personality,
        budget: (bot.data ?? PERSONALITIES[bot.personality]).budget,
        ...(bot.data === undefined ? {} : { data: bot.data }),
      },
      options,
    );
    if (!decided.ok) throw new SimulationError('BOT_ERROR', `seed ${seed}: ${decided.error.code}`);
    const { decision, voluntaryExchange } = decided.value;
    const applied = apply(state, decision.action, { lexicon });
    if (!applied.ok) {
      throw new SimulationError(
        'APPLY_REJECTED',
        `seed ${seed}, action ${String(state.actionCount)} (${bot.id}): ${applied.error.code}`,
      );
    }
    state = applied.value.state;
    actions.push(applied.value.action);
    hashes.push(stateHash(state));
    const base: B4Turn = {
      seat,
      bagCount: obs.bagCount,
      scorelessTurns: obs.scorelessTurns,
      lead: leadOf(obs),
      rackBlanks: Array.from(obs.rack).filter((t) => t === '?').length,
      type: decision.action.type,
      voluntaryExchange,
      nodesUsed: decision.nodesUsed,
      candidatesEvaluated: decision.candidatesEvaluated,
      budgetExhausted: decision.budgetExhausted,
    };
    const placed = applied.value.events.find((e) => e.type === 'WORD_PLACED');
    if (placed?.type === 'WORD_PLACED' && decision.action.type === 'PLACE_WORD') {
      const { tiles } = decision.action;
      let leave = obs.rack;
      for (const t of tiles) {
        const at = leave.indexOf(t.tile >= 'a' ? '?' : t.tile);
        leave = leave.slice(0, at) + leave.slice(at + 1);
      }
      const codes = boardCodes(obs.board, layout.size);
      const before = hotTw(codes, layout.squares, layout.size);
      const after = hotTw(withTiles(codes, layout.size, tiles), layout.squares, layout.size);
      let opened = 0;
      for (const sq of after) if (!before.has(sq)) opened += 1;
      const main = placed.breakdown.words.find((w) => w.main);
      turns.push({
        ...base,
        points: placed.breakdown.total,
        ...(main === undefined ? {} : { mainDifficulty: main.difficulty }),
        leaveRaw: rawLeave(tileCounts(leave), values, STRATEGIST_STRATEGY),
        hotTwOpened: opened,
        chainKAfter: placed.breakdown.chainKAfter,
      });
    } else {
      turns.push(base);
    }
  }
  const result = state.result;
  if (result === undefined) throw new SimulationError('BOT_ERROR', `seed ${seed}: no result`);
  const finalHash = stateHash(state);
  const log = {
    ...newActionLog(config),
    actions,
    stateHashes: hashes,
    final: { stateHash: finalHash, actionCount: actions.length },
  };
  const replayed = replay(log, { lexicon });
  if (!replayed.ok || replayed.value.finalHash !== finalHash) {
    throw new SimulationError('REPLAY_MISMATCH', `seed ${seed}: replay differs`);
  }
  return {
    seed,
    seats: bots.map((b) => b.id),
    firstSeat: state.firstSeat,
    endReason: result.end.reason,
    scores: state.seats.map((s) => s.score),
    places: [...result.places],
    bagAtEnd: state.bag.length,
    rackTilesAtEnd: state.seats.reduce((a, s) => a + s.rack.length, 0),
    finalHash,
    turns,
  };
}

// --- lexicons ---

function decoded(
  version: string,
  profile: { readonly id: string; readonly kind: 'global'; readonly definitionHash: string },
  terms: readonly ReferenceTermInput[],
  blocklist: readonly string[],
  gaddag: boolean,
): LexiconIndex {
  const built = buildLexiconIndex(
    { version, profile, document: { terms }, blocklist },
    { formatVersion: 1, gaddag },
  );
  if (!built.ok) throw new Error(`buildLexiconIndex: ${built.error.code} ${built.error.message}`);
  const index = decodeLexiconIndex(built.value, {
    version: version as LexiconVersion,
    profileId: profile.id,
  });
  if (!index.ok) throw new Error(`decodeLexiconIndex: ${index.error.code}`);
  return index.value;
}

/** The lexicon on `main` (`global-ranked`) as a built `.clxi`: f1 (with the GADDAG section) or f0 (without). */
export function mainLexicon(gaddag: boolean): LexiconIndex {
  const lex = loadLexicon();
  return decoded(
    lex.version,
    {
      id: GLOBAL_PROFILE.id,
      kind: 'global',
      definitionHash: profileDefinitionHash(GLOBAL_PROFILE),
    },
    lexiconContentDocument(lex).terms,
    [...lex.blocklist],
    gaddag,
  );
}
