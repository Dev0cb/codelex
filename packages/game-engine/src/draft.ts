/**
 * `@codelex/game-engine/draft` (ADR-0014 §D4, API note §3): the draft opt-in token, and nothing else. Allowed in
 * `packages/bots/sim/**` and in test files of `packages/game-engine` and `packages/bots`; lint-banned under
 * `apps/**` and `services/**`.
 *
 * Usage: `createMatch(config, { lexicon, draft: { optIn: ALLOW_DRAFT_RULES, candidate: 'tb-0-2-4-8' } })`,
 * `parseState(text, { draft })`, `parseActionLog(text, { draft })`, `replay(log, { lexicon, draft })`.
 */
export { ALLOW_DRAFT_RULES, type DraftOptIn } from './rules/draft-token.js';
