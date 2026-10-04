/**
 * Strategist policy (docs/specs/E-1.3-bots/strategist.md S-1..S-5, bots-api §5.5). Integer-only and deterministic:
 * 1. vocabulary filter (`maxDifficultyRank`, empty ⇒ unfiltered);
 * 2. overflow shortlist over `maxCandidates` by the attention key, ties by canonical key (no random draw);
 * 3. `evaluateMove` for every kept candidate; utility `U = 10 · total + L + C + D` (dp), ties by canonical key;
 * 4. voluntary exchange of `rack − K*` when X-1..X-5 hold for the best-U candidate `P*`;
 * 5. otherwise one weighted draw over the top-N by `U` (`topWeights`), the only use of `ctx.rng`;
 * 6. no word: EXCHANGE of `rack − K*` iff the bag holds ≥ `RULES.minBagForExchange` tiles, else PASS.
 * Scores come only from `evaluateMove` (BOT-9): the strategy terms rank candidates, they never change a score.
 */
import {
  evaluateMove,
  getLayout,
  getLetterTable,
  RULES,
  type ExchangeAction,
  type Observation,
  type PassAction,
  type PlaceWordAction,
  type RackTile,
} from '@codelex/game-engine';
import type { LexiconIndex } from '@codelex/lexicon/index';
import { candidateKey, compareKeys, comparePlacements } from '../key.js';
import { mainDifficultyRank } from '../main-word.js';
import type { Candidate } from '../movegen/index.js';
import { attentionKey, denialPermille, exposure, withTiles } from '../strategy/lanes.js';
import { bestKeep, countsValue, floorDiv, rawLeave, tileCounts } from '../strategy/leave.js';
import type { StrategyData } from '../types.js';
import type { PolicyInput, PolicyResult } from './types.js';

const PERMILLE = 1000;
const DP_PER_POINT = 10;

/** One evaluated candidate and its utility terms (dp). */
export interface Scored {
  readonly action: PlaceWordAction;
  readonly key: string;
  /** `breakdown.total`, points. */
  readonly total: number;
  readonly chainKAfter: number;
  /** Rack after placing, before refill (sorted). */
  readonly leave: string;
  /** `raw(leave)`, used by X-4/X-5 whatever the bag size. */
  readonly leaveRaw: number;
  readonly l: number;
  readonly c: number;
  readonly d: number;
  readonly u: number;
}

export interface StrategistOptions {
  /** Simulator-only ablation (spec ST-2): `L = C = D = 0` and no voluntary exchange. */
  readonly ablated?: boolean;
}

/**
 * Own team score minus the best other team score (`obs.teamScores`), for the seat on turn (the guards make it the
 * viewer). Every Classic match has at least two teams.
 */
export function leadOf(obs: Observation): number {
  const own = obs.seats[obs.seatOnTurn]?.team ?? 0;
  let best = Number.MIN_SAFE_INTEGER;
  obs.teamScores.forEach((score, team) => {
    if (team !== own && score > best) best = score;
  });
  return (obs.teamScores[own] ?? 0) - best;
}

function degreeOf(lexicon: LexiconIndex, form: string): number {
  const ref = lexicon.lookup(form);
  return ref === undefined ? 0 : lexicon.neighbours(lexicon.termOf(ref)).length;
}

/** Evaluates `shortlist` and ranks it by `U` desc, then canonical key (S-2, S-3). */
export function rankStrategist(
  input: PolicyInput,
  shortlist: readonly Candidate[],
  s: StrategyData,
  options: StrategistOptions = {},
): Scored[] {
  const { obs, lexicon, view } = input;
  const ablated = options.ablated === true;
  const values = getLetterTable(obs.config.letters).values;
  const squares = getLayout(obs.config.layout).squares;
  const size = view.size;
  const bag = obs.bagCount;
  const before = ablated ? 0 : exposure(view.codes, squares, size, s);
  const permille = denialPermille(leadOf(obs), bag, s);
  const unseenValue = countsValue(obs.unseen, values);
  const scored: Scored[] = [];
  for (const candidate of shortlist) {
    const result = evaluateMove(obs, candidate.action, { lexicon });
    if (!result.ok) continue;
    const { breakdown, leave, goesOut } = result.value;
    const counts = tileCounts(leave);
    const leaveRaw = rawLeave(counts, values, s);
    let l = 0;
    let c = 0;
    let d = 0;
    if (!ablated) {
      if (bag >= RULES.minBagForExchange) l = leaveRaw;
      else if (bag > 0) l = floorDiv(leaveRaw * s.leaveLowBagPermille, PERMILLE);
      else if (goesOut) l = s.endgameRackDp * unseenValue;
      else l = -s.endgameRackDp * countsValue(counts, values);
      if (bag >= 1) {
        const main = breakdown.words[0];
        const degree = main === undefined ? 0 : degreeOf(lexicon, main.form);
        c =
          s.chainKeepDp * breakdown.chainKAfter +
          s.chainDegreeDp * Math.min(degree, s.chainDegreeCap);
      }
      const after = exposure(
        withTiles(view.codes, size, result.value.action.tiles),
        squares,
        size,
        s,
      );
      // `0 -` rather than unary minus: no negative zero (ADR-0013 §D4.1).
      d = 0 - floorDiv((after - before) * permille, PERMILLE);
    }
    scored.push({
      action: result.value.action,
      key: candidateKey(candidate),
      total: breakdown.total,
      chainKAfter: breakdown.chainKAfter,
      leave,
      leaveRaw,
      l,
      c,
      d,
      u: DP_PER_POINT * breakdown.total + l + c + d,
    });
  }
  return scored.sort((a, b) => b.u - a.u || compareKeys(a.key, b.key));
}

/** EXCHANGE of `rack − K*` (≥ 1 tile, sorted) or, below the exchange threshold or with an empty rack, PASS. */
export function strategistFallback(
  obs: Observation,
  seat: number,
  s: StrategyData,
): ExchangeAction | PassAction {
  if (obs.rack.length === 0 || obs.bagCount < RULES.minBagForExchange)
    return { seat, type: 'PASS' };
  const { give } = bestKeep(obs.rack, getLetterTable(obs.config.letters).values, s);
  return { seat, type: 'EXCHANGE', tiles: Array.from(give) as RackTile[] };
}

/** X-1..X-5 (S-4) for the best-U candidate; the exchange to play, or undefined. */
function voluntaryExchange(
  obs: Observation,
  best: Scored,
  s: StrategyData,
): ExchangeAction | undefined {
  if (obs.bagCount < RULES.minBagForExchange) return undefined; // X-1
  if (obs.scorelessTurns > s.exchangeMaxScoreless) return undefined; // X-2
  if (best.total > s.exchangeMaxScore) return undefined; // X-3
  if (best.leaveRaw > s.exchangePoorLeaveDp) return undefined; // X-4
  const keep = bestKeep(obs.rack, getLetterTable(obs.config.letters).values, s);
  if (keep.raw - best.leaveRaw < s.exchangeGainDp) return undefined; // X-5
  return { seat: obs.seatOnTurn, type: 'EXCHANGE', tiles: Array.from(keep.give) as RackTile[] };
}

export function strategist(
  input: PolicyInput,
  s: StrategyData,
  options: StrategistOptions = {},
): PolicyResult {
  const { obs, lexicon, rng, budget, data, view } = input;

  // S-1.1 Vocabulary filter.
  let pool: readonly Candidate[] = input.candidates;
  if (data.maxDifficultyRank < 3) {
    const known = pool.filter(
      (c) => mainDifficultyRank(view, c.action.tiles, lexicon) <= data.maxDifficultyRank,
    );
    if (known.length > 0) pool = known;
  }

  // S-1.2 Overflow shortlist: attention key desc, ties by canonical key.
  let exhausted = false;
  let shortlist: readonly Candidate[] = pool;
  if (pool.length > budget.maxCandidates) {
    const squares = getLayout(obs.config.layout).squares;
    shortlist = pool
      .map((candidate) => ({
        candidate,
        key: attentionKey(candidate.action.tiles, squares, view.size),
      }))
      .sort(
        (a, b) =>
          b.key - a.key || comparePlacements(a.candidate.action.tiles, b.candidate.action.tiles),
      )
      .slice(0, budget.maxCandidates)
      .map((entry) => entry.candidate);
    exhausted = true;
  }
  const candidatesEvaluated = shortlist.length;

  // S-1.3, S-2 Evaluate and rank by U.
  const ranked = rankStrategist(input, shortlist, s, options);
  const best = ranked[0];
  if (best === undefined) {
    return { action: strategistFallback(obs, obs.seatOnTurn, s), candidatesEvaluated, exhausted };
  }

  // S-4 Voluntary exchange (decided before the draw; no randomness).
  if (options.ablated !== true) {
    const exchange = voluntaryExchange(obs, best, s);
    if (exchange !== undefined) {
      return { action: exchange, candidatesEvaluated, exhausted, voluntaryExchange: true };
    }
  }

  // S-3 One weighted draw over the top-N by U.
  const top = ranked.slice(0, data.topWeights.length);
  const weights = data.topWeights.slice(0, top.length);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return { action: best.action, candidatesEvaluated, exhausted };
  let draw = rng.int(0, totalWeight);
  let picked = 0;
  while (picked < top.length - 1 && draw >= (weights[picked] ?? 0)) {
    draw -= weights[picked] ?? 0;
    picked += 1;
  }
  return { action: (top[picked] ?? best).action, candidatesEvaluated, exhausted };
}
