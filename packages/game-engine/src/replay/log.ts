/**
 * Action log and replay (ADR-0013 §D2, API note §14.2). A log is the match header (`MatchConfig`) plus the
 * accepted actions in canonical form; replaying it from the header reproduces every state bit for bit. The rules
 * version comes from `header.engineRulesVersion` (ADR-0014 §D3): logs of every registered version share this code.
 */
import { err, ok, type Result } from '@codelex/config/result';
import { parseAction } from '../actions/parse.js';
import { canonicalJson } from '../hash/jcs.js';
import { apply } from '../match/apply.js';
import { configProblem, createMatch, isPlainObject } from '../match/create.js';
import { resolveRules, type RulesVersionError } from '../rules/registry.js';
import { stateHash } from '../state/state.js';
import type {
  Action,
  DraftContext,
  EngineContext,
  MatchConfig,
  MatchState,
  Rejection,
  RulesVersionDetails,
  StateHash,
} from '../types.js';

/** Action-log envelope version this build writes (ADR-0013 §D2). */
export const LOG_VERSION = 1;

export interface ActionLog {
  readonly logVersion: 1;
  readonly header: MatchConfig;
  /** Accepted actions only, canonical form. */
  readonly actions: readonly Action[];
  /** Optional; state hash after each action, same length as actions. */
  readonly stateHashes?: readonly StateHash[];
  /** Optional; present once the match is over. */
  readonly final?: { readonly stateHash: StateHash; readonly actionCount: number };
}

export type ReplayError =
  | {
      readonly kind: 'replay';
      readonly code: 'LOG_VERSION_UNSUPPORTED';
      readonly message: string;
      readonly details: { readonly logVersion: number };
    }
  /** Same details as the engine error (ADR-0014 §D6; API note §20 Q3 item 1). */
  | {
      readonly kind: 'replay';
      readonly code: 'RULES_VERSION_UNSUPPORTED';
      readonly message: string;
      readonly details: RulesVersionDetails;
    }
  | {
      readonly kind: 'replay';
      readonly code: 'LEXICON_MISMATCH';
      readonly message: string;
      readonly details: { readonly expected: string; readonly actual: string };
    }
  /**
   * Schema violation, unknown key, non-canonical action, INVALID_CONFIG header, length mismatches; `from` that no
   * checkpoint of the log can verify (`from.actionCount` out of range, or no `stateHashes`) or that cannot be
   * hashed (a value outside the JCS subset: path `from`).
   */
  | {
      readonly kind: 'replay';
      readonly code: 'MALFORMED_LOG';
      readonly message: string;
      readonly details: { readonly path: string };
    }
  | {
      readonly kind: 'replay';
      readonly code: 'ACTION_REJECTED';
      readonly message: string;
      readonly details: { readonly index: number; readonly rejection: Rejection };
    }
  /**
   * index = action index; 'final' when the final checkpoint differs; 'from' when the `from` snapshot differs from
   * the log's checkpoint at `from.actionCount` (a tampered or foreign snapshot, API note §20 Q7).
   */
  | {
      readonly kind: 'replay';
      readonly code: 'HASH_MISMATCH';
      readonly message: string;
      readonly details: {
        readonly index: number | 'final' | 'from';
        readonly expected: StateHash;
        readonly actual: StateHash;
      };
    };

export interface ReplayOutcome {
  readonly state: MatchState;
  readonly finalHash: StateHash;
  /**
   * Present iff options.recordHashes: hash after each action (to write stateHashes into a log). With `from`, the
   * hashes before `from.actionCount − 1` are copied from the log WITHOUT being recomputed; only the checkpoint at
   * `from.actionCount − 1` is checked (against the snapshot), and every hash from there on is recomputed.
   */
  readonly stateHashes?: readonly StateHash[];
}

/** Options of `replay` (API note §14.2, §20 Q7). */
export interface ReplayOptions {
  /** Return the hash after each action in `stateHashes`. */
  readonly recordHashes?: boolean;
  /**
   * Resume from a snapshot (a state from `parseState`) instead of the initial state. It is used only if
   * `stateHash(from)` equals the log's checkpoint at `from.actionCount` (`stateHashes[from.actionCount − 1]`,
   * or the initial state's hash for 0); otherwise `HASH_MISMATCH` with `index: 'from'`. Then only the tail
   * `actions[from.actionCount…]` is applied.
   */
  readonly from?: MatchState;
  /**
   * Which stored checkpoints are verified: 'all' (default) every `stateHashes[i]` that is applied; 'final' only
   * the last action's stored hash, plus `final` (the fast resume path; on a mismatch, replay again with 'all' to
   * locate the first divergent index).
   */
  readonly verify?: 'all' | 'final';
}

/** Options of `parseActionLog`. `draft` opts in to a draft rules version (ADR-0014 §D4). */
export interface ParseLogOptions {
  readonly draft?: DraftContext;
}

const HEX16 = /^[0-9a-f]{16}$/;
const LOG_KEYS = ['actions', 'final', 'header', 'logVersion', 'stateHashes'];
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const malformedLog = (path: string): ReplayError => ({
  kind: 'replay',
  code: 'MALFORMED_LOG',
  message: `malformed action log at ${path === '' ? '<root>' : path}`,
  details: { path },
});

/** A version number for error details: the value if it is a safe integer, else -1 (never NaN; review R1 n4). */
const versionOrMinusOne = (x: unknown): number => (Number.isSafeInteger(x) ? (x as number) : -1);

/** An empty log for a new match. */
export function newActionLog(config: MatchConfig): ActionLog {
  return { logVersion: LOG_VERSION, header: config, actions: [] };
}

/** The JCS text of a log. */
export function serializeActionLog(log: ActionLog): string {
  return canonicalJson(log);
}

/** The replay form of an engine `RULES_VERSION_UNSUPPORTED`: same message and details. */
const replayVersionError = (e: RulesVersionError): ReplayError => ({
  kind: 'replay',
  code: 'RULES_VERSION_UNSUPPORTED',
  message: e.message,
  details: e.details,
});

/**
 * Parses a log. Order: JSON → `logVersion` → `header.engineRulesVersion` (registered; a draft needs
 * `options.draft`, ADR-0014 §D4) → strict schema (unknown keys rejected; layout and letters per version) →
 * canonical form of every action → `stateHashes.length === actions.length` → `final.actionCount`.
 */
export function parseActionLog(
  text: string,
  options?: ParseLogOptions,
): Result<ActionLog, ReplayError> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return err(malformedLog(''));
  }
  if (!isPlainObject(doc)) return err(malformedLog(''));
  if (doc['logVersion'] !== LOG_VERSION) {
    return err({
      kind: 'replay',
      code: 'LOG_VERSION_UNSUPPORTED',
      message: 'unsupported logVersion',
      details: { logVersion: versionOrMinusOne(doc['logVersion']) },
    });
  }
  const header = doc['header'];
  const version = isPlainObject(header) ? header['engineRulesVersion'] : undefined;
  const resolved = resolveRules(version, options?.draft);
  if (!resolved.ok) return err(replayVersionError(resolved.error));
  // First unknown key in code-unit order, not in document order (deterministic reporting).
  const extra = Object.keys(doc)
    .sort(byCodeUnit)
    .find((k) => !LOG_KEYS.includes(k));
  if (extra !== undefined) return err(malformedLog(extra));
  const headerProblem = configProblem(header as MatchConfig, resolved.value.set);
  if (headerProblem !== undefined) {
    return err(malformedLog(headerProblem === '' ? 'header' : `header.${headerProblem}`));
  }
  const config = header as MatchConfig;

  const actions = doc['actions'];
  if (!Array.isArray(actions)) return err(malformedLog('actions'));
  const parsed: Action[] = [];
  for (let i = 0; i < actions.length; i += 1) {
    const raw: unknown = (actions as unknown[])[i];
    const action = parseAction(raw, config.config.seats);
    // Canonical only: the parsed (canonical) action must serialise to the same text as the logged one.
    if (!action.ok || !sameJson(action.value, raw))
      return err(malformedLog(`actions[${String(i)}]`));
    parsed.push(action.value);
  }

  const out: { -readonly [K in keyof ActionLog]: ActionLog[K] } = {
    logVersion: LOG_VERSION,
    header: config,
    actions: parsed,
  };
  if (Object.hasOwn(doc, 'stateHashes')) {
    const hashes = doc['stateHashes'];
    if (
      !Array.isArray(hashes) ||
      hashes.length !== parsed.length ||
      !(hashes as unknown[]).every((h) => typeof h === 'string' && HEX16.test(h))
    ) {
      return err(malformedLog('stateHashes'));
    }
    out.stateHashes = hashes as StateHash[];
  }
  if (Object.hasOwn(doc, 'final')) {
    const final = doc['final'];
    if (
      !isPlainObject(final) ||
      Object.keys(final).length !== 2 ||
      typeof final['stateHash'] !== 'string' ||
      !HEX16.test(final['stateHash']) ||
      final['actionCount'] !== parsed.length
    ) {
      return err(malformedLog('final'));
    }
    out.final = { stateHash: final['stateHash'] as StateHash, actionCount: parsed.length };
  }
  return ok(out);
}

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return canonicalJson(a) === canonicalJson(b);
  } catch {
    return false;
  }
}

function hashMismatch(
  index: number | 'final' | 'from',
  expected: StateHash,
  actual: StateHash,
): ReplayError {
  return {
    kind: 'replay',
    code: 'HASH_MISMATCH',
    message: `state hash mismatch at ${String(index)}`,
    details: { index, expected, actual },
  };
}

/**
 * `createMatch(header)`, then `apply` per action, verifying the stored checkpoints (first divergence wins) and
 * `final.stateHash`. The rules version (draft opt-in and candidate from `ctx.draft`) and the lexicon are checked
 * once, before the first action. With `options.from`, the snapshot is verified against the log's checkpoint and
 * only the tail is applied (API note §20 Q7): resuming from any verified snapshot reaches the same final state and
 * hash as a full replay.
 */
export function replay(
  log: ActionLog,
  ctx: EngineContext,
  options?: ReplayOptions,
): Result<ReplayOutcome, ReplayError> {
  const resolved = resolveRules(log.header.engineRulesVersion, ctx.draft);
  if (!resolved.ok) return err(replayVersionError(resolved.error));
  const created = createMatch(log.header, ctx);
  if (!created.ok) {
    const e = created.error;
    if (e.code === 'LEXICON_MISMATCH') {
      return err({
        kind: 'replay',
        code: 'LEXICON_MISMATCH',
        message: e.message,
        details: {
          expected: String(e.details?.['expected']),
          actual: String(e.details?.['actual']),
        },
      });
    }
    return err(malformedLog(`header.${String(e.details?.['field'] ?? '')}`));
  }
  const record = options?.recordHashes === true;
  const stored = log.stateHashes;
  const verifyAll = options?.verify !== 'final';
  const last = log.actions.length - 1;
  const hashes: StateHash[] = [];
  let state = created.value.state;
  let start = 0;

  const from = options?.from;
  if (from !== undefined) {
    const k = from.actionCount;
    if (!Number.isSafeInteger(k) || k < 0 || k > log.actions.length) {
      return err(malformedLog('from.actionCount'));
    }
    const expected = k === 0 ? stateHash(state) : stored?.[k - 1];
    if (expected === undefined) return err(malformedLog('stateHashes'));
    // A hand-built snapshot may hold values outside the JCS subset (NaN, -0, booleans): never throw.
    let actual: StateHash;
    try {
      actual = stateHash(from);
    } catch {
      return err(malformedLog('from'));
    }
    if (actual !== expected) return err(hashMismatch('from', expected, actual));
    if (record) hashes.push(...(stored ?? []).slice(0, k));
    state = from;
    start = k;
  }

  let finalHash: StateHash | undefined;
  for (let i = start; i <= last; i += 1) {
    const action = log.actions[i] as Action;
    const applied = apply(state, action, ctx);
    if (!applied.ok) {
      const e = applied.error;
      if (e.kind === 'rejection') {
        return err({
          kind: 'replay',
          code: 'ACTION_REJECTED',
          message: `action ${String(i)} rejected: ${e.code}`,
          details: { index: i, rejection: e },
        });
      }
      return err(malformedLog(`actions[${String(i)}]`));
    }
    state = applied.value.state;
    const expected = verifyAll || i === last ? stored?.[i] : undefined;
    if (record || expected !== undefined) {
      const actual = stateHash(state);
      if (expected !== undefined && expected !== actual)
        return err(hashMismatch(i, expected, actual));
      hashes.push(actual);
      if (i === last) finalHash = actual;
    }
  }
  // A final checkpoint exists only once the match is over (ADR-0013 §D2; review R1 n5).
  if (log.final !== undefined && state.status !== 'finished') return err(malformedLog('final'));
  finalHash ??= stateHash(state);
  if (log.final !== undefined && log.final.stateHash !== finalHash) {
    return err(hashMismatch('final', log.final.stateHash, finalHash));
  }
  return ok(record ? { state, finalHash, stateHashes: hashes } : { state, finalHash });
}
