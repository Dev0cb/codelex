/**
 * The on-device match log and snapshot (API note §20 Q7 write path, threat model TM-01, TM-02, D-3).
 *
 * Files in the app's private data directory (no wall-clock time, no identifier, no PII in any of them):
 * - `current.log`: the in-progress match. Record 0 = `{ logVersion, header }` (the engine's `MatchConfig`), then one
 *   record `{ a, h }` per accepted action: the canonical action and `stateHash` after it. It is the source of truth.
 * - `current.snap`: `serializeState` every {@link SNAPSHOT_EVERY} actions and on `app_backgrounded`, written after
 *   the log append; a cache only (never trusted without a hash match, `resume.ts`).
 * - `last.log`: the last finished match, kept for "Send match log" (slice S6). Retention is these two logs only.
 *
 * `commit` returns true only once the record is with the OS; the UI shows a move as committed after that. A failed
 * write (full disk) returns false: play continues from memory, and the next successful write rewrites the whole log
 * atomically, so a gap or a torn record never stays in the middle of the file.
 */
import {
  serializeState,
  type Action,
  type ActionLog,
  type MatchConfig,
  type MatchState,
  type StateHash,
} from '@codelex/game-engine';

import type { DataStore, ReadRecords } from './data-store';

export const FILES = {
  log: 'current.log',
  snapshot: 'current.snap',
  last: 'last.log',
} as const;

/** TM-02 size caps, checked before any parsing (a 1v1 log is about 5 KB). */
export const LOG_MAX_BYTES = 256 * 1024;
export const SNAPSHOT_MAX_BYTES = 64 * 1024;
/** Q7: a snapshot every N actions (plus one on `app_backgrounded`). */
export const SNAPSHOT_EVERY = 10;

/** JSON with every non-ASCII character escaped, so records stay ASCII (`records.ts`). */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

const headerRecord = (header: MatchConfig): string => asciiJson({ logVersion: 1, header });
const actionRecord = (action: Action, hash: StateHash): string => asciiJson({ a: action, h: hash });

export class MatchJournal {
  /** Every record of the current log, to rewrite it after a failed write. */
  private records: string[] = [];
  private dirty = false;

  constructor(private readonly store: DataStore) {}

  private attempt(write: () => void): boolean {
    try {
      write();
      return true;
    } catch {
      return false;
    }
  }

  private rewrite(): boolean {
    const ok = this.attempt(() => {
      this.store.replace(FILES.log, this.records);
    });
    this.dirty = !ok;
    return ok;
  }

  /** A new match: drops any previous in-progress match, then writes the header record. */
  start(header: MatchConfig): boolean {
    this.records = [headerRecord(header)];
    const removed = this.attempt(() => {
      this.store.remove(FILES.snapshot);
    });
    return this.rewrite() && removed;
  }

  /** Continue a restored match: its records are the log on disk (rewritten if it had a torn tail). */
  adopt(log: ActionLog, droppedTail: boolean): boolean {
    // Stored logs always carry one hash per action (`parseActionLog` checks the lengths).
    const hashes = log.stateHashes ?? [];
    this.records = [headerRecord(log.header)];
    log.actions.forEach((action, i) => {
      const hash = hashes[i];
      if (hash !== undefined) this.records.push(actionRecord(action, hash));
    });
    this.dirty = droppedTail;
    return droppedTail ? this.rewrite() : true;
  }

  /** One accepted action (Q7): true once the record is written. */
  commit(action: Action, hash: StateHash): boolean {
    const record = actionRecord(action, hash);
    this.records.push(record);
    if (this.dirty) return this.rewrite();
    const ok = this.attempt(() => {
      this.store.append(FILES.log, [record]);
    });
    this.dirty = !ok;
    return ok;
  }

  /** Q7: only after the log append for `state` succeeded, so a snapshot is never ahead of the log. */
  snapshot(state: MatchState): boolean {
    if (this.dirty) return false;
    return this.attempt(() => {
      this.store.replace(FILES.snapshot, [serializeState(state)]);
    });
  }

  /** The match is over: it becomes the last finished match (rotation), its snapshot goes. */
  finish(): boolean {
    if (this.dirty && !this.rewrite()) return false;
    return this.attempt(() => {
      this.store.move(FILES.log, FILES.last);
      this.store.remove(FILES.snapshot);
    });
  }

  /** "Start a new match" over an unusable or abandoned match (§5.10.2): the match is deleted. */
  abandon(): boolean {
    this.records = [];
    this.dirty = false;
    return this.attempt(() => {
      this.store.remove(FILES.snapshot);
      this.store.remove(FILES.log);
    });
  }
}

/** What `current.log` holds, before the engine looks at it. */
export type StoredLog =
  | { readonly kind: 'none' }
  | { readonly kind: 'corrupt' }
  | { readonly kind: 'ok'; readonly text: string; readonly droppedTail: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The stored log as one `ActionLog` JSON text for `parseActionLog`, which does every check of content (strict
 * schema, canonical actions, versions). Here only the framing and the record envelopes are checked.
 */
export function storedLog(read: ReadRecords): StoredLog {
  if (read.kind === 'missing') return { kind: 'none' };
  if (read.kind !== 'ok') return { kind: 'corrupt' };
  const [first, ...rest] = read.records;
  // Only a torn header: no move was ever committed.
  if (first === undefined) return { kind: 'none' };
  const head = parseJson(first);
  if (!isRecord(head) || Object.keys(head).length !== 2 || !('header' in head)) {
    return { kind: 'corrupt' };
  }
  const actions: unknown[] = [];
  const stateHashes: unknown[] = [];
  for (const text of rest) {
    const record = parseJson(text);
    if (
      !isRecord(record) ||
      Object.keys(record).length !== 2 ||
      !('a' in record) ||
      !('h' in record)
    ) {
      return { kind: 'corrupt' };
    }
    actions.push(record['a']);
    stateHashes.push(record['h']);
  }
  const text = JSON.stringify({
    logVersion: head['logVersion'],
    header: head['header'],
    actions,
    stateHashes,
  });
  return { kind: 'ok', text, droppedTail: read.droppedTail };
}

export function readStoredLog(store: DataStore): StoredLog {
  return storedLog(store.read(FILES.log, LOG_MAX_BYTES));
}

/** The snapshot text, or null when it is missing, too large or unreadable (it is only a cache). */
export function readSnapshot(store: DataStore): string | null {
  const read = store.read(FILES.snapshot, SNAPSHOT_MAX_BYTES);
  return read.kind === 'ok' && read.records.length === 1 && !read.droppedTail
    ? (read.records[0] ?? null)
    : null;
}
