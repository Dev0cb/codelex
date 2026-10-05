/**
 * Rules selection of a simulator variant (sprint 3 B3, T-2; ADR-0014 §D4). The simulator runs the frozen
 * `engineRulesVersion` 1 or the draft version 2 on the real engine: one `RulesSelection` builds the match header
 * (layout, letters) AND the draft context, and the same context goes to `createMatch`, `apply`, `replay` and every
 * bot's `evaluateMove`, so host and bots can never run different candidates.
 *
 * The draft opt-in token is imported here only (`@codelex/game-engine/draft`, allowed in `packages/bots/sim/**`,
 * lint-banned under `apps/**` and `services/**`). It is never written to a report: the report names the version,
 * status, candidate, tables and `rulesDigest` instead (ADR-0014 §D4 amendment: a draft readout is identified by
 * (log, candidate, rulesDigest)).
 */
import {
  rulesDigest,
  rulesFor,
  type DraftContext,
  type EngineRulesVersion,
  type LayoutId,
  type LetterTableId,
} from '@codelex/game-engine';
import { ALLOW_DRAFT_RULES } from '@codelex/game-engine/draft';

/** Term-bonus candidates of the v2 draft (D3), in the pre-registered order. */
export const V2_CANDIDATES = ['tb-0-3-6-12', 'tb-0-2-4-8'] as const;
export type V2Candidate = (typeof V2_CANDIDATES)[number];

export interface RulesSelection {
  readonly engineRulesVersion: EngineRulesVersion;
  /** Draft candidate; required for a draft version (the default would hide which table ran), absent for v1. */
  readonly candidate?: V2Candidate;
  readonly layout: LayoutId;
  readonly letters: LetterTableId;
}

/** v1 baseline: GAME_RULES 0.3.1, DW start, frozen letters (v2-balance-check §2 `v1`). */
export const RULES_V1: RulesSelection = Object.freeze({
  engineRulesVersion: 1,
  layout: 'classic-v1',
  letters: 'letters-v1',
});

/** v2 draft with a term-bonus candidate; `classic-v2` (plain start) unless `layout` says otherwise (`dx-dw-*`). */
export function rulesV2(candidate: V2Candidate, layout: LayoutId = 'classic-v2'): RulesSelection {
  return Object.freeze({ engineRulesVersion: 2, candidate, layout, letters: 'letters-v2' });
}

/** The draft context of a selection: undefined for a frozen version (never opt in when it is not needed). */
export function draftContext(rules: RulesSelection): DraftContext | undefined {
  if (rulesFor(rules.engineRulesVersion).status !== 'draft') return undefined;
  return rules.candidate === undefined
    ? { optIn: ALLOW_DRAFT_RULES }
    : { optIn: ALLOW_DRAFT_RULES, candidate: rules.candidate };
}

/** What a results JSON records about the rules of a variant (ADR-0014 §D4, v2-balance-check §6). */
export interface RulesProvenance {
  readonly engineRulesVersion: number;
  readonly status: 'frozen' | 'draft';
  readonly gameRules: string;
  /** `"none"` for a frozen version. */
  readonly candidate: string;
  readonly layout: string;
  readonly letters: string;
  /** Term bonus novice/intermediate/advanced/expert actually used. */
  readonly termBonus: readonly number[];
  readonly rulesDigest: string;
}

export function rulesProvenance(rules: RulesSelection): RulesProvenance {
  const set = rulesFor(rules.engineRulesVersion);
  let used = set.rules;
  if (rules.candidate !== undefined) {
    if (set.candidates.length === 0) {
      throw new Error(`rules: a frozen version has no candidates (got ${rules.candidate})`);
    }
    const found = set.candidates.find((c) => c.id === rules.candidate);
    // Never fall back to the default: the report would name one table and the run would use another.
    if (found === undefined) throw new Error(`rules: unknown candidate ${rules.candidate}`);
    used = found.rules;
  }
  const tb = used.termBonus;
  return {
    engineRulesVersion: set.engineRulesVersion,
    status: set.status,
    gameRules: set.gameRules,
    candidate: rules.candidate ?? 'none',
    layout: rules.layout,
    letters: rules.letters,
    termBonus: [tb.novice, tb.intermediate, tb.advanced, tb.expert],
    rulesDigest: rulesDigest(rules.engineRulesVersion),
  };
}

/**
 * CLI flags → selection: `--rules v1` (default) or `--rules v2 --candidate <id>`, optionally `--layout classic-v1`
 * (the D4 diagnostic: DW start with v2 bonuses and letters). Inconsistent combinations are errors, not defaults.
 */
export function parseRules(rules: string, candidate?: string, layout?: string): RulesSelection {
  if (rules === 'v1') {
    if (candidate !== undefined) throw new Error('--candidate: only with --rules v2');
    if (layout !== undefined && layout !== 'classic-v1') {
      throw new Error('--layout: v1 allows classic-v1 only');
    }
    return RULES_V1;
  }
  if (rules !== 'v2') throw new Error('--rules: v1 or v2');
  if (candidate === undefined) {
    throw new Error(`--rules v2 needs --candidate ${V2_CANDIDATES.join('|')}`);
  }
  const found = V2_CANDIDATES.find((c) => c === candidate);
  if (found === undefined) throw new Error(`--candidate: ${V2_CANDIDATES.join(' or ')}`);
  if (layout !== undefined && layout !== 'classic-v1' && layout !== 'classic-v2') {
    throw new Error('--layout: classic-v1 or classic-v2');
  }
  return rulesV2(found, layout ?? 'classic-v2');
}
