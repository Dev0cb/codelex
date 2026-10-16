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
 *   rewrites the queue. Records below `first` are removed from the file later, by a compaction that runs only once the
 *   meta excluding them is on disk, so a kill at any point leaves a consistent queue.
 *
 * Kill safety: an event is committed once its append returns. The cap is enforced after the append, so a kill
 * between the append and the meta write leaves one event too many, which the next load drops and counts. A torn last
 * record is the event that was being written (never committed); the file is rewritten before the next append so the
 * torn bytes never end up in the middle.
 *
 * Full disk: a failed append keeps the event in memory and the next write rewrites the whole file (with a back-off,
 * so a full disk does not cost a full rewrite per event). A failed meta write is remembered (`metaDirty`) and retried
 * before every later write; while the meta on disk is stale, events are never appended after records it still counts
 * as live (the file is rewritten instead), so dropped or sent events can never come back after a restart.
 *
 * Start-up cost: loading reads each record's sequence number and time with two anchored regexes (no JSON parse, no
 * schema check) and keeps only the text; the recorder defers it until the app is idle. The JSON parse and the full
 * check (`event-guard.ts`) run when the events are read for an export. Node: a full queue (5,000 events, 3.7 MB)
 * loads in ≈ 70 ms; the device figure is an H1 measurement.
 */
import { TMP_SUFFIX, type DataStore, type ReadRecords } from '../persistence/data-store';
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
/** Longest wait, in appends, between two full-file rewrite attempts on a full disk. */
const MAX_REWRITE_BACKOFF = 64;

/** The `dropped` block of the export file, counted since the last confirmed "Sent". */
export interface DroppedCounts {
  /** Oldest events dropped at the 5,000 cap. */
  readonly queueCap: number;
  /** Events purged after 30 days. */
  readonly expired: number;
  /**
   * Events rejected by the schemas (at record time or on read), and unreadable queue data: a corrupt or oversized
   * queue file or an unreadable meta file counts once each (a lower bound).
   */
  readonly invalid: number;
}

const NO_DROPS: DroppedCounts = { queueCap: 0, expired: 0, invalid: 0 };

/** The events of a shared file, as {@link EventQueue.exportable} numbered them (slice S6c). */
export interface SentBatch {
  /** Sequence number of the oldest event in the file. */
  readonly firstSeq: number;
  /** Sequence number of the newest event in the file. */
  readonly lastSeq: number;
  /** Events in the file. */
  readonly events: number;
}

interface Entry {
  readonly seq: number;
  readonly occurredMs: number;
  /** The record payload, `{"s":…,"e":{…}}`; parsed only when the events are read. */
  readonly text: string;
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

/** The stored meta; null when the file exists but cannot be read. */
function parseMeta(read: ReadRecords): Meta | null {
  if (read.kind !== 'ok' || read.records.length !== 1) return null;
  const meta = parseJson(read.records[0] ?? '');
  if (!isObject(meta) || meta['v'] !== 1 || !isCount(meta['first'])) return null;
  const dropped = meta['dropped'];
  if (
    !isObject(dropped) ||
    !isCount(dropped['queueCap']) ||
    !isCount(dropped['expired']) ||
    !isCount(dropped['invalid'])
  ) {
    return null;
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

/** Records are written by `asciiJson({ s, e })`: the sequence number leads, the envelope time comes first in `e`. */
const RECORD_HEAD = /^\{"s":(0|[1-9]\d{0,15}),"e":\{/;
const OCCURRED_AT = /"occurred_at":"([0-9T:.Z-]{1,40})"/;

/** A record's sequence number and time; null when it is not a queue record. */
function parseEntry(text: string): Entry | null {
  const head = RECORD_HEAD.exec(text);
  const seq = Number(head?.[1]);
  if (!Number.isSafeInteger(seq)) return null;
  const occurredMs = Date.parse(OCCURRED_AT.exec(text)?.[1] ?? '');
  if (!Number.isFinite(occurredMs)) return null;
  return { seq, occurredMs, text };
}

/** The export screen's summary (design §5.9). Times are `occurred_at` (device clock), ms since epoch. */
export interface QueueSummary {
  readonly events: number;
  readonly matches: number;
  readonly oldestMs: number | null;
  readonly newestMs: number | null;
}

const MATCH_FINISHED = '"event":"bot_match_finished"';

/** A record's event, parsed and checked (`event-guard.ts`); null when it fails. */
function guardEntry(entry: Entry): AnalyticsEvent | null {
  const record = parseJson(entry.text);
  const parsed = guardEvent(isObject(record) ? record['e'] : undefined);
  return parsed.ok ? parsed.event : null;
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
  /** The meta on disk is older than `first`/`counts` (a failed write): retried before every later write. */
  private metaDirty = false;
  /** Appends left before the next rewrite attempt after a failed one (full disk). */
  private rewriteWait = 0;
  private rewriteBackoff = 0;

  /**
   * @param now Wall clock in ms (device clock, the time base of `occurred_at`), for the 30-day expiry.
   * @param cap The event cap (tests shrink it).
   * @param compactAfter Dropped records kept in the file before a compaction (tests shrink it).
   */
  constructor(
    private readonly store: DataStore,
    private readonly now: () => number,
    private readonly cap: number = QUEUE_CAP,
    private readonly compactAfter: number = QUEUE_COMPACT_AFTER,
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
   * The queued events, oldest first, each parsed and checked again (`event-guard.ts`, the on-device mirror of the D1
   * schemas; catalogue "Validation": queue read). An entry that fails is removed and counted as invalid, never
   * exported. Known double count: a kill between the meta write and the file rewrite below leaves the bad records in
   * the file with the meta already counting them, so the next read counts them once more (rare, over-reports).
   */
  events(): readonly AnalyticsEvent[] {
    return this.exportable().events;
  }

  /**
   * {@link events} with each event's sequence number (same index): the export screen keeps the last one of the file
   * and clears through it ({@link clearThrough}), so events appended or dropped while the share sheet is open never
   * shift what "Sent" clears (slice S6c).
   */
  exportable(): { readonly events: readonly AnalyticsEvent[]; readonly seqs: readonly number[] } {
    this.load();
    const valid: AnalyticsEvent[] = [];
    const kept: Entry[] = [];
    for (const entry of this.entries) {
      const parsed = guardEntry(entry);
      if (parsed !== null) {
        valid.push(parsed);
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
    return { events: valid, seqs: kept.map((e) => e.seq) };
  }

  /**
   * What the export screen shows on open (design §5.9 "Many events": counts only, the file is built on tap): no JSON
   * parse, no schema check. `matches` counts finished matches by the event name in the record text (compact JSON
   * written by `asciiJson`; no property can hold that text, every string is an enum or an id).
   */
  summary(): QueueSummary {
    this.load();
    let matches = 0;
    for (const entry of this.entries) if (entry.text.includes(MATCH_FINISHED)) matches += 1;
    return {
      events: this.entries.length,
      matches,
      oldestMs: this.entries[0]?.occurredMs ?? null,
      newestMs: this.entries.at(-1)?.occurredMs ?? null,
    };
  }

  /** The oldest event that passes the guard ("See an example event"); null on an empty queue. Changes nothing. */
  sample(): AnalyticsEvent | null {
    this.load();
    for (const entry of this.entries) {
      const parsed = guardEntry(entry);
      if (parsed !== null) return parsed;
    }
    return null;
  }

  /**
   * Appends an event the recorder has validated. True once it is on disk; false when the write failed (full disk):
   * the event stays queued in memory and a later write rewrites the file.
   */
  append(event: AnalyticsEvent): boolean {
    this.load();
    const metaOk = this.flushMeta();
    const seq = this.nextSeq;
    this.nextSeq += 1;
    const text = asciiJson({ s: seq, e: event });
    this.entries.push({ seq, occurredMs: Date.parse(event.occurred_at), text });
    let ok: boolean;
    if (this.dirty || !metaOk) {
      // A stale meta must not see this record next to records it still counts as live: rewrite instead.
      this.dirty = true;
      ok = this.rewriteWithBackoff();
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
   * cleared, and the drop counts restart, since they count losses since the last confirmed export. True only once
   * that is on disk; on false (full disk) S6c tells the tester it could not clear them, and the change is retried
   * before the next write.
   */
  clearSent(count: number): boolean {
    this.load();
    const n = Math.max(0, Math.min(count, this.entries.length));
    return this.drop(n, NO_DROPS);
  }

  /**
   * "Yes, I sent it" for the file whose events were `sent` (slice S6c): every live event up to `sent.lastSeq` is
   * cleared, and the drop counts lose exactly what the file reported (`reported`, its `dropped` block), so a drop
   * counted while the share sheet was open is still reported in the next file. A drop of an event the file itself
   * held is not: the file delivered that event, so the batch entries already gone since the file was built
   * (`firstSeq ≤ seq ≤ lastSeq`, cap drops while the sheet was open) are taken off the new counts too. Only the cap
   * can drop a live event once the queue is loaded (the 30-day expiry runs at load, before any export); the
   * expired count is still checked second for safety. Same disk contract as {@link clearSent}: true once the meta is
   * on disk; on false, {@link flush} retries.
   */
  clearThrough(sent: SentBatch, reported: DroppedCounts): boolean {
    this.load();
    let n = 0;
    let present = 0;
    while (n < this.entries.length) {
      const seq = this.entries[n]?.seq ?? Infinity;
      if (seq > sent.lastSeq) break;
      if (seq >= sent.firstSeq) present += 1;
      n += 1;
    }
    const less = (a: number, b: number): number => Math.max(0, a - b);
    const gone = less(sent.events, present);
    const queueCap = less(this.counts.queueCap, reported.queueCap);
    const goneCap = Math.min(gone, queueCap);
    const expired = less(this.counts.expired, reported.expired);
    return this.drop(n, {
      queueCap: queueCap - goneCap,
      expired: less(expired, gone - goneCap),
      invalid: less(this.counts.invalid, reported.invalid),
    });
  }

  /**
   * "Try again" after a clear that could not be saved: writes the meta if an earlier write failed, then rewrites the
   * file if events are held in memory only. True when the disk holds exactly the queue.
   */
  flush(): boolean {
    this.load();
    const metaOk = this.flushMeta();
    if (this.dirty) this.rewrite();
    return metaOk && !this.dirty;
  }

  /**
   * Consent withdrawn (AC-17): every queue file, and any half-written temp file of one, is deleted. True when none
   * is left on disk. Memory is reset either way (nothing more is recorded); sequence numbers restart from zero.
   */
  purge(): boolean {
    const names = QUEUE_FILES.flatMap((name) => [name, name + TMP_SUFFIX]);
    for (const name of names) {
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
    this.metaDirty = false;
    this.loaded = true;
    try {
      return names.every((name) => !this.store.exists(name));
    } catch {
      return false;
    }
  }

  /** Reads the files once (lazily); expires old events and enforces the cap. */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const metaRead = this.read(QUEUE_META_FILE, META_MAX_BYTES);
    const meta = metaRead.kind === 'missing' ? null : parseMeta(metaRead);
    // A meta file that exists but cannot be read: its counts are lost, counted once.
    let lost = metaRead.kind !== 'missing' && meta === null ? 1 : 0;
    this.first = meta?.first ?? 0;
    this.counts = meta?.dropped ?? NO_DROPS;
    this.nextSeq = this.first;
    const read = this.read(QUEUE_FILE, QUEUE_MAX_BYTES);
    let records: readonly string[] = [];
    if (read.kind === 'ok') {
      records = read.records;
      this.dirty = read.droppedTail;
    } else if (read.kind === 'corrupt') {
      // Keep what is readable; what follows the bad record is unknown, counted once (a lower bound).
      records = read.prefix;
      lost += 1;
      this.dirty = true;
    } else if (read.kind === 'too_large') {
      lost += 1;
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
    if (expired > 0) {
      this.drop(expired, { ...this.counts, expired: this.counts.expired + expired });
    } else if (lost > 0) {
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

  /**
   * Drops the `n` oldest live events and stores `counts`: one meta write, then a compaction if due. True when the
   * meta is on disk.
   */
  private drop(n: number, counts: DroppedCounts): boolean {
    const removed = this.entries.splice(0, n);
    this.stale += removed.length;
    this.first = this.entries[0]?.seq ?? this.nextSeq;
    this.counts = counts;
    const metaWritten = this.writeMeta();
    // Compaction only once the meta excludes the records it removes; a dirty file is rewritten regardless (it then
    // holds only live records, so even a stale meta cannot bring dropped ones back).
    if ((metaWritten && this.stale >= this.compactAfter) || this.dirty) this.rewriteWithBackoff();
    return metaWritten;
  }

  /** Writes the meta if a previous write failed. True when the meta on disk is current. */
  private flushMeta(): boolean {
    return this.metaDirty ? this.writeMeta() : true;
  }

  private writeMeta(): boolean {
    const ok = this.attempt(() => {
      this.store.replace(QUEUE_META_FILE, [
        asciiJson({ v: 1, first: this.first, dropped: this.counts }),
      ]);
    });
    this.metaDirty = !ok;
    return ok;
  }

  /** A rewrite, unless a recent one failed (full disk): then it waits a growing number of appends. */
  private rewriteWithBackoff(): boolean {
    if (this.rewriteWait > 0) {
      this.rewriteWait -= 1;
      return false;
    }
    const ok = this.rewrite();
    this.rewriteBackoff = ok
      ? 0
      : Math.min(MAX_REWRITE_BACKOFF, Math.max(1, this.rewriteBackoff * 2));
    this.rewriteWait = this.rewriteBackoff;
    return ok;
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
