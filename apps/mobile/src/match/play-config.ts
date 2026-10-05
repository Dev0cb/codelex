import type { BotPersonalityId } from '@codelex/bots';
import {
  isSeedHex,
  type EngineLexicon,
  type EngineRulesVersion,
  type MatchConfig,
  type SeedHex,
} from '@codelex/game-engine';

/**
 * Rules version pinned by every new vs-bot match (E-1.5 AC-3, ADR-0014). A build constant, never a flag or remote
 * config (spec Q-13): switching versions means shipping a new build. Stays 1: the sprint 3 v2 balance check decided
 * the v1 fallback (docs/game/sim/2026-10-v2-balance-check/digest.md).
 */
export const PLAY_RULES_VERSION = 1 satisfies EngineRulesVersion;

/** Version 1 constants (GAME_RULES 0.3.1): `classic-v1` (DW start square) and `letters-v1` (100 tiles). */
export const PLAY_LAYOUT = 'classic-v1';
export const PLAY_LETTERS = 'letters-v1';

/** Slice S1 plays Beginner only; the opponent selector (Strategist) is slice S4. */
export const PLAY_BOT: BotPersonalityId = 'beginner';

/** The player is seat 0, the bot seat 1; who moves first is the engine's `first-player` draw (R-CORE-004). */
export const HUMAN_SEAT = 0;
export const BOT_SEAT = 1;

/**
 * Perceived bot pace (E-1.5 AC-8, D-29): the move is revealed at max(compute, delay), delay drawn in this range.
 * Presentation only: it never enters the engine or the log. Becomes the `bots.think_delay_ms` remote config with S6.
 */
export const THINK_DELAY_MS = { min: 1200, max: 4000 } as const;

/** A 64-bit match seed as 16 lowercase hex chars (ADR-0013 §D1), from 8 bytes of a CSPRNG. */
export function seedFromBytes(bytes: Uint8Array): SeedHex {
  if (bytes.length !== 8) throw new RangeError('a match seed needs exactly 8 bytes');
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  if (!isSeedHex(hex)) throw new RangeError('malformed seed');
  return hex as SeedHex;
}

/**
 * The header of a new Classic 1v1 vs-bot match (E-1.5 AC-3): pinned rules version, its layout and letter table,
 * format `untimed-vs-bot` (no clock, no powers, free rejections), and the bundled lexicon's identity.
 */
export function playMatchConfig(seed: SeedHex, lexicon: EngineLexicon): MatchConfig {
  return {
    seed,
    engineRulesVersion: PLAY_RULES_VERSION,
    lexiconVersion: lexicon.version,
    profileId: lexicon.profile.id,
    definitionHash: lexicon.profile.definitionHash,
    config: {
      mode: 'classic',
      format: 'untimed-vs-bot',
      seats: 2,
      teams: [[HUMAN_SEAT], [BOT_SEAT]],
      layout: PLAY_LAYOUT,
      letters: PLAY_LETTERS,
      requireWinner: 0,
    },
  };
}

/** A presentation delay in {@link THINK_DELAY_MS}, from a uniform `random()` in [0, 1). */
export function thinkDelayMs(random: () => number): number {
  const { min, max } = THINK_DELAY_MS;
  return Math.round(min + Math.min(Math.max(random(), 0), 1) * (max - min));
}
