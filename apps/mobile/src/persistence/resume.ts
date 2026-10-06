/**
 * Resume (E-1.5 AC-11, API note §20 Q7 steps 1–5, threat model TM-02). The log is the source of truth. A snapshot is
 * checked with `replay(log, ctx, { from, verify: 'final' })` (tampered, foreign or stale snapshots are ignored), but
 * it cannot shorten resume in this app: the screen needs the engine's events of every move, so the log is applied
 * once from the start in the same pass that builds the model, and that pass checks the last stored hash (Q7 step 4,
 * final hash only). Nothing stored is trusted on its own: the restored state, scores included, is always the output
 * of the engine's `apply`, never a stored value. Cost: one pass over the log, plus at most one snapshot tail; the
 * device target (resume p95 ≤ 300 ms on the reference Android) is measured in H1.
 *
 * Every failure maps to `version_mismatch` (rules or lexicon version this build cannot replay, ADR-0014 §D3) or
 * `state_corrupt`; this function never throws (a catch-all guards against a crash loop at start, TM-02 D-1).
 */
import {
  parseActionLog,
  parseState,
  replay,
  stateHash,
  type ActionLog,
  type EngineContext,
  type MatchState,
  type ReplayError,
  type StateHash,
} from '@codelex/game-engine';

import { rebuildModel, type MatchModel } from '../match/match-model';
import type { StoredLog } from './match-journal';

/** How the state was rebuilt (TM-10 `restore_path`, for analytics in slice S6). */
export type RestorePath = 'snapshot' | 'full_replay';

/** First divergent checkpoint of a log that failed to replay, for "Send match log" (TM-04, slice S6). */
export interface Divergence {
  readonly index: number | 'final' | 'from';
  readonly expected: StateHash;
  readonly actual: StateHash;
}

export type Restored =
  | { readonly kind: 'none' }
  | { readonly kind: 'version_mismatch' }
  | { readonly kind: 'state_corrupt'; readonly divergence: Divergence | null }
  | {
      readonly kind: 'restored';
      readonly log: ActionLog;
      readonly model: MatchModel;
      readonly path: RestorePath;
      /** A torn last record was dropped: the journal rewrites the log without it. */
      readonly droppedTail: boolean;
    };

const CORRUPT: Restored = { kind: 'state_corrupt', divergence: null };
const VERSION_MISMATCH: Restored = { kind: 'version_mismatch' };

const isVersionError = (e: ReplayError): boolean =>
  e.code === 'LOG_VERSION_UNSUPPORTED' ||
  e.code === 'RULES_VERSION_UNSUPPORTED' ||
  e.code === 'LEXICON_MISMATCH';

/** Q7 step 2: the snapshot, when it parses and lies inside the log; the hash check is `replay`'s. */
function usableSnapshot(text: string | null, log: ActionLog): MatchState | null {
  if (text === null) return null;
  const parsed = parseState(text);
  if (!parsed.ok) return null;
  const k = parsed.value.actionCount;
  return k >= 1 && k <= log.actions.length ? parsed.value : null;
}

/** First checkpoint the rebuilt states disagree with, from the states the single pass already holds. */
function locate(states: readonly MatchState[], hashes: readonly StateHash[]): Divergence | null {
  for (const [i, expected] of hashes.entries()) {
    const state = states[i + 1];
    if (state === undefined) return null;
    const actual = stateHash(state);
    if (actual !== expected) return { index: i, expected, actual };
  }
  return null;
}

function restore(stored: StoredLog, snapshot: string | null, ctx: EngineContext): Restored {
  if (stored.kind === 'none') return { kind: 'none' };
  if (stored.kind === 'corrupt') return CORRUPT;
  // Step 1: the header and every record, strictly (versions first: an unknown or draft version is refused).
  const parsed = parseActionLog(stored.text);
  if (!parsed.ok) return isVersionError(parsed.error) ? VERSION_MISMATCH : CORRUPT;
  const log = parsed.value;
  const hashes = log.stateHashes ?? [];
  // Steps 2–3: a snapshot is used only when `replay` accepts it (its hash equals the log's checkpoint) and the tail
  // re-applied from it reaches the last stored hash. It is a check of at most SNAPSHOT_EVERY actions here.
  const from = usableSnapshot(snapshot, log);
  let path: RestorePath = 'full_replay';
  if (from !== null) {
    const tail = replay(log, ctx, { from, verify: 'final' });
    if (tail.ok) path = 'snapshot';
    else if (isVersionError(tail.error)) return VERSION_MISMATCH;
  }
  // Step 4 (replay from the start, final hash only) and the model in the same single pass: the screen needs the
  // engine's events of every move (owners, move log, breakdowns), so the start is always replayed once.
  const rebuilt = rebuildModel(log.header, log.actions, ctx);
  if (!rebuilt.ok) {
    if (rebuilt.error.kind === 'version') return VERSION_MISMATCH;
    return { kind: 'state_corrupt', divergence: locate(rebuilt.states, hashes) };
  }
  const last = hashes.at(-1);
  if (last !== undefined && stateHash(rebuilt.model.state) !== last) {
    // Only on a failure: every checkpoint, from the states already rebuilt (no further replay).
    return { kind: 'state_corrupt', divergence: locate(rebuilt.states, hashes) };
  }
  return { kind: 'restored', log, model: rebuilt.model, path, droppedTail: stored.droppedTail };
}

/** Q7 resume; never throws. */
export function restoreMatch(
  stored: StoredLog,
  snapshot: string | null,
  ctx: EngineContext,
): Restored {
  try {
    return restore(stored, snapshot, ctx);
  } catch {
    return CORRUPT;
  }
}
