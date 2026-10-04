/**
 * The rules variants the engine tests run (ADR-0014 acceptance: P-API-01/07 for v1 and for each v2 candidate).
 * The v2 ids follow the pre-registered balance check (`docs/specs/E-1.6-balance/v2-balance-check.md` §2):
 * `v2-3612`, `v2-248` (gating candidates, plain start) and `dx-dw-248` (diagnostic: DW start with v2 letters).
 * Test-only use of the draft opt-in (ADR-0014 §D4).
 */
import { ALLOW_DRAFT_RULES } from '../../src/draft.js';
import type { EngineContext } from '../../src/types.js';
import { SIM_CTX, V1, type Variant } from './play.js';

/** The harness context with the draft opt-in and a candidate. */
export function draftCtx(candidate?: string, base: EngineContext = SIM_CTX): EngineContext {
  return candidate === undefined
    ? { lexicon: base.lexicon, draft: { optIn: ALLOW_DRAFT_RULES } }
    : { lexicon: base.lexicon, draft: { optIn: ALLOW_DRAFT_RULES, candidate } };
}

export const V2_3612: Variant = {
  id: 'v2-3612',
  ctx: draftCtx('tb-0-3-6-12'),
  engineRulesVersion: 2,
  layout: 'classic-v2',
  letters: 'letters-v2',
};

export const V2_248: Variant = {
  id: 'v2-248',
  ctx: draftCtx('tb-0-2-4-8'),
  engineRulesVersion: 2,
  layout: 'classic-v2',
  letters: 'letters-v2',
};

export const DX_DW_248: Variant = {
  id: 'dx-dw-248',
  ctx: draftCtx('tb-0-2-4-8'),
  engineRulesVersion: 2,
  layout: 'classic-v1',
  letters: 'letters-v2',
};

/** v1 and every v2 draft variant. */
export const VARIANTS: readonly Variant[] = [V1, V2_3612, V2_248, DX_DW_248];
