/**
 * "New to you" history (E-1.5 AC-10, design §5.6, D-15): the canonical term ids the player has played on this device.
 * Term ids are immutable across `lexiconVersion`s (design §13.2), so the history survives lexicon updates. One record
 * (a sorted JSON array of ids), replaced atomically; no time, no identifier, nothing about the opponent.
 */
import { asciiJson } from './match-journal';
import type { DataStore } from './data-store';

export const TERMS_FILE = 'terms.seen';
export const TERMS_MAX_BYTES = 256 * 1024;
/** A term id is a short lexicon key; anything else in the file is ignored. */
const MAX_ID_LENGTH = 128;

const NONE: ReadonlySet<string> = new Set();

export class TermsSeen {
  constructor(private readonly store: DataStore) {}

  /** The ids seen so far; a missing or unreadable file is an empty history (never an error screen). */
  read(): ReadonlySet<string> {
    const read = this.store.read(TERMS_FILE, TERMS_MAX_BYTES);
    if (read.kind !== 'ok' || read.records.length !== 1) return NONE;
    let parsed: unknown;
    try {
      parsed = JSON.parse(read.records[0] ?? '') as unknown;
    } catch {
      return NONE;
    }
    if (!Array.isArray(parsed)) return NONE;
    return new Set(
      parsed.filter(
        (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH,
      ),
    );
  }

  /**
   * Adds `played` to the history and returns the ids it did not hold before. Idempotent, so it is safe to redo after
   * a kill. A failed write (low storage) still returns the answer for this summary; only this update is lost.
   */
  record(played: readonly string[]): ReadonlySet<string> {
    const seen = this.read();
    const fresh = new Set(played.filter((id) => !seen.has(id)));
    if (fresh.size === 0) return fresh;
    const next = [...new Set([...seen, ...fresh])].sort();
    try {
      this.store.replace(TERMS_FILE, [asciiJson(next)]);
    } catch {
      // Low storage: the history misses this match's terms; nothing else depends on it.
    }
    return fresh;
  }
}
