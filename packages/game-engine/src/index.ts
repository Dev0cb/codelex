/**
 * Public API of `@codelex/game-engine` (`docs/architecture/notes/game-engine-api.md` §3: entries `.`, `./rng`
 * and, since ADR-0014, `./draft` for the draft opt-in token only). Hashing (SHA-256, JCS subset) is internal:
 * callers use `stateHash` / `serializeState`. `ENGINE_RULES_VERSION` and `RULES` are deprecated aliases
 * (ADR-0014 §D6): use `rulesFor(version)`.
 */
export { ENGINE_RULES_VERSION } from './version.js';
export * from './rng/index.js';
export * from './types.js';
export { getLayout, getLetterTable, RULES } from './rules/constants.js';
export { isRulesVersion, RULES_VERSIONS, rulesDigest, rulesFor } from './rules/registry.js';
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
  type ParseLogOptions,
  type ReplayError,
  type ReplayOptions,
  type ReplayOutcome,
} from './replay/log.js';
