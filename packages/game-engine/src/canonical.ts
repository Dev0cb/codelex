/**
 * `@codelex/game-engine/canonical` (ADR-0016 §D3.2, API note §3): the engine's own canonical JSON serialiser for
 * the ADR-0013 §D3 JCS subset, so that tools comparing engine output (the golden runner) canonicalise with the
 * exact code that hashes states, never with a second implementation.
 *
 * Since sprint 4 P3 it also exposes the engine's SHA-256 (`sha256Hex` over `asciiBytes`): the golden runner checks
 * `sha256.json` and `jcs.json` against it, reports `observed` values above 1 KB as their SHA-256 and computes the
 * corpus digest (ADR-0016 §D3.1), all on the same code path that derives RNG streams and state hashes. Not a
 * security primitive; `.` still exports no hashing.
 */
export { canonicalJson, isJcsInteger, JCS_MAX_DEPTH } from './hash/jcs.js';
export { asciiBytes, sha256Hex } from './hash/sha256.js';
