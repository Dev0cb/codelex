/**
 * The persistence side of a vs-bot match, without React (E-1.5 AC-11, AC-12; threat model TM-01, TM-02, D-3): what
 * the app finds at start, and what it writes after each accepted action and at the end of a match. The provider
 * (`match/match-session.tsx`) and the process-kill tests drive exactly these functions.
 */
import { stateHash, type EngineContext, type MatchState } from '@codelex/game-engine';

import type { MatchModel } from '../match/match-model';
import { HUMAN_SEAT } from '../match/play-config';
import { DataStore, type FsPrimitives } from './data-store';
import { FILES, MatchJournal, readSnapshot, readStoredLog, SNAPSHOT_EVERY } from './match-journal';
import { restoreMatch, type Divergence, type RestorePath } from './resume';
import { TermsSeen } from './terms-seen';

/** Counts resume attempts that did not return (TM-02 D-1). */
export const GUARD_FILE = 'resume.guard';
/** Two consecutive unclean exits during resume show the corrupt card instead of a third attempt. */
export const MAX_UNCLEAN_RESUMES = 2;

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
  store.recover();
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

/**
 * The saved match at start (Q7 resume, TM-02). Never throws: any failure is `state_corrupt`. A resume that crashed
 * the app twice in a row is not attempted again (D-1 crash counter).
 */
export function openSavedMatch(persistence: Persistence, ctx: EngineContext): SavedMatch {
  const { store } = persistence;
  try {
    const attempts = readGuard(store);
    if (attempts >= MAX_UNCLEAN_RESUMES) {
      store.remove(GUARD_FILE);
      return { kind: 'state_corrupt', divergence: null };
    }
    store.replace(GUARD_FILE, [String(attempts + 1)]);
    const saved = open(persistence, ctx);
    store.remove(GUARD_FILE);
    return saved;
  } catch {
    return { kind: 'state_corrupt', divergence: null };
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
): PersistOutcome {
  if (after.actions.length === before.actions.length) return 'unchanged';
  const action = after.actions[after.actions.length - 1];
  if (action === undefined || after.actions.length !== before.actions.length + 1) return 'failed';
  if (!journal.commit(action, stateHash(after.state))) return 'failed';
  if (after.state.actionCount % SNAPSHOT_EVERY === 0) journal.snapshot(after.state);
  return 'saved';
}

/** `app_backgrounded` (Q7): a snapshot of the match in progress, so the next resume is short. */
export function snapshotOnBackground(journal: MatchJournal, state: MatchState): void {
  if (state.status === 'in_progress') journal.snapshot(state);
}
