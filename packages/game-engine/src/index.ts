/**
 * Public API of `@codelex/game-engine` (`docs/architecture/notes/game-engine-api.md` §3: two entries, `.` and
 * `./rng`). Hashing (SHA-256, JCS subset) is internal: callers use `stateHash` / `serializeState`.
 */
export { ENGINE_RULES_VERSION } from './version.js';
export * from './rng/index.js';
export * from './types.js';
export { getLayout, getLetterTable, RULES } from './rules/constants.js';
export { createMatch } from './match/create.js';
export { apply, type Applied } from './match/apply.js';
export { eventsFor, evaluateMove, observe, previewScore } from './match/observe.js';
export { parseState, serializeState, stateHash } from './state/state.js';
export {
  LOG_VERSION,
  newActionLog,
  parseActionLog,
  replay,
  serializeActionLog,
  type ActionLog,
  type ReplayError,
  type ReplayOutcome,
} from './replay/log.js';
