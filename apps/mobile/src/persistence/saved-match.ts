/**
 * The persistence side of a vs-bot match, without React (E-1.5 AC-11, AC-12; threat model TM-01, TM-02, D-3): what
 * the app finds at start, and what it writes after each accepted action and at the end of a match. The provider
 * (`match/match-session.tsx`) and the process-kill tests drive exactly these functions.
 */
import {
  apply,
  stateHash,
  type EngineContext,
  type MatchState,
  type StateHash,
} from '@codelex/game-engine';

import { MATCH_LOG_GUARD_FILE } from '../match-log/match-log-file';
import type { MatchModel } from '../match/match-model';
import { HUMAN_SEAT } from '../match/play-config';
import { DataStore, TMP_SUFFIX, type FsPrimitives } from './data-store';
import {
  FILES,
  LOG_MAX_BYTES,
  MatchJournal,
  readSnapshot,
  readStoredLog,
  SNAPSHOT_EVERY,
  storedLog,
} from './match-journal';
import { restoreMatch, type Divergence, type RestorePath } from './resume';
import { TERMS_FILE, TermsSeen } from './terms-seen';

/** Counts resume attempts that did not return (TM-02 D-1). */
export const GUARD_FILE = 'resume.guard';
/** Two consecutive unclean exits during resume show the corrupt card instead of a third attempt. */
export const MAX_UNCLEAN_RESUMES = 2;

/**
 * The files match persistence owns in the shared data directory. Analytics and settings (slice S6a) live there too
 * (threat model TM-03, R1-4): "nothing saved" and `recover` look at these names only.
 */
export const MATCH_FILE_NAMES: ReadonlySet<string> = new Set([
  FILES.log,
  FILES.snapshot,
  FILES.last,
  TERMS_FILE,
  GUARD_FILE,
  MATCH_LOG_GUARD_FILE,
]);
const isMatchFile = (name: string): boolean =>
  MATCH_FILE_NAMES.has(name.endsWith(TMP_SUFFIX) ? name.slice(0, -TMP_SUFFIX.length) : name);

export interface Persistence {
  readonly store: DataStore;
  readonly journal: MatchJournal;
  readonly terms: TermsSeen;
}

export function createPersistence(fs: FsPrimitives): Persistence {
  const store = new DataStore(fs);
  return { store, journal: new MatchJournal(store), terms: new TermsSeen(store) };
}

export type SavedMatch =
  | { readonly kind: 'none' }
  | { readonly kind: 'resumable'; readonly model: MatchModel; readonly path: RestorePath }
  | { readonly kind: 'version_mismatch' }
  | { readonly kind: 'state_corrupt'; readonly divergence: Divergence | null };

function readGuard(store: DataStore): number {
  const read = store.read(GUARD_FILE, 64);
  const count = read.kind === 'ok' ? Number(read.records[0]) : 0;
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

/** Canonical term ids the player played (E-1.7 AC-12: one id per canonical term). */
export function playedTermIds(model: MatchModel): string[] {
  const ids = new Set<string>();
  for (const entry of model.log) {
    if (entry.kind !== 'word' || entry.seat !== HUMAN_SEAT) continue;
    for (const word of entry.breakdown.words) ids.add(word.termId);
  }
  return [...ids];
}

/**
 * A finished match: the "New to you" history takes its terms, then its log becomes the last finished match. Both
 * steps are idempotent, so a kill in between is finished at the next start. Returns the terms new to the player.
 */
export function finishMatch(persistence: Persistence, model: MatchModel): ReadonlySet<string> {
  const fresh = persistence.terms.record(playedTermIds(model));
  persistence.journal.finish();
  return fresh;
}

function open(persistence: Persistence, ctx: EngineContext): SavedMatch {
  const { store, journal } = persistence;
  store.recover((name) => MATCH_FILE_NAMES.has(name));
  // A snapshot never outlives its log (rotation removes the log first).
  if (!store.exists(FILES.log)) {
    store.remove(FILES.snapshot);
    return { kind: 'none' };
  }
  const restored = restoreMatch(readStoredLog(store), readSnapshot(store), ctx);
  switch (restored.kind) {
    case 'none':
      journal.abandon();
      return restored;
    case 'version_mismatch':
    case 'state_corrupt':
      // Kept until the player taps "Start a new match" (§5.10.2), for "Send match log" (slice S6).
      return restored;
    case 'restored':
      if (restored.model.state.status === 'finished') {
        // Killed after the last move but before the rotation: finish it now; the Summary is not rebuilt (§5.6).
        finishMatch(persistence, restored.model);
        return { kind: 'none' };
      }
      journal.adopt(restored.log, restored.droppedTail);
      return { kind: 'resumable', model: restored.model, path: restored.path };
  }
}

/** Runs a best-effort write; a failure (full disk) is not an error for the caller. */
function bestEffort(write: () => void): void {
  try {
    write();
  } catch {
    // Low storage: see the callers.
  }
}

const CORRUPT: SavedMatch = { kind: 'state_corrupt', divergence: null };

/**
 * The saved match at start (Q7 resume, TM-02). Never throws: a log that cannot be read is `state_corrupt`. A resume
 * that crashed the app twice in a row is not attempted again (D-1 crash counter). The counter is best effort: on a
 * full disk it cannot be written, and the resume runs anyway, because calling a healthy match corrupt would let
 * "Start a new match" delete it. With nothing saved (first launch, or a paused build that never played) nothing is
 * written at all.
 */
export function openSavedMatch(persistence: Persistence, ctx: EngineContext): SavedMatch {
  const { store } = persistence;
  try {
    if (!store.list().some(isMatchFile)) return { kind: 'none' };
  } catch {
    return { kind: 'none' };
  }
  let attempts = 0;
  try {
    attempts = readGuard(store);
  } catch {
    // An unreadable counter counts as no counter.
  }
  if (attempts >= MAX_UNCLEAN_RESUMES) {
    bestEffort(() => {
      store.remove(GUARD_FILE);
    });
    return CORRUPT;
  }
  bestEffort(() => {
    store.replace(GUARD_FILE, [String(attempts + 1)]);
  });
  let saved: SavedMatch;
  try {
    saved = open(persistence, ctx);
  } catch {
    saved = CORRUPT;
  }
  bestEffort(() => {
    store.remove(GUARD_FILE);
  });
  return saved;
}

/**
 * The last finished match (`last.log`), replayed; null when there is none or it cannot be read. Analytics only: a
 * match whose end was saved but not yet reported when the process died (`match/match-telemetry.ts`). Never throws.
 */
export function readLastFinished(persistence: Persistence, ctx: EngineContext): MatchModel | null {
  try {
    const restored = restoreMatch(
      storedLog(persistence.store.read(FILES.last, LOG_MAX_BYTES)),
      null,
      ctx,
    );
    return restored.kind === 'restored' && restored.model.state.status === 'finished'
      ? restored.model
      : null;
  } catch {
    return null;
  }
}

export type PersistOutcome = 'unchanged' | 'saved' | 'failed';

/**
 * After a command: if the engine accepted an action, its record is written before the caller shows the move as
 * committed (Q7, TM-01), then a snapshot every {@link SNAPSHOT_EVERY} actions. `failed` = the record is not on disk
 * (low storage); play continues from memory and the next write rewrites the log.
 */
export function persistTransition(
  journal: MatchJournal,
  before: MatchModel,
  after: MatchModel,
  ctx: EngineContext,
): PersistOutcome {
  const added = after.actions.slice(before.actions.length);
  if (added.length === 0) return 'unchanged';
  // One command applies one action today. If more ever arrive at once, each still gets its record and the hash of
  // the state after it (re-applied from `before`), so the log never skips a move.
  let state = before.state;
  let ok = true;
  for (const [i, action] of added.entries()) {
    let hash: StateHash;
    if (i === added.length - 1) {
      hash = stateHash(after.state);
    } else {
      const applied = apply(state, action, ctx);
      if (!applied.ok) {
        journal.invalidate();
        return 'failed';
      }
      state = applied.value.state;
      hash = stateHash(state);
    }
    ok = journal.commit(action, hash) && ok;
  }
  if (!ok) return 'failed';
  if (after.state.actionCount % SNAPSHOT_EVERY === 0) journal.snapshot(after.state);
  return 'saved';
}

/** `app_backgrounded` (Q7): a snapshot of the match in progress, so the next resume is short. */
export function snapshotOnBackground(journal: MatchJournal, state: MatchState): void {
  if (state.status === 'in_progress') journal.snapshot(state);
}
