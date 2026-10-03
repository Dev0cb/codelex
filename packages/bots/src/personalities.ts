/**
 * Personality table of bots-api §5.1 (integers only, BOT-7). Any change to a value is a behaviour change:
 * bump `BOT_VERSION` (reported in `bot_match_started.bot_version`) and re-pin the golden decisions.
 */
import type { BotPersonalityId, PersonalityData } from './types.js';

/** Version of the bots' behaviour (personality data + generation + policies). Integer, bumped on any change. */
export const BOT_VERSION = 1;

/**
 * `random-legal` ignores ranking: `topWeights` is empty (uniform pick, then one verification call), the other
 * fields are neutral. `greedy` has no short-word preference: `shortLength` 0 / multiplier 1 is neutral.
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
  }),
  beginner: Object.freeze({
    budget: Object.freeze({ maxNodes: 200_000, maxCandidates: 300 }),
    maxDifficultyRank: 1,
    sampleWhenOver: 1,
    topWeights: Object.freeze([8, 5, 3, 2, 1]),
    shortLength: 5,
    shortMultiplier: 2,
    skipFullStackPermille: 500,
  }),
  greedy: Object.freeze({
    budget: Object.freeze({ maxNodes: 400_000, maxCandidates: 2_000 }),
    maxDifficultyRank: 3,
    sampleWhenOver: 0,
    topWeights: Object.freeze([1]),
    shortLength: 0,
    shortMultiplier: 1,
    skipFullStackPermille: 0,
  }),
} satisfies Record<BotPersonalityId, PersonalityData>);
