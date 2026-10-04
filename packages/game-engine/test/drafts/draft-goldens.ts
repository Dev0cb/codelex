/**
 * Draft golden replays (ADR-0014 §D3): `test/golden/drafts/v<N>/`, MUTABLE while the version is a draft and outside
 * the golden-immutability check. One full seeded match per draft variant, played by the harness
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
const SEATS = 2;

export interface DraftGolden {
  readonly $comment: string;
  readonly variant: string;
  readonly engineRulesVersion: number;
  readonly candidate: string;
  readonly rulesDigest: string;
  readonly finalStateHash: string;
  readonly actionCount: number;
  /** The action log as JCS text (with every state hash and the final checkpoint). */
  readonly log: string;
}

export const DRAFT_VARIANTS: readonly Variant[] = [V2_3612, V2_248, DX_DW_248];

/** The golden of `variant`, rebuilt from the harness: same seed ⇒ same document (deterministic). */
export function buildDraftGolden(variant: Variant): DraftGolden {
  const played = playSteps(SEED, SEATS, 10_000, variant);
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
    engineRulesVersion: variant.engineRulesVersion,
    candidate: variant.ctx.draft?.candidate ?? '',
    rulesDigest: rulesDigest(variant.engineRulesVersion),
    finalStateHash,
    actionCount: played.actions.length,
    log: serializeActionLog(log),
  };
}
