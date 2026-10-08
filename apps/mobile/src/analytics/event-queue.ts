/**
 * The consented on-device event queue (E-1.5 AC-17, slice S6a; catalogue "Retention"). Events reach it already
 * validated by the recorder (`recorder.ts`); the queue keeps them until the tester confirms "Sent" (slice S6c), for at
 * most 30 days, capped at 5,000 events with the oldest dropped first. Every loss is counted in
 * {@link DroppedCounts}, the `dropped` block of the `exportFormat: 1` file: S6a's measure is completeness, so nothing
 * is lost silently.
 *
 * Files in the backup-excluded data directory (`DATA_DIR`, threat model TM-03, R1-4), framed like the match log
 * (`persistence/records.ts`, TM-01):
 * - `analytics.queue`: append-only, one record `{ s, e }` per event: a sequence number and the wire-form event.
 * - `analytics.meta`: one record `{ v: 1, first, dropped }`, replaced atomically. `first` is the lowest sequence number
 *   still queued: dropping events (cap, expiry, "Sent") only moves `first`, so it is one small atomic write and never
 *   rewrites the queue. Records below `first` are removed from the file later, by a compaction that rewrites only
 *   records the meta already excludes, so a kill at any point leaves a consistent queue.
 *
 * Kill safety: an event is committed once its append returns. The cap is enforced after the append, so a kill
 * between the append and the meta write leaves one event too many, which the next load drops and counts. A torn last
 * record is the event that was being written (never committed); the file is rewritten before the next append so the
 * torn bytes never end up in the middle. A full disk keeps the event in memory and rewrites the whole file at the
 * next write.
 *
 * Start-up cost: loading reads each record's sequence number and time only (no schema check), and runs after the
 * first render (the recorder defers it). The full schema check runs when the events are read for an export.
 */
import type { DataStore } from '../persistence/data-store';
import { type ReadRecords } from '../persistence/data-store';
import { asciiJson } from '../persistence/match-journal';
import { guardEvent } from './event-guard';
import type { AnalyticsEvent } from './events';

export const QUEUE_FILE = 'analytics.queue';
export const QUEUE_META_FILE = 'analytics.meta';
export const QUEUE_FILES = [QUEUE_FILE, QUEUE_META_FILE] as const;

/** AC-17: at most 5,000 events, oldest dropped first. */
export const QUEUE_CAP = 5000;
/** AC-17: events older than 30 days (device clock) are purged at app start. */
export const QUEUE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Records already dropped that may stay in the file before it is compacted. */
export const QUEUE_COMPACT_AFTER = 500;
/**
 * Read cap of the queue file (TM-02 style: the size is checked before reading). An event is well under 2 KB in its
 * wire form (every property is an enum, a number or an id), so a full queue plus the compaction slack fits.
 */
export const QUEUE_MAX_BYTES = (QUEUE_CAP + QUEUE_COMPACT_AFTER + 1) * 2048;
const META_MAX_BYTES = 1024;

/** The `dropped` block of the export file, counted since the last confirmed "Sent". */
export interface DroppedCounts {
  /** Oldest events dropped at the 5,000 cap. */
  readonly queueCap: number;
  /** Events purged after 30 days. */
  readonly expired: number;
  /** Events rejected by the schemas (at record time or on read), and unreadable queue data (counted once). */
  readonly invalid: number;
}

const NO_DROPS: DroppedCounts = { queueCap: 0, expired: 0, invalid: 0 };

interface Entry {
  readonly seq: number;
  readonly occurredMs: number;
  /** The record payload, `{ s, e }`. */
  readonly text: string;
  readonly event: unknown;
}

interface Meta {
  readonly first: number;
  readonly dropped: DroppedCounts;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function parseMeta(read: ReadRecords): Meta {
  const fallback: Meta = { first: 0, dropped: NO_DROPS };
  if (read.kind !== 'ok' || read.records.length !== 1) return fallback;
  const meta = parseJson(read.records[0] ?? '');
  if (!isObject(meta) || meta['v'] !== 1 || !isCount(meta['first'])) return fallback;
  const dropped = meta['dropped'];
  if (
    !isObject(dropped) ||
    !isCount(dropped['queueCap']) ||
    !isCount(dropped['expired']) ||
    !isCount(dropped['invalid'])
  ) {
    return fallback;
  }
  return {
    first: meta['first'],
    dropped: {
      queueCap: dropped['queueCap'],
      expired: dropped['expired'],
      invalid: dropped['invalid'],
    },
  };
}

/** A record's sequence number and time; null when it is not a queue record. */
function parseEntry(text: string): Entry | null {
  const record = parseJson(text);
  if (!isObject(record) || !isCount(record['s']) || !isObject(record['e'])) return null;
  const occurred = record['e']['occurred_at'];
  const occurredMs = typeof occurred === 'string' ? Date.parse(occurred) : Number.NaN;
  if (!Number.isFinite(occurredMs)) return null;
  return { seq: record['s'], occurredMs, text, event: record['e'] };
}

export class EventQueue {
  private loaded = false;
  /** Every live entry (seq ≥ `first`), oldest first. */
  private entries: Entry[] = [];
  /** Records in the file below `first` (dropped, not yet compacted away). */
  private stale = 0;
  private first = 0;
  private nextSeq = 0;
  private counts: DroppedCounts = NO_DROPS;
  /** The file does not match `entries` (torn tail, failed write): the next write rewrites it. */
  private dirty = false;

  /**
   * @param now Wall clock in ms (device clock, the time base of `occurred_at`), for the 30-day expiry.
   * @param cap The event cap (tests shrink it).
   */
  constructor(
    private readonly store: DataStore,
    private readonly now: () => number,
    private readonly cap: number = QUEUE_CAP,
  ) {}

  /** Live events in the queue. */
  size(): number {
    this.load();
    return this.entries.length;
  }

  dropped(): DroppedCounts {
    this.load();
    return this.counts;
  }

  /**
   * The queued events, oldest first, each checked again (`event-guard.ts`, the on-device mirror of the D1 schemas;
   * catalogue "Validation": queue read). An
   * entry that fails is removed and counted as invalid, never exported.
   */
  events(): readonly AnalyticsEvent[] {
    this.load();
    const valid: AnalyticsEvent[] = [];
    const kept: Entry[] = [];
    for (const entry of this.entries) {
      const parsed = guardEvent(entry.event);
      if (parsed.ok) {
        valid.push(parsed.event);
        kept.push(entry);
      }
    }
    const removed = this.entries.length - kept.length;
    if (removed > 0) {
      this.entries = kept;
      this.counts = { ...this.counts, invalid: this.counts.invalid + removed };
      this.dirty = true;
      this.writeMeta();
      this.rewrite();
    }
    return valid;
  }

  /**
   * Appends an event the recorder has validated. True once it is on disk; false when the write failed (full disk):
   * the event stays queued in memory and the next write rewrites the file.
   */
  append(event: AnalyticsEvent): boolean {
    this.load();
    const seq = this.nextSeq;
    this.nextSeq += 1;
    const text = asciiJson({ s: seq, e: event });
    this.entries.push({ seq, occurredMs: Date.parse(event.occurred_at), text, event });
    let ok: boolean;
    if (this.dirty) {
      ok = this.rewrite();
    } else {
      ok = this.attempt(() => {
        this.store.append(QUEUE_FILE, [text]);
      });
      if (!ok) this.dirty = true;
    }
    this.enforceCap();
    return ok;
  }

  /** An event the schemas rejected at record time: counted, never stored. */
  countInvalid(): void {
    this.load();
    this.counts = { ...this.counts, invalid: this.counts.invalid + 1 };
    this.writeMeta();
  }

  /**
   * The tester confirmed "Yes, I sent it" (design §5.9, slice S6c): the `count` oldest events (those in the file) are
   * cleared, and the drop counts restart, since they count losses since the last confirmed export.
   */
  clearSent(count: number): void {
    this.load();
    const n = Math.max(0, Math.min(count, this.entries.length));
    this.drop(n, NO_DROPS);
  }

  /** Consent withdrawn (AC-17): every queue file is deleted. Sequence numbers restart from zero. */
  purge(): void {
    for (const name of [QUEUE_FILE, QUEUE_META_FILE]) {
      this.attempt(() => {
        this.store.remove(name);
      });
    }
    this.entries = [];
    this.stale = 0;
    this.first = 0;
    this.nextSeq = 0;
    this.counts = NO_DROPS;
    this.dirty = false;
    this.loaded = true;
  }

  /** Reads the files once (lazily); expires old events and enforces the cap. */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const meta = parseMeta(this.read(QUEUE_META_FILE, META_MAX_BYTES));
    this.first = meta.first;
    this.counts = meta.dropped;
    this.nextSeq = meta.first;
    const read = this.read(QUEUE_FILE, QUEUE_MAX_BYTES);
    let records: readonly string[] = [];
    let lost = 0;
    if (read.kind === 'ok') {
      records = read.records;
      this.dirty = read.droppedTail;
    } else if (read.kind === 'corrupt') {
      // Keep what is readable; what follows the bad record is unknown, counted once (a lower bound).
      records = read.prefix;
      lost = 1;
      this.dirty = true;
    } else if (read.kind === 'too_large') {
      lost = 1;
      this.dirty = true;
    }
    for (const text of records) {
      const entry = parseEntry(text);
      if (entry === null) {
        lost += 1;
        this.dirty = true;
        continue;
      }
      this.nextSeq = Math.max(this.nextSeq, entry.seq + 1);
      if (entry.seq < this.first) this.stale += 1;
      else this.entries.push(entry);
    }
    if (lost > 0) this.counts = { ...this.counts, invalid: this.counts.invalid + lost };
    // AC-17 30-day expiry, from the oldest end (the queue is in append order).
    const oldest = this.now() - QUEUE_MAX_AGE_MS;
    let expired = 0;
    while (expired < this.entries.length && (this.entries[expired]?.occurredMs ?? 0) < oldest) {
      expired += 1;
    }
    const changed = lost > 0 || expired > 0;
    if (expired > 0) {
      this.drop(expired, { ...this.counts, expired: this.counts.expired + expired });
    } else if (changed) {
      this.writeMeta();
    }
    if (!this.enforceCap() && this.dirty) this.rewrite();
  }

  private read(name: string, maxBytes: number): ReadRecords {
    try {
      return this.store.read(name, maxBytes);
    } catch {
      return { kind: 'missing' };
    }
  }

  /** Drops the oldest live events beyond the cap, counted. True when it changed anything. */
  private enforceCap(): boolean {
    const excess = this.entries.length - this.cap;
    if (excess <= 0) return false;
    this.drop(excess, { ...this.counts, queueCap: this.counts.queueCap + excess });
    return true;
  }

  /** Drops the `n` oldest live events and stores `counts`: one meta write, then a compaction if due. */
  private drop(n: number, counts: DroppedCounts): void {
    const removed = this.entries.splice(0, n);
    this.stale += removed.length;
    this.first = this.entries[0]?.seq ?? this.nextSeq;
    this.counts = counts;
    // Compaction only once the meta excludes the records it removes; a dirty file is rewritten regardless.
    const metaWritten = this.writeMeta();
    if ((metaWritten && this.stale >= QUEUE_COMPACT_AFTER) || this.dirty) this.rewrite();
  }

  /** Meta first, then the queue file (see the module comment: only already-excluded records disappear). */
  private writeMeta(): boolean {
    return this.attempt(() => {
      this.store.replace(QUEUE_META_FILE, [
        asciiJson({ v: 1, first: this.first, dropped: this.counts }),
      ]);
    });
  }

  /** Rewrites the queue file with the live entries only (compaction, or recovery after a failed write). */
  private rewrite(): boolean {
    const ok = this.attempt(() => {
      this.store.replace(
        QUEUE_FILE,
        this.entries.map((e) => e.text),
      );
    });
    if (ok) {
      this.stale = 0;
      this.dirty = false;
    } else {
      this.dirty = true;
    }
    return ok;
  }

  private attempt(write: () => void): boolean {
    try {
      write();
      return true;
    } catch {
      return false;
    }
  }
}
