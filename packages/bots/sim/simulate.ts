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
 * Action logs stay in memory: they are replayed and dropped, never written (game-engine-api §20 Q1/Q2 become
 * one-way only once logs are persisted).
 */
import {
  apply,
  createMatch,
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
import { BOT_VERSION, chooseAction, PERSONALITIES, type BotPersonalityId } from '../src/index.js';
import { meanTenths, rateBp, spread, wilsonBp, type Interval, type Spread } from './stats.js';

export interface Pairing {
  /** Report key, e.g. `beginner-mirror`. */
  readonly id: string;
  /** Personality A plays seat 0 in even-numbered matches and seat 1 in odd ones (seats swapped). */
  readonly a: BotPersonalityId;
  readonly b: BotPersonalityId;
  readonly matches: number;
}

export interface Variant {
  /** Report key, e.g. `with-inflections`. */
  readonly id: string;
  readonly lexicon: LexiconIndex;
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
  /** Personality per seat. */
  readonly seats: readonly BotPersonalityId[];
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

export function matchConfig(lexicon: LexiconIndex, seed: SeedHex): MatchConfig {
  return {
    seed,
    engineRulesVersion: 1,
    lexiconVersion: lexicon.version,
    profileId: lexicon.profile.id,
    definitionHash: lexicon.profile.definitionHash,
    config: {
      mode: 'classic',
      format: 'untimed-vs-bot',
      seats: 2,
      teams: [[0], [1]],
      layout: 'classic-v1',
      letters: 'letters-v1',
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
  seats: readonly BotPersonalityId[],
  maxActions = 1_000,
): MatchRecord {
  const config = matchConfig(lexicon, seed);
  const created = createMatch(config, { lexicon });
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
    const obs = observe(state, seat);
    const decided = chooseAction(obs, {
      lexicon,
      rng: deriveRng(seed, `bot:${String(seat)}:${String(obs.actionCount)}`),
      personality,
      budget: PERSONALITIES[personality].budget,
    });
    if (!decided.ok) {
      throw new SimulationError('BOT_ERROR', `seed ${seed}: chooseAction ${decided.error.code}`);
    }
    const decision = decided.value;
    const applied = apply(state, decision.action, { lexicon });
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
  const replayed = replay(log, { lexicon });
  if (!replayed.ok || replayed.value.finalHash !== finalHash) {
    throw new SimulationError(
      'REPLAY_MISMATCH',
      `seed ${seed}: ${replayed.ok ? 'final hash differs' : replayed.error.code}`,
    );
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
  readonly personality: BotPersonalityId;
  readonly decisions: number;
  readonly placeWord: number;
  readonly exchange: number;
  readonly pass: number;
  /** Decisions without a PLACE_WORD (bots never exchange voluntarily: no legal word was found). */
  readonly noWordBp: number;
  readonly budgetExhausted: number;
  readonly budgetExhaustedBp: number;
  readonly nodes: Spread;
  readonly candidatesEvaluated: Spread;
  /** Mean points per accepted PLACE_WORD, tenths (BG-3, C-03). */
  readonly pointsPerWordTenths: number;
  /** Main words whose canonical term is novice or intermediate (BG-4). */
  readonly noviceOrIntermediateBp: number;
  /** Mean final score per match, tenths. */
  readonly meanScoreTenths: number;
}

export interface PairingReport {
  readonly id: string;
  readonly a: BotPersonalityId;
  readonly b: BotPersonalityId;
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
  /** Hooked-inflection term bonus ÷ all term bonus (C-09). */
  readonly hookTermBonusShareBp: number;
  readonly personalities: readonly PersonalityStats[];
  readonly replayVerified: number;
}

function personalityStats(
  personality: BotPersonalityId,
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
    exchange: turns.filter((t) => t.type === 'EXCHANGE').length,
    pass: turns.filter((t) => t.type === 'PASS').length,
    noWordBp: rateBp(turns.length - words.length, turns.length),
    budgetExhausted: exhausted,
    budgetExhaustedBp: rateBp(exhausted, turns.length),
    nodes: spread(turns.map((t) => t.nodesUsed)),
    candidatesEvaluated: spread(turns.map((t) => t.candidatesEvaluated)),
    pointsPerWordTenths: meanTenths(points, words.length),
    noviceOrIntermediateBp: rateBp(easy, words.length),
    meanScoreTenths: meanTenths(scoreSum, seatsPlayed),
  };
}

export function aggregate(pairing: Pairing, records: readonly MatchRecord[]): PairingReport {
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
  return {
    id: pairing.id,
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
    rackTilesAtEnd: spread(records.map((r) => r.rackTilesAtEnd)),
    meanTotalScoreTenths: meanTenths(totalScore, records.length),
    meanFirstMoverLeadTenths: meanTenths(lead, records.length),
    wordsPerMatchTenths: meanTenths(turns - noWordTurns, records.length),
    actionsPerMatch: spread(records.map((r) => r.actions)),
    top20TermShareBp: rateBp(top20, mainWords),
    distinctTermsPlayed: termCounts.size,
    inflectionShareBp: rateBp(inflections, mainWords),
    termBonusShareBp: rateBp(termBonus, points),
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
  readonly pairings: readonly PairingReport[];
}

export interface SuiteReport {
  readonly botVersion: number;
  readonly engineRulesVersion: number;
  readonly masterSeed: string;
  readonly matches: number;
  readonly variants: readonly VariantReport[];
}

export interface RunOptions {
  /** Called after each match (progress output in the CLI). */
  readonly onMatch?: (variant: string, pairing: string, index: number, record: MatchRecord) => void;
}

/** Seats of match `index`: A on seat 0 for even indices, seat 1 for odd ones. */
export function seatsFor(pairing: Pairing, index: number): BotPersonalityId[] {
  return index % 2 === 0 ? [pairing.a, pairing.b] : [pairing.b, pairing.a];
}

export function runSuite(spec: SuiteSpec, options: RunOptions = {}): SuiteReport {
  let matches = 0;
  const variants = spec.variants.map((variant): VariantReport => {
    const pairings = variant.pairings.map((pairing, pairingIndex) => {
      const records: MatchRecord[] = [];
      for (let i = 0; i < pairing.matches; i += 1) {
        const seed = matchSeed(spec.masterSeed, pairingIndex, i);
        const record = playMatch(
          variant.lexicon,
          seed,
          seatsFor(pairing, i),
          spec.maxActionsPerMatch,
        );
        records.push(record);
        options.onMatch?.(variant.id, pairing.id, i, record);
      }
      matches += records.length;
      return aggregate(pairing, records);
    });
    return {
      id: variant.id,
      lexiconVersion: variant.lexicon.version,
      profileId: variant.lexicon.profile.id,
      definitionHash: variant.lexicon.profile.definitionHash,
      forms: variant.lexicon.size,
      terms: variant.lexicon.termCount,
      automaton: variant.lexicon.gaddag === undefined ? 'dawg' : 'gaddag',
      pairings,
    };
  });
  return {
    botVersion: BOT_VERSION,
    engineRulesVersion: 1,
    masterSeed: spec.masterSeed,
    matches,
    variants,
  };
}
