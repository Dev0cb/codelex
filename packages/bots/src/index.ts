/**
 * Public API of `@codelex/bots` (docs/architecture/notes/bots-api.md §3). Deterministic opponents: same
 * observation, lexicon, RNG stream, personality and budget ⇒ deep-equal decision (BOT-1).
 */
export { chooseAction } from './choose.js';
export { actionKey, compareKeys } from './key.js';
export { BOT_VERSION, PERSONALITIES } from './personalities.js';
export type {
  BotBudget,
  BotContext,
  BotDecision,
  BotError,
  BotErrorCode,
  BotPersonalityId,
  PersonalityData,
} from './types.js';
