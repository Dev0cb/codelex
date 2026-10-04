/**
 * Personality table of bots-api §5.1 and §5.5 (integers only, BOT-7). Any change to a value is a behaviour change:
 * bump `BOT_VERSION` (reported in `bot_match_started.bot_version`) and pin new golden decisions per
 * (`BOT_VERSION`, `engineRulesVersion`).
 */
import type { BotPersonalityId, PersonalityData, StrategyData } from './types.js';

/**
 * Version of the bots' behaviour (personality data + generation + policies). Integer, bumped on any change.
 * 2 (sprint 3, B4; bots-api §5.6): Beginner `topWeights` [16, 6, 2, 1] and budget 70,000 / 300, Strategist added.
 */
export const BOT_VERSION = 2;

/** S (LetterCode 18) +30 dp, every other letter 0 (spec S-2, GD-5). */
const LETTER_BONUS_DP: readonly number[] = Object.freeze(
  Array.from({ length: 26 }, (_, letter) => (letter === 18 ? 30 : 0)),
);

/** Strategist data, frozen for `BOT_VERSION` 2 after tuning on tuning seeds (B4 readout). */
export const STRATEGIST_STRATEGY: StrategyData = Object.freeze({
  leaveBlankDp: 150,
  leaveBaseDp: 20,
  leavePerValueDp: 10,
  leaveFloorDp: -60,
  leaveLetterBonusDp: LETTER_BONUS_DP,
  vowelIdealPermille: 350,
  vowelOffDp: 30,
  vowelAllOrNoneDp: 40,
  duplicateDp: 25,
  leaveLowBagPermille: 400,
  endgameRackDp: 20,
  chainKeepDp: 25,
  chainDegreeDp: 3,
  chainDegreeCap: 8,
  laneReach: 4,
  hotTwDp: 60,
  hotDwDp: 20,
  leadThreshold: 30,
  trailThreshold: 50,
  denialLeadPermille: 1500,
  denialEvenPermille: 1000,
  denialTrailPermille: 400,
  exchangeMaxScoreless: 2,
  exchangeMaxScore: 14,
  exchangePoorLeaveDp: -80,
  exchangeGainDp: 150,
});

/**
 * `random-legal` ignores ranking: `topWeights` is empty (uniform pick, then one verification call), the other
 * fields are neutral. `greedy` has no short-word preference: `shortLength` 0 / multiplier 1 is neutral.
 * `strategist` ranks by utility `U` (spec S-2) with a deterministic overflow shortlist (`sampleWhenOver` 0).
 */
export const PERSONALITIES: Readonly<Record<BotPersonalityId, PersonalityData>> = Object.freeze({
  'random-legal': Object.freeze({
    budget: Object.freeze({ maxNodes: 200_000, maxCandidates: 8 }),
    maxDifficultyRank: 3,
    sampleWhenOver: 0,
    topWeights: Object.freeze([]),
    shortLength: 0,
    shortMultiplier: 1,
    skipFullStackPermille: 0,
    strategy: null,
  }),
  beginner: Object.freeze({
    budget: Object.freeze({ maxNodes: 70_000, maxCandidates: 300 }),
    maxDifficultyRank: 1,
    sampleWhenOver: 1,
    topWeights: Object.freeze([16, 6, 2, 1]),
    shortLength: 5,
    shortMultiplier: 2,
    skipFullStackPermille: 500,
    strategy: null,
  }),
  greedy: Object.freeze({
    budget: Object.freeze({ maxNodes: 400_000, maxCandidates: 2_000 }),
    maxDifficultyRank: 3,
    sampleWhenOver: 0,
    topWeights: Object.freeze([1]),
    shortLength: 0,
    shortMultiplier: 1,
    skipFullStackPermille: 0,
    strategy: null,
  }),
  strategist: Object.freeze({
    budget: Object.freeze({ maxNodes: 70_000, maxCandidates: 500 }),
    maxDifficultyRank: 2,
    sampleWhenOver: 0,
    topWeights: Object.freeze([10, 6, 3, 1]),
    shortLength: 0,
    shortMultiplier: 1,
    skipFullStackPermille: 0,
    strategy: STRATEGIST_STRATEGY,
  }),
} satisfies Record<BotPersonalityId, PersonalityData>);
