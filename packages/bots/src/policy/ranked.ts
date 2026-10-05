/**
 * Ranked policy shared by `beginner` and `greedy`, driven by `PersonalityData` (bots-api §5.3):
 * 1. vocabulary filter on the main word's difficulty (empty ⇒ unfiltered);
 * 2. attention: over `maxCandidates`, either a uniform sample (partial Fisher–Yates on the canonical-key-sorted
 *    list, `sampleWhenOver = 1`) or the first `maxCandidates` in generation order (`0`, a dropped remainder ⇒
 *    `exhausted`);
 * 3. `evaluateMove`, rank by `breakdown.total` desc then canonical key (leave ignored);
 * 4. missed Full Stack: if the best places 7 tiles, with `skipFullStackPermille` every 7-tile candidate is removed
 *    (unless that would leave nothing: a missed bingo never turns into a voluntary exchange, P-BOT-07);
 * 5. weighted pick over the top-N: `topWeights[i] × (mainLength ≤ shortLength ? shortMultiplier : 1)`.
 * RNG draws happen in that fixed order (sample, Full Stack check, pick).
 */
import { evaluateMove, RULES, type PlaceWordAction } from '@codelex/game-engine';
import { compareKeys } from '../key.js';
import { mainDifficultyRank } from '../main-word.js';
import { byKey } from '../movegen/gaddag.js';
import type { Candidate } from '../movegen/index.js';
import type { PolicyInput, PolicyResult } from './types.js';

const PERMILLE = 1000;

interface Ranked {
  readonly action: PlaceWordAction;
  readonly key: string;
  readonly total: number;
  readonly tilesPlaced: number;
  readonly mainLength: number;
}

/** Partial Fisher–Yates: `count` uniformly chosen items of `items` (a copy), in draw order. */
function sample<T>(
  items: readonly T[],
  count: number,
  int: (lo: number, hi: number) => number,
): T[] {
  const a = [...items];
  for (let i = 0; i < count; i += 1) {
    const j = int(i, a.length);
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a.slice(0, count);
}

export function ranked(input: PolicyInput): PolicyResult {
  const { obs, lexicon, engine, rng, budget, data, view } = input;

  // 1. Vocabulary filter.
  let pool: readonly Candidate[] = input.candidates;
  if (data.maxDifficultyRank < 3) {
    const known = pool.filter(
      (c) => mainDifficultyRank(view, c.action.tiles, lexicon) <= data.maxDifficultyRank,
    );
    if (known.length > 0) pool = known;
  }

  // 2. Attention.
  let exhausted = false;
  let shortlist: readonly Candidate[] = pool;
  if (pool.length > budget.maxCandidates) {
    if (data.sampleWhenOver === 1) {
      shortlist = sample(byKey(pool), budget.maxCandidates, (lo, hi) => rng.int(lo, hi));
    } else {
      shortlist = pool.slice(0, budget.maxCandidates);
      exhausted = true;
    }
  }

  // 3. Evaluate and rank.
  const rankedMoves: Ranked[] = [];
  for (const candidate of shortlist) {
    const result = evaluateMove(obs, candidate.action, engine);
    if (!result.ok) continue;
    const { breakdown } = result.value;
    rankedMoves.push({
      action: result.value.action,
      key: candidate.key,
      total: breakdown.total,
      tilesPlaced: breakdown.tilesPlaced,
      mainLength: breakdown.words[0]?.form.length ?? 0,
    });
  }
  const candidatesEvaluated = shortlist.length;
  rankedMoves.sort((a, b) => b.total - a.total || compareKeys(a.key, b.key));

  // 4. Missed Full Stack.
  let choices: readonly Ranked[] = rankedMoves;
  if (
    rankedMoves[0]?.tilesPlaced === RULES.fullStackTiles &&
    data.skipFullStackPermille > 0 &&
    rng.int(0, PERMILLE) < data.skipFullStackPermille
  ) {
    const rest = rankedMoves.filter((m) => m.tilesPlaced !== RULES.fullStackTiles);
    if (rest.length > 0) choices = rest;
  }

  // 5. Weighted pick over the top-N.
  const top = choices.slice(0, data.topWeights.length);
  const weights = top.map(
    (m, i) =>
      (data.topWeights[i] ?? 0) * (m.mainLength <= data.shortLength ? data.shortMultiplier : 1),
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return { action: undefined, candidatesEvaluated, exhausted };
  let draw = rng.int(0, totalWeight);
  let picked = 0;
  while (picked < top.length - 1 && draw >= (weights[picked] ?? 0)) {
    draw -= weights[picked] ?? 0;
    picked += 1;
  }
  return { action: top[picked]?.action, candidatesEvaluated, exhausted };
}
