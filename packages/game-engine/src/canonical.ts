/**
 * `@codelex/game-engine/canonical` (ADR-0016 §D3.2, API note §3): the engine's own canonical JSON serialiser for
 * the ADR-0013 §D3 JCS subset, so that tools comparing engine output (the golden runner) canonicalise with the
 * exact code that hashes states, never with a second implementation. SHA-256 stays internal.
 */
export { canonicalJson, isJcsInteger, JCS_MAX_DEPTH } from './hash/jcs.js';
