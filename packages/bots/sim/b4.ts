/**
 * B4 readouts (docs/specs/E-1.3-bots/strategist.md § ST-x, GD-7 BG-5 re-read): job table, per-bot statistics from
 * match records, and the ST-x metrics. Integer-only like the B2 simulator (basis points, tenths, permille, Wilson
 * intervals in basis points). `engineRulesVersion` 1 only: no v2-draft run happens here (V1 pre-registration).
 */
import type { LexiconIndex } from '@codelex/lexicon/index';
import type { DecideOptions } from '../src/choose.js';
import { PERSONALITIES } from '../src/index.js';
import type { PersonalityData } from '../src/types.js';
import {
  playB4Match,
  simBot,
  type B4Match,
  type B4Turn,
  type Player,
  type SimBot,
} from './b4-play.js';
import { matchSeed } from './simulate.js';
import { meanTenths, rateBp, spread, wilsonBp, type Interval, type Spread } from './stats.js';

/** Tuning seeds (B4 only) and the pre-registered ST-1 confirmation seed (spec § Pre-registration). */
export const TUNING_SEED = '2026100400000a00';
export const CONFIRMATION_SEED = '2026100400000b07';
export const CONFIRMATION_PAIRING = 10;

export type LexiconId = 'main-f1' | 'main-f0';

export interface Job {
  readonly id: string;
  readonly what: string;
  readonly masterSeed: string;
  readonly pairingIndex: number;
  readonly lexicon: LexiconId;
  readonly a: Player;
  readonly b: Player;
  readonly matches: number;
}

/** Strategist data under test: the frozen data, or a tuning candidate (simulator override). */
export function strategistBots(data: PersonalityData = PERSONALITIES.strategist): {
  readonly strategist: SimBot;
  readonly ablated: SimBot;
} {
  const options: DecideOptions = { data };
  return {
    strategist: { id: 'strategist', personality: 'strategist', options },
    ablated: {
      id: 'strategist-ablated',
      personality: 'strategist',
      options: { ...options, ablated: true },
    },
  };
}

export function jobsFor(data: PersonalityData = PERSONALITIES.strategist): readonly Job[] {
  const { strategist, ablated } = strategistBots(data);
  const tuning = { masterSeed: TUNING_SEED, lexicon: 'main-f1' as const };
  return [
    {
      id: 'st1b',
      what: 'ST-1b, ST-4b, ST-5, BG-5',
      ...tuning,
      pairingIndex: 0,
      a: strategist,
      b: 'beginner',
      matches: 2_000,
    },
    {
      id: 'st2',
      what: 'ST-2',
      ...tuning,
      pairingIndex: 1,
      a: strategist,
      b: ablated,
      matches: 2_000,
    },
    {
      id: 'st3',
      what: 'ST-3, ST-4a, ST-4c, ST-4d',
      ...tuning,
      pairingIndex: 2,
      a: 'greedy',
      b: strategist,
      matches: 2_000,
    },
    {
      id: 'st7-strategist',
      what: 'ST-7, ST-8, ST-4b',
      ...tuning,
      pairingIndex: 3,
      a: strategist,
      b: strategist,
      matches: 10_000,
    },
    {
      id: 'st7-greedy',
      what: 'ST-7, ST-8 (same seeds)',
      ...tuning,
      pairingIndex: 3,
      a: 'greedy',
      b: 'greedy',
      matches: 10_000,
    },
    {
      id: 'bg5',
      what: 'BG-5 (Beginner mirror)',
      ...tuning,
      pairingIndex: 4,
      a: 'beginner',
      b: 'beginner',
      matches: 2_000,
    },
    {
      id: 'st1',
      what: 'ST-1 confirmation (pre-registered)',
      masterSeed: CONFIRMATION_SEED,
      lexicon: 'main-f1',
      pairingIndex: CONFIRMATION_PAIRING,
      a: strategist,
      b: 'beginner',
      matches: 2_000,
    },
    {
      id: 'st1-f0',
      what: 'ST-1 confirmation seeds on f0 (automaton check, reported)',
      masterSeed: CONFIRMATION_SEED,
      lexicon: 'main-f0',
      pairingIndex: CONFIRMATION_PAIRING,
      a: strategist,
      b: 'beginner',
      matches: 2_000,
    },
  ];
}

export interface BotStats {
  readonly id: string;
  readonly decisions: number;
  readonly placeWord: number;
  readonly exchange: number;
  readonly pass: number;
  readonly pointsPerWordTenths: number;
  readonly noviceOrIntermediateBp: number;
  /** ST-5 / BG-5. */
  readonly budgetExhausted: number;
  readonly budgetExhaustedBp: number;
  /** Decisions with two blanks on the rack, and how many of them hit a cap. */
  readonly twoBlankDecisions: number;
  readonly twoBlankExhausted: number;
  readonly nodes: Spread;
  readonly candidatesEvaluated: Spread;
  /** ST-4b: voluntary exchanges ÷ turns with bag ≥ 7; and voluntary exchanges with scorelessTurns ≥ 3. */
  readonly turnsBag7: number;
  readonly voluntaryExchanges: number;
  readonly voluntaryExchangeBp: number;
  readonly voluntaryAtScoreless3: number;
  /** ST-4a: mean raw(leave) (dp, in tenths of dp) after PLACE_WORD with bag ≥ 7. */
  readonly leaveRawSum: number;
  readonly leaveRawN: number;
  readonly meanLeaveRawTenthsDp: number;
  /** ST-4c: hot TW squares opened per PLACE_WORD while leading (lead ≥ 30, bag ≥ 1). */
  readonly leadingMoves: number;
  readonly leadingTwOpened: number;
  /** ST-4d: main words with chainKAfter > 0. */
  readonly chainWords: number;
  readonly chainWordBp: number;
}

function botStats(id: string, records: readonly B4Match[]): BotStats {
  const turns: B4Turn[] = [];
  for (const r of records) {
    r.seats.forEach((bot, seat) => {
      if (bot !== id) return;
      for (const t of r.turns) if (t.seat === seat) turns.push(t);
    });
  }
  const words = turns.filter((t) => t.type === 'PLACE_WORD');
  const points = words.reduce((a, t) => a + (t.points ?? 0), 0);
  const easy = words.filter(
    (t) => t.mainDifficulty === 'novice' || t.mainDifficulty === 'intermediate',
  ).length;
  const exhausted = turns.filter((t) => t.budgetExhausted).length;
  const twoBlank = turns.filter((t) => t.rackBlanks >= 2);
  const bag7 = turns.filter((t) => t.bagCount >= 7);
  const voluntary = turns.filter((t) => t.voluntaryExchange);
  const leaveWords = words.filter((t) => t.bagCount >= 7);
  const leaveRawSum = leaveWords.reduce((a, t) => a + (t.leaveRaw ?? 0), 0);
  const leading = words.filter((t) => t.lead >= 30 && t.bagCount >= 1);
  const chainWords = words.filter((t) => (t.chainKAfter ?? 0) > 0).length;
  return {
    id,
    decisions: turns.length,
    placeWord: words.length,
    exchange: turns.filter((t) => t.type === 'EXCHANGE').length,
    pass: turns.filter((t) => t.type === 'PASS').length,
    pointsPerWordTenths: meanTenths(points, words.length),
    noviceOrIntermediateBp: rateBp(easy, words.length),
    budgetExhausted: exhausted,
    budgetExhaustedBp: rateBp(exhausted, turns.length),
    twoBlankDecisions: twoBlank.length,
    twoBlankExhausted: twoBlank.filter((t) => t.budgetExhausted).length,
    nodes: spread(turns.map((t) => t.nodesUsed)),
    candidatesEvaluated: spread(turns.map((t) => t.candidatesEvaluated)),
    turnsBag7: bag7.length,
    voluntaryExchanges: voluntary.length,
    voluntaryExchangeBp: rateBp(voluntary.length, bag7.length),
    voluntaryAtScoreless3: voluntary.filter((t) => t.scorelessTurns >= 3).length,
    leaveRawSum,
    leaveRawN: leaveWords.length,
    meanLeaveRawTenthsDp: meanTenths(leaveRawSum, leaveWords.length),
    leadingMoves: leading.length,
    leadingTwOpened: leading.reduce((a, t) => a + (t.hotTwOpened ?? 0), 0),
    chainWords,
    chainWordBp: rateBp(chainWords, words.length),
  };
}

export interface JobReport {
  readonly id: string;
  readonly what: string;
  readonly masterSeed: string;
  readonly pairingIndex: number;
  readonly lexicon: LexiconId;
  readonly lexiconVersion: string;
  readonly forms: number;
  readonly automaton: 'gaddag' | 'dawg';
  readonly a: string;
  readonly b: string;
  readonly matches: number;
  readonly draws: number;
  /** A wins, draws excluded (n = decisive matches); 0/0 for a mirror. */
  readonly aWin: {
    readonly k: number;
    readonly n: number;
    readonly bp: number;
    readonly ci95: Interval;
  };
  /** B-01 / ST-8: the seat that moved first wins, draws excluded. */
  readonly firstPlayerWin: {
    readonly k: number;
    readonly n: number;
    readonly bp: number;
    readonly ci95: Interval;
  };
  readonly scorelessEndings: number;
  /** C-10: R-TURN-004 endings with ≥ 7 tiles in the bag (premature lock), share of matches. */
  readonly prematureLocks: number;
  readonly prematureLockBp: number;
  /** C-11: mean tiles played per match (100 − bag − racks at the end), tenths. */
  readonly tilesPlayedTenths: number;
  readonly meanTotalScoreTenths: number;
  readonly replayVerified: number;
  readonly bots: readonly BotStats[];
}

function rate(k: number, n: number): JobReport['aWin'] {
  return { k, n, bp: rateBp(k, n), ci95: wilsonBp(k, n) };
}

export function jobReport(
  job: Job,
  lexicon: LexiconIndex,
  lexiconId: LexiconId,
  records: readonly B4Match[],
): JobReport {
  const a = simBot(job.a).id;
  const b = simBot(job.b).id;
  let draws = 0;
  let aWins = 0;
  let firstWins = 0;
  let locks = 0;
  let scoreless = 0;
  let tiles = 0;
  let total = 0;
  for (const r of records) {
    const winner = r.places[0] === 1 && r.places[1] === 1 ? -1 : r.places.indexOf(1);
    if (winner === -1) draws += 1;
    else {
      if (r.seats[winner] === a) aWins += 1;
      if (winner === r.firstSeat) firstWins += 1;
    }
    if (r.endReason === 'scoreless_turns') {
      scoreless += 1;
      if (r.bagAtEnd >= 7) locks += 1;
    }
    tiles += 100 - r.bagAtEnd - r.rackTilesAtEnd;
    total += (r.scores[0] ?? 0) + (r.scores[1] ?? 0);
  }
  const decisive = records.length - draws;
  return {
    id: job.id,
    what: job.what,
    masterSeed: job.masterSeed,
    pairingIndex: job.pairingIndex,
    lexicon: lexiconId,
    lexiconVersion: lexicon.version,
    forms: lexicon.size,
    automaton: lexicon.gaddag === undefined ? 'dawg' : 'gaddag',
    a,
    b,
    matches: records.length,
    draws,
    aWin: a === b ? rate(0, 0) : rate(aWins, decisive),
    firstPlayerWin: rate(firstWins, decisive),
    scorelessEndings: scoreless,
    prematureLocks: locks,
    prematureLockBp: rateBp(locks, records.length),
    tilesPlayedTenths: meanTenths(tiles, records.length),
    meanTotalScoreTenths: meanTenths(total, records.length),
    replayVerified: records.length,
    bots: (a === b ? [a] : [a, b]).map((id) => botStats(id, records)),
  };
}

/** Plays matches `first .. first + count − 1` of a job (seeds `sim-match:<pairingIndex>:<i>`, seats swapped). */
export function runJob(
  job: Job,
  lexicon: LexiconIndex,
  first = 0,
  count = job.matches,
  onMatch?: (index: number) => void,
): B4Match[] {
  const records: B4Match[] = [];
  for (let i = first; i < first + count; i += 1) {
    // Seats swapped every other match (A on seat 0 for even indices), as `seatsFor` in the B2 simulator.
    const seats = i % 2 === 0 ? [job.a, job.b] : [job.b, job.a];
    records.push(playB4Match(lexicon, matchSeed(job.masterSeed, job.pairingIndex, i), seats));
    onMatch?.(i);
  }
  return records;
}

/** ST-4 ratios in permille: Strategist ÷ greedy (`a` over `b` of two bot stats). */
export function ratioPermille(num: number, numN: number, den: number, denN: number): number {
  if (numN === 0 || den === 0) return 0;
  return Math.floor((num * denN * 1000) / (numN * den));
}
