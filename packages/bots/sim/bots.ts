/**
 * Simulator bot ids: every public personality under its own id, plus simulator-only yardsticks expressed as a
 * personality-data override (bots-api §5.4 V2-5: "a simulator override of `greedy`, not a new id").
 *
 * - `greedy-matched`: the same-vocabulary greedy yardstick of BG-2a (b2-response D2): `greedy` with
 *   `maxDifficultyRank` 1, i.e. Beginner's vocabulary with greedy's ranking and budget.
 */
import { PERSONALITIES, type BotPersonalityId, type PersonalityData } from '../src/index.js';

export interface SimBot {
  readonly personality: BotPersonalityId;
  /** Personality-data override (`BotContext.data`); absent = the shipped table. */
  readonly data?: PersonalityData;
}

export const GREEDY_MATCHED = 'greedy-matched';

const YARDSTICKS: Readonly<Record<string, SimBot>> = Object.freeze({
  [GREEDY_MATCHED]: Object.freeze({
    personality: 'greedy',
    data: Object.freeze({ ...PERSONALITIES.greedy, maxDifficultyRank: 1 }),
  }),
});

function isPersonality(id: string): id is BotPersonalityId {
  return Object.prototype.hasOwnProperty.call(PERSONALITIES, id);
}

/** The bot behind a simulator id; throws on an unknown id (a typo must never fall back silently). */
export function simBot(id: string): SimBot {
  if (isPersonality(id)) return { personality: id };
  const yardstick = YARDSTICKS[id];
  if (yardstick === undefined) throw new Error(`unknown simulator bot "${id}"`);
  return yardstick;
}

/** True iff `id` names a public personality or a yardstick. */
export function isSimBot(id: string): boolean {
  return isPersonality(id) || Object.prototype.hasOwnProperty.call(YARDSTICKS, id);
}
