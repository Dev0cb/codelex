/**
 * Feature flags with bundled defaults (CLAUDE.md §5: every user-visible change ships behind a flag). E-1.5 AC-19
 * resolution order is cached remote config, then bundled defaults; slice S1 has no remote config yet (no backend in
 * Phase 1, the cached fetch arrives with S6), so the only override is the build-time list
 * `EXPO_PUBLIC_CODELEX_FLAGS` ("key=1,key=0") that dev and playtest builds set at build time.
 */

/** Bundled defaults. `play_vs_bot.enabled` stays off on main until the S1-S3 playtest gate (sprint 3). */
export const FLAG_DEFAULTS = {
  /** Master switch for starting new matches vs a bot (E-1.5 AC-19); off = the Home "paused" card. */
  'play_vs_bot.enabled': false,
  /**
   * E-1.5 AC-17, dark-launch flag of slices S6a and S6c (spec "Flags & rollout", SP2). Off = the consented queue
   * records nothing and reads or writes no file; the first-run notice and the Settings "Playtest data" section are
   * hidden. Non-analytics Settings rows are not behind it. Consent still applies on top when it is on.
   */
  'analytics.upload.enabled': false,
  /** E-1.5 AC-5: the lexicon-free "Base N" preview of pending tiles (R-SCORE-009). Off = no preview at all. */
  'match.live_score_preview': true,
  /**
   * E-1.5 AC-3 (F-2): exists with default off and has no effect while the pinned layout has no tech squares. It can
   * only expose tech squares the pinned `engineRulesVersion` defines, never add them at runtime (R-CORE-005).
   */
  'board.tech_squares.enabled': false,
  /**
   * E-1.5 AC-13/AC-14 kill switch (slice S5): off = term chips are shown but inert, no card entry point, and the card
   * text is never decoded. Off on main until the slice passes review (SP2); on in the playtest build.
   */
  'knowledge_card.post_match.enabled': false,
} as const satisfies Readonly<Record<string, boolean>>;

export type FlagKey = keyof typeof FLAG_DEFAULTS;
export type Flags = Readonly<Record<FlagKey, boolean>>;

const isFlagKey = (key: string): key is FlagKey => Object.hasOwn(FLAG_DEFAULTS, key);

const TRUE = new Set(['1', 'true', 'on']);
const FALSE = new Set(['0', 'false', 'off']);

/**
 * Parses `key=value` pairs separated by commas. Unknown keys and values other than 1/true/on and 0/false/off are
 * ignored (a typo never flips a flag); the last valid value of a key wins.
 */
export function parseFlagOverrides(raw: string | undefined): Partial<Record<FlagKey, boolean>> {
  const overrides: Partial<Record<FlagKey, boolean>> = {};
  if (raw === undefined) return overrides;
  for (const pair of raw.split(',')) {
    const [rawKey = '', rawValue = '', ...rest] = pair.split('=');
    const key = rawKey.trim();
    const value = rawValue.trim().toLowerCase();
    if (rest.length > 0 || !isFlagKey(key)) continue;
    if (TRUE.has(value)) overrides[key] = true;
    else if (FALSE.has(value)) overrides[key] = false;
  }
  return overrides;
}

/** Bundled defaults with the given overrides applied. */
export function resolveFlags(overrides: Partial<Record<FlagKey, boolean>>): Flags {
  return { ...FLAG_DEFAULTS, ...overrides };
}
