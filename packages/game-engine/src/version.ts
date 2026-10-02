/**
 * Rules version of this engine build (ADR-0013 §D5). Two builds reporting the same value produce identical
 * outcomes for every action log; bump it for any outcome change (rules, constants, RNG, serialisation, hash).
 * Version 1 = GAME_RULES v0.3 with the ADR-0013 RNG. The package semver is never used for pinning.
 */
export const ENGINE_RULES_VERSION = 1;
