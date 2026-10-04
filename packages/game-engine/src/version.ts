/**
 * Deprecated (ADR-0014 §D6): the newest FROZEN rules version, kept for one release. One build now serves every
 * registered version (`RULES_VERSIONS`, `rulesFor`); no engine code reads this constant. Consumers pin their own
 * version (mobile: `PLAY_RULES_VERSION`; the Phase 2 server: per queue). Stays 1 until rules PR 0.4 (R4).
 */
export const ENGINE_RULES_VERSION = 1;
