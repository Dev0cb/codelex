/**
 * B2 simulator core (sprint B2; bots-api §5.4, §8): plays seeded bot-vs-bot Classic matches with the real engine
 * as the host, verifies every match by `replay`, and aggregates integer statistics. Synchronous and deterministic:
 * same lexicon, suite and master seed ⇒ the same report (no clock, no ambient randomness; wall time is measured
 * outside, by the shell).
 *
 * Host role (BOT-2): the simulator holds the `MatchState` and the seed; each bot receives `observe(state, seat)`
 * and a fresh `deriveRng(seed, "bot:<seat>:<n>")`. Match seeds come from the master seed through the stream
 * `sim-match:<pairing index>:<match index>`, so a pairing's seeds do not depend on the other pairings, and two
 * lexicon variants run with the same `variantSeedsShared` seed set are paired comparisons (BALANCE.md protocol).
 *
 * Rules (sprint 3 B3, T-2): each variant names a `RulesSelection` (v1, or the v2 draft with a term-bonus candidate).
 * One draft context per variant goes to `createMatch`, `apply`, `replay` and the bots' `evaluateMove`, and the
 * report records version, candidate, tables and `rulesDigest` per variant (ADR-0014 §D4 amendment).
 *
 * Action logs stay in memory: they are replayed and dropped, never written (game-engine-api §20 Q1/Q2 become
 * one-way only once logs are persisted; the first exported log is also a `.clxi` format-1 freeze trigger, P4).
 * A draft log is reproducible only with its candidate, so any future export must write the variant's
 * `RulesProvenance` next to each log.
 */
import {
  apply,
  createMatch,
  getLetterTable,
  type DraftContext,
  type LetterTableId,
  newActionLog,
  observe,
  replay,
  stateHash,
  type Action,
  type MatchConfig,
  type MatchState,
  type PlaceWordAction,
  type SeedHex,
  type StateHash,
  type WordScore,
} from '@codelex/game-engine';
import { deriveRng } from '@codelex/game-engine/rng';
import type { LexiconIndex } from '@codelex/lexicon/index';
import { BOT_VERSION, chooseAction, PERSONALITIES, type BotBudget } from '../src/index.js';
import { assertV2Exemption, strategistBudget } from './balance-check.js';
import { simBot } from './bots.js';
import {
  draftContext,
  RULES_V1,
  rulesProvenance,
  type RulesProvenance,
  type RulesSelection,
} from './rules.js';
import {
  meanCiTenths,
  meanTenths,
  ratioCiBp,
  rateBp,
  spread,
  wilsonBp,
  type Interval,
  type MeanWithCi,
  type RatioWithCi,
  type Spread,
} from './stats.js';

/** A simulator bot id: a public personality, or a yardstick such as `greedy-matched` (`bots.ts`). */
export type SimBotId = string;

export interface Pairing {
  /** Report key, e.g. `beginner-mirror`. */
  readonly id: string;
  /** Bot A plays seat 0 in even-numbered matches and seat 1 in odd ones (seats swapped). */
  readonly a: SimBotId;
  readonly b: SimBotId;
  readonly matches: number;
  /**
   * Seed stream index (`sim-match:<index>:<match>`). Default: the position in the variant's list. A
   * pre-registered suite sets it explicitly, so skipping a pairing never shifts the seeds of the others.
   */
  readonly index?: number;
}

export interface Variant {
  /** Report key, e.g. `with-inflections`. */
  readonly id: string;
  readonly lexicon: LexiconIndex;
  readonly rules: RulesSelection;
  readonly pairings: readonly Pairing[];
}

export interface SuiteSpec {
  /** 16 lowercase hex chars. */
  readonly masterSeed: string;
  readonly variants: readonly Variant[];
  /** Safety net: a match longer than this many accepted actions is a bug (default 1,000). */
  readonly maxActionsPerMatch?: number;
}

/** What one match contributes; also the per-match row of the report. */
export interface MatchRecord {
  readonly seed: string;
  /** Bot per seat. */
  readonly seats: readonly SimBotId[];
  readonly firstSeat: number;
  readonly endReason: 'going_out' | 'scoreless_turns' | 'resign';
  /** Final scores per seat (after R-SCORE-006 adjustments). */
  readonly scores: readonly number[];
  /** 1-based place per seat; [1, 1] = draw. */
  readonly places: readonly number[];
  readonly actions: number;
  /** Tiles left in the bag and on both racks when the match ended. */
  readonly bagAtEnd: number;
  readonly rackTilesAtEnd: number;
  /** Tiles placed on the board by PLACE_WORD over the match (C-11). */
  readonly tilesPlayed: number;
  /** Σ PlaceWord points and Σ term bonus of the match (C-05 per-match terms). */
  readonly placeWordPoints: number;
  readonly termBonus: number;
  readonly finalHash: string;
  readonly turns: readonly TurnRecord[];
}

export interface TurnRecord {
  readonly seat: number;
  /** Tiles in the bag when the decision was taken. */
  readonly bagCount: number;
  readonly type: Action['type'];
  readonly nodesUsed: number;
  readonly candidatesEvaluated: number;
  /** Evaluations the engine refused (`BotDecision.candidatesRefused`, the I-2 signal). */
  readonly candidatesRefused: number;
  readonly budgetExhausted: boolean;
  /** PLACE_WORD only. */
  readonly points?: number;
  readonly tilesPlaced?: number;
  readonly mainTermId?: string;
  readonly mainDifficulty?: WordScore['difficulty'];
  readonly mainIsInflection?: boolean;
  /** Σ termBonus of the words of this move. */
  readonly termBonus?: number;
  /** Σ termBonus of words that hook an inflection onto its own canonical term with one tile (C-09). */
  readonly hookedInflectionTermBonus?: number;
}

/** Seed of match `matchIndex` of pairing `pairingIndex` (host-side derivation from the master seed). */
export function matchSeed(masterSeed: string, pairingIndex: number, matchIndex: number): SeedHex {
  const rng = deriveRng(masterSeed, `sim-match:${String(pairingIndex)}:${String(matchIndex)}`);
  const hi = rng.next().toString(16).padStart(8, '0');
  const lo = rng.next().toString(16).padStart(8, '0');
  return `${hi}${lo}` as SeedHex;
}

export function matchConfig(
  lexicon: LexiconIndex,
  seed: SeedHex,
  rules: RulesSelection = RULES_V1,
): MatchConfig {
  return {
    seed,
    engineRulesVersion: rules.engineRulesVersion,
    lexiconVersion: lexicon.version,
    profileId: lexicon.profile.id,
    definitionHash: lexicon.profile.definitionHash,
    config: {
      mode: 'classic',
      format: 'untimed-vs-bot',
      seats: 2,
      teams: [[0], [1]],
      layout: rules.layout,
      letters: rules.letters,
      requireWinner: 0,
    },
  };
}

/** Number of tiles of `action` on the span of `word`. */
function newTilesIn(word: WordScore, action: PlaceWordAction): { count: number; index: number } {
  const length = word.form.length;
  let count = 0;
  let index = -1;
  for (const t of action.tiles) {
    const offset =
      word.direction === 'row'
        ? t.row === word.start.row
          ? t.col - word.start.col
          : -1
        : t.col === word.start.col
          ? t.row - word.start.row
          : -1;
    if (offset >= 0 && offset < length) {
      count += 1;
      index = offset;
    }
  }
  return { count, index };
}

/**
 * BALANCE.md C-09: a word that is an inflection (form ≠ canonical form) made by adding exactly one tile at either
 * end of its own canonical form already on the board (POD → PODS).
 */
export function isHookedInflection(word: WordScore, action: PlaceWordAction): boolean {
  if (word.form === word.canonicalForm) return false;
  const { count, index } = newTilesIn(word, action);
  if (count !== 1) return false;
  const last = word.form.length - 1;
  if (index !== 0 && index !== last) return false;
  const rest = index === 0 ? word.form.slice(1) : word.form.slice(0, last);
  return rest === word.canonicalForm;
}

export class SimulationError extends Error {
  constructor(
    readonly code: 'BOT_ERROR' | 'APPLY_REJECTED' | 'REPLAY_MISMATCH' | 'MATCH_TOO_LONG',
    message: string,
  ) {
    super(message);
    this.name = 'SimulationError';
  }
}

/** Plays one match to the end; throws `SimulationError` on any contract breach (P-BOT-01, replay). */
export function playMatch(
  lexicon: LexiconIndex,
  seed: SeedHex,
  seats: readonly SimBotId[],
  maxActions = 1_000,
  rules: RulesSelection = RULES_V1,
): MatchRecord {
  const config = matchConfig(lexicon, seed, rules);
  const draft: DraftContext | undefined = draftContext(rules);
  const engine = draft === undefined ? { lexicon } : { lexicon, draft };
  const bots = seats.map(simBot);
  const created = createMatch(config, engine);
  if (!created.ok) throw new SimulationError('BOT_ERROR', `createMatch: ${created.error.code}`);
  let state: MatchState = created.value.state;
  const actions: Action[] = [];
  const hashes: StateHash[] = [];
  const turns: TurnRecord[] = [];

  while (state.status === 'in_progress') {
    if (state.actionCount >= maxActions) {
      throw new SimulationError(
        'MATCH_TOO_LONG',
        `seed ${seed}: over ${String(maxActions)} actions`,
      );
    }
    const seat = state.seatOnTurn;
    const personality = seats[seat] ?? 'random-legal';
    const bot = bots[seat] ?? simBot('random-legal');
    const obs = observe(state, seat);
    const decided = chooseAction(obs, {
      lexicon,
      rng: deriveRng(seed, `bot:${String(seat)}:${String(obs.actionCount)}`),
      personality: bot.personality,
      budget: (bot.data ?? PERSONALITIES[bot.personality]).budget,
      ...(draft === undefined ? {} : { draft }),
      ...(bot.data === undefined ? {} : { data: bot.data }),
    });
    if (!decided.ok) {
      throw new SimulationError('BOT_ERROR', `seed ${seed}: chooseAction ${decided.error.code}`);
    }
    const decision = decided.value;
    const applied = apply(state, decision.action, engine);
    if (!applied.ok) {
      throw new SimulationError(
        'APPLY_REJECTED',
        `seed ${seed}, action ${String(state.actionCount)} (${personality}): ${applied.error.code}`,
      );
    }
    state = applied.value.state;
    actions.push(applied.value.action);
    hashes.push(stateHash(state));

    const base = {
      seat,
      bagCount: obs.bagCount,
      type: decision.action.type,
      nodesUsed: decision.nodesUsed,
      candidatesEvaluated: decision.candidatesEvaluated,
      candidatesRefused: decision.candidatesRefused,
      budgetExhausted: decision.budgetExhausted,
    };
    const placed = applied.value.events.find((e) => e.type === 'WORD_PLACED');
    if (placed?.type === 'WORD_PLACED' && decision.action.type === 'PLACE_WORD') {
      const action = decision.action;
      const { breakdown } = placed;
      const main = breakdown.words.find((w) => w.main);
      let termBonus = 0;
      let hooked = 0;
      for (const w of breakdown.words) {
        termBonus += w.termBonus;
        if (isHookedInflection(w, action)) hooked += w.termBonus;
      }
      turns.push({
        ...base,
        points: breakdown.total,
        tilesPlaced: breakdown.tilesPlaced,
        ...(main === undefined
          ? {}
          : {
              mainTermId: main.termId,
              mainDifficulty: main.difficulty,
              mainIsInflection: main.form !== main.canonicalForm,
            }),
        termBonus,
        hookedInflectionTermBonus: hooked,
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
  const replayed = replay(log, engine);
  if (!replayed.ok || replayed.value.finalHash !== finalHash) {
    throw new SimulationError(
      'REPLAY_MISMATCH',
      `seed ${seed}: ${replayed.ok ? 'final hash differs' : replayed.error.code}`,
    );
  }
  let tilesPlayed = 0;
  let placeWordPoints = 0;
  let termBonus = 0;
  for (const t of turns) {
    tilesPlayed += t.tilesPlaced ?? 0;
    placeWordPoints += t.points ?? 0;
    termBonus += t.termBonus ?? 0;
  }
  return {
    seed,
    seats: [...seats],
    firstSeat: state.firstSeat,
    endReason: result.end.reason,
    scores: state.seats.map((s) => s.score),
    places: [...result.places],
    actions: actions.length,
    bagAtEnd: state.bag.length,
    rackTilesAtEnd: state.seats.reduce((a, s) => a + s.rack.length, 0),
    tilesPlayed,
    placeWordPoints,
    termBonus,
    finalHash,
    turns,
  };
}

// --- aggregation ---

export interface RateWithCi {
  readonly k: number;
  readonly n: number;
  readonly bp: number;
  readonly ci95: Interval;
}

function rateWithCi(k: number, n: number): RateWithCi {
  return { k, n, bp: rateBp(k, n), ci95: wilsonBp(k, n) };
}

export interface PersonalityStats {
  /** Simulator bot id (a personality or a yardstick). */
  readonly personality: SimBotId;
  readonly decisions: number;
  readonly placeWord: number;
  /** Σ points of accepted PLACE_WORDs (BG-3 is a ratio of these sums). */
  readonly placeWordPoints: number;
  readonly exchange: number;
  readonly pass: number;
  /** Decisions without a PLACE_WORD (bots never exchange voluntarily: no legal word was found). */
  readonly noWordBp: number;
  readonly budgetExhausted: number;
  readonly budgetExhaustedBp: number;
  /**
   * EXCHANGE/PASS decisions taken after evaluating ≥ 1 candidate. For bots without voluntary exchanges, every
   * evaluated candidate was refused by the engine (I-2 signal, e.g. a missing draft context).
   */
  readonly fallbacksAfterEvaluation: number;
  /**
   * Σ evaluations the engine refused (I-2). Unlike `fallbacksAfterEvaluation`, it never counts a voluntary
   * EXCHANGE, so it holds for every bot, Strategist included.
   */
  readonly candidatesRefused: number;
  readonly nodes: Spread;
  readonly candidatesEvaluated: Spread;
  /** Mean points per accepted PLACE_WORD, tenths (BG-3, C-03). */
  readonly pointsPerWordTenths: number;
  /** Main words whose canonical term is novice or intermediate (BG-4). */
  readonly noviceOrIntermediateBp: number;
  /** Mean final score per match, tenths. */
  readonly meanScoreTenths: number;
}

export interface BagAtEnd {
  /** Matches whose bag held 0, 1–6 and ≥ 7 tiles at the end (T-1/T-9 split). */
  readonly empty: number;
  readonly oneToSix: number;
  readonly sevenPlus: number;
  readonly spread: Spread;
}

export interface PairingReport {
  readonly id: string;
  /** Seed stream index of the pairing. */
  readonly index: number;
  readonly a: SimBotId;
  readonly b: SimBotId;
  readonly matches: number;
  readonly draws: number;
  /** Seat that moved first wins (draws excluded from n). B-01. */
  readonly firstPlayerWin: RateWithCi;
  /** Personality A wins (seats swapped; draws excluded from n). BG-1, BG-2. */
  readonly aWin: RateWithCi;
  readonly endReasons: {
    readonly going_out: number;
    readonly scoreless_turns: number;
    readonly resign: number;
  };
  readonly scorelessEndingBp: number;
  /** Turns of either seat without a PLACE_WORD ÷ all turns. */
  readonly noWordTurnBp: number;
  /** Same, only over turns taken while the bag still held tiles (excludes the stuck endgame). */
  readonly noWordTurnBagNotEmptyBp: number;
  /** Matches whose bag was empty at the end. */
  readonly bagEmptyAtEndBp: number;
  readonly bagAtEnd: BagAtEnd;
  /** C-10: matches ending on R-TURN-004 (scoreless turns) with ≥ 7 tiles in the bag, ÷ all matches. */
  readonly prematureLock: RateWithCi;
  /** C-11: tiles placed on the board per match, mean with a normal 95 % CI (tenths). */
  readonly tilesPlayed: MeanWithCi;
  /** PASS decisions per match (forced-pass tail: these bots pass only with no word and a bag < 7). */
  readonly passesPerMatch: Spread;
  readonly matchesWithPass: number;
  /** Tiles left on both racks at the end. */
  readonly rackTilesAtEnd: Spread;
  readonly meanTotalScoreTenths: number;
  /** Mean (first mover − second mover) score, tenths (C-08 companion). */
  readonly meanFirstMoverLeadTenths: number;
  readonly wordsPerMatchTenths: number;
  readonly actionsPerMatch: Spread;
  /** Share of main words played whose term is among the 20 most played (E-1.7 guardrail). */
  readonly top20TermShareBp: number;
  readonly distinctTermsPlayed: number;
  /** Main words played as an inflection. */
  readonly inflectionShareBp: number;
  /** Σ termBonus ÷ Σ points (C-05). */
  readonly termBonusShareBp: number;
  /** C-05 with its delta-method 95 % CI, the match as the unit (v2-balance-check §3.2). */
  readonly termBonusShare: RatioWithCi;
  /** Hooked-inflection term bonus ÷ all term bonus (C-09). */
  readonly hookTermBonusShareBp: number;
  readonly personalities: readonly PersonalityStats[];
  readonly replayVerified: number;
}

function personalityStats(
  personality: SimBotId,
  records: readonly MatchRecord[],
): PersonalityStats {
  const turns: TurnRecord[] = [];
  let scoreSum = 0;
  let seatsPlayed = 0;
  for (const r of records) {
    r.seats.forEach((p, seat) => {
      if (p !== personality) return;
      seatsPlayed += 1;
      scoreSum += r.scores[seat] ?? 0;
      for (const t of r.turns) if (t.seat === seat) turns.push(t);
    });
  }
  const words = turns.filter((t) => t.type === 'PLACE_WORD');
  const points = words.reduce((a, t) => a + (t.points ?? 0), 0);
  const easy = words.filter(
    (t) => t.mainDifficulty === 'novice' || t.mainDifficulty === 'intermediate',
  ).length;
  const exhausted = turns.filter((t) => t.budgetExhausted).length;
  return {
    personality,
    decisions: turns.length,
    placeWord: words.length,
    placeWordPoints: points,
    exchange: turns.filter((t) => t.type === 'EXCHANGE').length,
    pass: turns.filter((t) => t.type === 'PASS').length,
    noWordBp: rateBp(turns.length - words.length, turns.length),
    budgetExhausted: exhausted,
    budgetExhaustedBp: rateBp(exhausted, turns.length),
    candidatesRefused: turns.reduce((a, t) => a + t.candidatesRefused, 0),
    fallbacksAfterEvaluation: turns.filter(
      (t) => t.type !== 'PLACE_WORD' && t.candidatesEvaluated > 0,
    ).length,
    nodes: spread(turns.map((t) => t.nodesUsed)),
    candidatesEvaluated: spread(turns.map((t) => t.candidatesEvaluated)),
    pointsPerWordTenths: meanTenths(points, words.length),
    noviceOrIntermediateBp: rateBp(easy, words.length),
    meanScoreTenths: meanTenths(scoreSum, seatsPlayed),
  };
}

/** Tiles in a letter table (letters + blanks): the most tiles a match can play (C-11 ceiling). */
export function tilesInTable(letters: LetterTableId): number {
  const table = getLetterTable(letters);
  return table.counts.reduce((a, b) => a + b, 0) + table.blanks;
}

/** `tileCount`: the variant's letter table size (`tilesInTable`), the C-11 ceiling. */
export function aggregate(
  pairing: Pairing,
  records: readonly MatchRecord[],
  index: number,
  tileCount: number,
): PairingReport {
  let draws = 0;
  let firstWins = 0;
  let aWins = 0;
  let totalScore = 0;
  let lead = 0;
  const ends = { going_out: 0, scoreless_turns: 0, resign: 0 };
  const termCounts = new Map<string, number>();
  let mainWords = 0;
  let inflections = 0;
  let turns = 0;
  let noWordTurns = 0;
  let bagTurns = 0;
  let bagNoWordTurns = 0;
  let termBonus = 0;
  let hooked = 0;
  let points = 0;
  for (const r of records) {
    ends[r.endReason] += 1;
    const winner = r.places[0] === 1 && r.places[1] === 1 ? -1 : r.places.indexOf(1);
    if (winner === -1) draws += 1;
    else {
      if (winner === r.firstSeat) firstWins += 1;
      if (r.seats[winner] === pairing.a) aWins += 1;
    }
    totalScore += (r.scores[0] ?? 0) + (r.scores[1] ?? 0);
    lead += (r.scores[r.firstSeat] ?? 0) - (r.scores[1 - r.firstSeat] ?? 0);
    for (const t of r.turns) {
      turns += 1;
      if (t.bagCount > 0) bagTurns += 1;
      if (t.type !== 'PLACE_WORD') {
        noWordTurns += 1;
        if (t.bagCount > 0) bagNoWordTurns += 1;
        continue;
      }
      points += t.points ?? 0;
      termBonus += t.termBonus ?? 0;
      hooked += t.hookedInflectionTermBonus ?? 0;
      if (t.mainTermId !== undefined) {
        mainWords += 1;
        termCounts.set(t.mainTermId, (termCounts.get(t.mainTermId) ?? 0) + 1);
        if (t.mainIsInflection === true) inflections += 1;
      }
    }
  }
  const decisive = records.length - draws;
  // Mirror pairings count A's wins over both seats: every decisive match is a win of A.
  const aWinK = pairing.a === pairing.b ? 0 : aWins;
  const top20 = [...termCounts.values()]
    .sort((x, y) => y - x)
    .slice(0, 20)
    .reduce((a, b) => a + b, 0);
  const personalities = pairing.a === pairing.b ? [pairing.a] : [pairing.a, pairing.b];
  const bags = records.map((r) => r.bagAtEnd);
  const passes = records.map((r) => r.turns.filter((t) => t.type === 'PASS').length);
  const locked = records.filter((r) => r.endReason === 'scoreless_turns' && r.bagAtEnd >= 7).length;
  return {
    id: pairing.id,
    index,
    a: pairing.a,
    b: pairing.b,
    matches: records.length,
    draws,
    firstPlayerWin: rateWithCi(firstWins, decisive),
    aWin: rateWithCi(aWinK, pairing.a === pairing.b ? 0 : decisive),
    endReasons: ends,
    scorelessEndingBp: rateBp(ends.scoreless_turns, records.length),
    noWordTurnBp: rateBp(noWordTurns, turns),
    noWordTurnBagNotEmptyBp: rateBp(bagNoWordTurns, bagTurns),
    bagEmptyAtEndBp: rateBp(records.filter((r) => r.bagAtEnd === 0).length, records.length),
    bagAtEnd: {
      empty: bags.filter((b) => b === 0).length,
      oneToSix: bags.filter((b) => b > 0 && b < 7).length,
      sevenPlus: bags.filter((b) => b >= 7).length,
      spread: spread(bags),
    },
    prematureLock: rateWithCi(locked, records.length),
    tilesPlayed: meanCiTenths(
      records.map((r) => r.tilesPlayed),
      tileCount,
    ),
    passesPerMatch: spread(passes),
    matchesWithPass: passes.filter((p) => p > 0).length,
    rackTilesAtEnd: spread(records.map((r) => r.rackTilesAtEnd)),
    meanTotalScoreTenths: meanTenths(totalScore, records.length),
    meanFirstMoverLeadTenths: meanTenths(lead, records.length),
    wordsPerMatchTenths: meanTenths(turns - noWordTurns, records.length),
    actionsPerMatch: spread(records.map((r) => r.actions)),
    top20TermShareBp: rateBp(top20, mainWords),
    distinctTermsPlayed: termCounts.size,
    inflectionShareBp: rateBp(inflections, mainWords),
    termBonusShareBp: rateBp(termBonus, points),
    termBonusShare: ratioCiBp(
      records.map((r) => r.termBonus),
      records.map((r) => r.placeWordPoints),
    ),
    hookTermBonusShareBp: rateBp(hooked, termBonus),
    personalities: personalities.map((p) => personalityStats(p, records)),
    replayVerified: records.length,
  };
}

export interface VariantReport {
  readonly id: string;
  readonly lexiconVersion: string;
  readonly profileId: string;
  readonly definitionHash: string;
  readonly forms: number;
  readonly terms: number;
  readonly automaton: 'gaddag' | 'dawg';
  /** Version, status, candidate, tables, term bonus and rulesDigest the variant ran on (ADR-0014 §D4). */
  readonly rules: RulesProvenance;
  readonly pairings: readonly PairingReport[];
}

export interface SuiteReport {
  readonly botVersion: number;
  /** Distinct `engineRulesVersion`s of the variants, ascending (v2-balance-check §6). */
  readonly engineRulesVersions: readonly number[];
  /** `PERSONALITIES.strategist.budget` when the build has Strategist (B4), else null (§6). */
  readonly strategistBudget: BotBudget | null;
  readonly masterSeed: string;
  readonly matches: number;
  readonly variants: readonly VariantReport[];
}

export interface RunOptions {
  /** Called after each match (progress output in the CLI). */
  readonly onMatch?: (variant: string, pairing: string, index: number, record: MatchRecord) => void;
}

/** Seats of match `index`: A on seat 0 for even indices, seat 1 for odd ones. */
export function seatsFor(pairing: Pairing, index: number): SimBotId[] {
  return index % 2 === 0 ? [pairing.a, pairing.b] : [pairing.b, pairing.a];
}

export function runSuite(spec: SuiteSpec, options: RunOptions = {}): SuiteReport {
  // Fail before playing: v2 outside the registered suite is capped (§1.3), and every rules selection must name
  // a real candidate (a typo never falls back to the default table).
  assertV2Exemption(spec);
  const provenance = spec.variants.map((v) => rulesProvenance(v.rules));
  let matches = 0;
  const variants = spec.variants.map((variant, v): VariantReport => {
    const pairings = variant.pairings.map((pairing, position) => {
      const pairingIndex = pairing.index ?? position;
      const records: MatchRecord[] = [];
      for (let i = 0; i < pairing.matches; i += 1) {
        const seed = matchSeed(spec.masterSeed, pairingIndex, i);
        const record = playMatch(
          variant.lexicon,
          seed,
          seatsFor(pairing, i),
          spec.maxActionsPerMatch,
          variant.rules,
        );
        records.push(record);
        options.onMatch?.(variant.id, pairing.id, i, record);
      }
      matches += records.length;
      return aggregate(pairing, records, pairingIndex, tilesInTable(variant.rules.letters));
    });
    return {
      id: variant.id,
      lexiconVersion: variant.lexicon.version,
      profileId: variant.lexicon.profile.id,
      definitionHash: variant.lexicon.profile.definitionHash,
      forms: variant.lexicon.size,
      terms: variant.lexicon.termCount,
      automaton: variant.lexicon.gaddag === undefined ? 'dawg' : 'gaddag',
      rules: provenance[v] ?? rulesProvenance(variant.rules),
      pairings,
    };
  });
  return {
    botVersion: BOT_VERSION,
    engineRulesVersions: [...new Set(spec.variants.map((v) => v.rules.engineRulesVersion))].sort(
      (x, y) => x - y,
    ),
    strategistBudget: strategistBudget(),
    masterSeed: spec.masterSeed,
    matches,
    variants,
  };
}
