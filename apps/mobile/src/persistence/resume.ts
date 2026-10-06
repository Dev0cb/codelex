/**
 * Resume (E-1.5 AC-11, API note §20 Q7 steps 1–5, threat model TM-02). The log is the source of truth; the snapshot
 * only makes resume faster and is used only when `replay(log, ctx, { from, verify: 'final' })` accepts it, i.e. its
 * hash equals the log's checkpoint (tampered, foreign or stale snapshots are ignored). Nothing stored is trusted on
 * its own: the restored state, scores included, is always the output of `replay`, never a stored value.
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
  type ReplayOutcome,
  type StateHash,
} from '@codelex/game-engine';
import type { Result } from '@codelex/config/result';

import { modelFromActions, type MatchModel } from '../match/match-model';
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

function locate(log: ActionLog, ctx: EngineContext): Divergence | null {
  const all = replay(log, ctx, { verify: 'all' });
  return !all.ok && all.error.code === 'HASH_MISMATCH' ? all.error.details : null;
}

function restore(stored: StoredLog, snapshot: string | null, ctx: EngineContext): Restored {
  if (stored.kind === 'none') return { kind: 'none' };
  if (stored.kind === 'corrupt') return CORRUPT;
  // Step 1: the header and every record, strictly (versions first: an unknown or draft version is refused).
  const parsed = parseActionLog(stored.text);
  if (!parsed.ok) return isVersionError(parsed.error) ? VERSION_MISMATCH : CORRUPT;
  const log = parsed.value;
  // Steps 2–3: from the snapshot when its hash matches the log, then the tail; only the last hash is checked.
  const from = usableSnapshot(snapshot, log);
  let path: RestorePath = 'snapshot';
  let outcome: Result<ReplayOutcome, ReplayError> | null =
    from === null ? null : replay(log, ctx, { from, verify: 'final' });
  // Step 4: any failure there means a replay from the start.
  if (outcome === null || !outcome.ok) {
    path = 'full_replay';
    outcome = replay(log, ctx, { verify: 'final' });
  }
  if (!outcome.ok) {
    if (isVersionError(outcome.error)) return VERSION_MISMATCH;
    // Step 4, second half: only on a failure, verify every checkpoint to find the first divergence.
    return { kind: 'state_corrupt', divergence: locate(log, ctx) };
  }
  // The screen needs the engine's events of every move (owners, move log, breakdowns).
  const model = modelFromActions(log.header, log.actions, ctx);
  if (model === null || stateHash(model.state) !== outcome.value.finalHash) return CORRUPT;
  return { kind: 'restored', log, model, path, droppedTail: stored.droppedTail };
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
