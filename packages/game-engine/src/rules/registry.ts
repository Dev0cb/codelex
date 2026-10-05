/**
 * The rules registry (ADR-0014 §D1): frozen, read-only `RulesSet`s keyed by `engineRulesVersion`. Constant module
 * data, not mutable state (ADR-0013 §D4). Versions differ in data only: every public function resolves the set of
 * its input's version once (`resolveRules`) and passes the `Rules` down; nothing outside this file compares
 * `engineRulesVersion` with a number (lint, ADR-0014 §D1).
 */
import { err, ok, type Result } from '@codelex/config/result';
import { hash16 } from '../hash/jcs.js';
import type {
  DraftContext,
  EngineError,
  EngineRulesVersion,
  MatchSetup,
  Rules,
  RulesSet,
  RulesVersionDetails,
} from '../types.js';
import {
  getLayout,
  getLetterTable,
  RULES_V1,
  RULES_V2_TB_0_2_4_8,
  RULES_V2_TB_0_3_6_12,
} from './constants.js';
import { ALLOW_DRAFT_RULES } from './draft-token.js';

/** Version 1: GAME_RULES 0.3.1. Frozen: its outcomes, hashes and GC-DET-01 never change. */
const V1: RulesSet = Object.freeze({
  engineRulesVersion: 1,
  status: 'frozen',
  gameRules: '0.3.1',
  layouts: Object.freeze(['classic-v1'] as const),
  letterTables: Object.freeze(['letters-v1'] as const),
  rules: RULES_V1,
  candidates: Object.freeze([]),
});

/**
 * Version 2: DRAFT until rules PR GAME_RULES 0.4 (task R4). `classic-v2` (plain start, D4); `classic-v1` is also
 * allowed while drafting, for the pre-registered DW-vs-plain confirmation (v2-balance-check §2 `dx-dw-*`).
 * `letters-v2` is derived from batch 3 (L7, BALANCE.md R-BAG-001). Term-bonus candidates (D3): `tb-0-3-6-12` and
 * `tb-0-2-4-8`; without a candidate the default is `tb-0-2-4-8` (the D3 lead candidate). At the freeze the losing
 * candidate and the draft-only layout are removed (ADR-0014 §D4).
 */
const V2: RulesSet = Object.freeze({
  engineRulesVersion: 2,
  status: 'draft',
  gameRules: '0.4-draft',
  layouts: Object.freeze(['classic-v1', 'classic-v2'] as const),
  letterTables: Object.freeze(['letters-v2'] as const),
  rules: RULES_V2_TB_0_2_4_8,
  candidates: Object.freeze([
    Object.freeze({ id: 'tb-0-2-4-8', rules: RULES_V2_TB_0_2_4_8 }),
    Object.freeze({ id: 'tb-0-3-6-12', rules: RULES_V2_TB_0_3_6_12 }),
  ]),
});

// Lookup by version only; `RULES_VERSIONS` is the ordered list.
const SETS: ReadonlyMap<unknown, RulesSet> = new Map<unknown, RulesSet>([
  [1, V1],
  [2, V2],
]);

/** Every registered version, ascending. */
export const RULES_VERSIONS: readonly EngineRulesVersion[] = Object.freeze([1, 2]);

/** True iff `value` is a registered `engineRulesVersion` (frozen or draft). */
export function isRulesVersion(value: unknown): value is EngineRulesVersion {
  return SETS.has(value);
}

/** The `RulesSet` of a registered version. An unregistered version is a programmer error (throws). */
export function rulesFor(version: EngineRulesVersion): RulesSet {
  const set = SETS.get(version);
  if (set === undefined) throw new RangeError('unknown engineRulesVersion');
  return set;
}

/**
 * First 16 hex of SHA-256 over the JCS of the set, its layouts and its letter tables (ADR-0014 §D1). Pinned for
 * every frozen version in `test/golden/rules-digests.json`. Draft digests change with the draft: a simulator
 * readout records it to name the exact tables it ran on.
 */
export function rulesDigest(version: EngineRulesVersion): string {
  const set = rulesFor(version);
  return hash16({
    set,
    layouts: set.layouts.map(getLayout),
    letterTables: set.letterTables.map(getLetterTable),
  });
}

/** Comma-separated frozen versions, ascending (`RULES_VERSION_UNSUPPORTED.details.supported`). */
function supportedVersions(): string {
  return RULES_VERSIONS.filter((v) => rulesFor(v).status === 'frozen').join(',');
}

/**
 * Total over any value (review R1 m1): a finite number or a string is reported as is, anything else by its
 * `typeof` only. Nothing is stringified, so no `toString`/`valueOf` of untrusted JSON ever runs or throws, and
 * no `NaN`/`Infinity` reaches the details (n4).
 */
function describeVersion(actual: unknown): string | number {
  if (typeof actual === 'number') return Number.isFinite(actual) ? actual : 'number';
  return typeof actual === 'string' ? actual : typeof actual;
}

/** An `EngineError` `RULES_VERSION_UNSUPPORTED` with typed details (replay errors reuse them as is). */
export type RulesVersionError = EngineError & {
  readonly code: 'RULES_VERSION_UNSUPPORTED';
  readonly details: RulesVersionDetails;
};

/** `RULES_VERSION_UNSUPPORTED` with the ADR-0014 §D6 details. */
export function rulesVersionError(
  actual: unknown,
  extra?: { readonly status: RulesSet['status']; readonly candidate?: string },
): RulesVersionError {
  const base = { actual: describeVersion(actual), supported: supportedVersions() };
  let message = 'unsupported engineRulesVersion';
  let details: RulesVersionDetails = base;
  if (extra?.candidate !== undefined) {
    message = 'unknown rules candidate';
    details = { ...base, status: extra.status, candidate: extra.candidate };
  } else if (extra !== undefined) {
    message = 'draft rules version without the opt-in';
    details = { ...base, status: extra.status };
  }
  return { kind: 'engine', code: 'RULES_VERSION_UNSUPPORTED', message, details };
}

/** The rules an entry point runs with: the registry entry and the selected `Rules`. */
export interface ResolvedRules {
  readonly set: RulesSet;
  readonly rules: Rules;
}

/**
 * The single resolution step of every entry point (ADR-0014 §D1, §D4). Fails with `RULES_VERSION_UNSUPPORTED`
 * when `version` is not registered, when it is a draft and `draft.optIn` is not `ALLOW_DRAFT_RULES`, or when
 * `draft.candidate` names no candidate of the set (a frozen set has none).
 */
export function resolveRules(
  version: unknown,
  draft: DraftContext | undefined,
): Result<ResolvedRules, RulesVersionError> {
  const set = SETS.get(version);
  if (set === undefined) return err(rulesVersionError(version));
  if (set.status === 'draft' && draft?.optIn !== ALLOW_DRAFT_RULES) {
    return err(rulesVersionError(version, { status: 'draft' }));
  }
  const candidate = draft?.candidate;
  if (candidate === undefined) return ok({ set, rules: set.rules });
  const found = set.candidates.find((c) => c.id === candidate);
  if (found === undefined) {
    return err(rulesVersionError(version, { status: set.status, candidate }));
  }
  return ok({ set, rules: found.rules });
}

/**
 * `resolveRules` for an input that already carries a setup (a state or an observation): the version must resolve
 * AND its `layout` / `letters` must be in the set's lists (ADR-0014 §D2). Without the second check, a frozen
 * version could be paired with draft tables (`engineRulesVersion: 1` with `classic-v2`) and bypass the draft guard
 * (review of E6). A mismatch is `INVALID_CONFIG` with `details.field`, as in `createMatch`.
 */
export function resolveSetup(
  version: unknown,
  setup: Pick<MatchSetup, 'layout' | 'letters'>,
  draft: DraftContext | undefined,
): Result<ResolvedRules, EngineError> {
  const resolved = resolveRules(version, draft);
  if (!resolved.ok) return resolved;
  const { set } = resolved.value;
  for (const [field, id, allowed] of [
    ['config.layout', setup.layout, set.layouts],
    ['config.letters', setup.letters, set.letterTables],
  ] as const) {
    if (!(allowed as readonly string[]).includes(id)) {
      return err({
        kind: 'engine',
        code: 'INVALID_CONFIG',
        message: `invalid match config at ${field}`,
        details: { field },
      });
    }
  }
  return resolved;
}
