/**
 * Draft golden replays (ADR-0014 §D3): `test/golden/drafts/v<N>/`, MUTABLE while the version is a draft and outside
 * the golden-immutability check. Two full seeded matches per draft variant, played by the harness
 * (`test/support/play.ts`) on its synthetic lexicon. They pin the draft tables between commits of the same draft
 * (`rulesDigest` is stored next to each log) and become `replays/v<N>/` at the freeze (R4).
 *
 * Regenerate after an intentional draft change: `pnpm --filter @codelex/game-engine drafts:write`.
 */
import { newActionLog, serializeActionLog } from '../../src/replay/log.js';
import { rulesDigest } from '../../src/rules/registry.js';
import { stateHash } from '../../src/state/state.js';
import type { MatchState } from '../../src/types.js';
import { playSteps, type Variant } from '../support/play.js';
import { DX_DW_248, V2_248, V2_3612 } from '../support/variants.js';

export const DRAFT_GOLDEN_DIR = 'test/golden/drafts/v2';
const SEED = '00c0de1e000000d2';
/**
 * Second seed (review of #64): under `letters-v2` the first seed ends early on a RESIGN. This one plays every
 * variant to a natural end through at least one EXCHANGE and an empty bag, with no RESIGN.
 */
export const FULL_SEED = '00c0de1e0000d300';
const SEATS = 2;

export interface DraftGolden {
  readonly $comment: string;
  readonly variant: string;
  readonly seed: string;
  readonly engineRulesVersion: number;
  readonly candidate: string;
  readonly rulesDigest: string;
  readonly finalStateHash: string;
  readonly actionCount: number;
  /** The action log as JCS text (with every state hash and the final checkpoint). */
  readonly log: string;
}

export const DRAFT_VARIANTS: readonly Variant[] = [V2_3612, V2_248, DX_DW_248];

/** One golden file per (variant, seed): `<variant>.json` (SEED) and `<variant>-full.json` (FULL_SEED). */
export interface DraftGoldenSpec {
  readonly file: string;
  readonly variant: Variant;
  readonly seed: string;
}

export const DRAFT_GOLDENS: readonly DraftGoldenSpec[] = DRAFT_VARIANTS.flatMap((variant) => [
  { file: variant.id, variant, seed: SEED },
  { file: `${variant.id}-full`, variant, seed: FULL_SEED },
]);

/** The golden of `variant`, rebuilt from the harness: same seed ⇒ same document (deterministic). */
export function buildDraftGolden(variant: Variant, seed: string = SEED): DraftGolden {
  const played = playSteps(seed, SEATS, 10_000, variant);
  const last = played.states.at(-1) as MatchState;
  if (last.status !== 'finished') throw new Error(`${variant.id}: the match did not finish`);
  const hashes = played.states.slice(1).map(stateHash);
  const finalStateHash = stateHash(last);
  const log = {
    ...newActionLog(played.config),
    actions: played.actions,
    stateHashes: hashes,
    final: { stateHash: finalStateHash, actionCount: played.actions.length },
  };
  return {
    $comment:
      'DRAFT golden (ADR-0014 §D3): mutable while engineRulesVersion 2 is a draft; regenerate with `pnpm --filter @codelex/game-engine drafts:write`. Never compared across builds or published.',
    variant: variant.id,
    seed,
    engineRulesVersion: variant.engineRulesVersion,
    candidate: variant.ctx.draft?.candidate ?? '',
    rulesDigest: rulesDigest(variant.engineRulesVersion),
    finalStateHash,
    actionCount: played.actions.length,
    log: serializeActionLog(log),
  };
}
