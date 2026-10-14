/**
 * The consented event queue (E-1.5 AC-17, slice S6a): append-only on disk, survives a process kill at every write
 * boundary, 5,000-event cap with the oldest dropped first and counted, 30-day expiry counted, "Sent" clears exactly
 * the oldest events, purge leaves nothing behind.
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { DataStore, TMP_SUFFIX } from '../persistence/data-store';
import { MemoryFs, ProcessKilled } from '../persistence/memory-fs';
import { encodeRecord } from '../persistence/records';
import { parseAnalyticsEvent, type AnalyticsEvent } from './events';
import {
  EventQueue,
  type DroppedCounts,
  QUEUE_CAP,
  QUEUE_COMPACT_AFTER,
  QUEUE_FILES,
  QUEUE_MAX_AGE_MS,
} from './event-queue';
import { sampleEvent } from './test-support';

const T0 = Date.parse('2026-10-07T09:30:00.000Z');
const DAY = 24 * 3600 * 1000;

/** A valid `app_backgrounded` numbered `n`, `ageMs` before T0. */
function eventAt(n: number, occurredMs = T0): AnalyticsEvent {
  const raw = {
    ...sampleEvent('app_backgrounded', n),
    occurred_at: new Date(occurredMs).toISOString(),
  };
  const parsed = parseAnalyticsEvent(raw);
  if (!parsed.ok) throw new Error(parsed.issues.join());
  return parsed.event;
}

const ids = (events: readonly AnalyticsEvent[]): number[] =>
  events.map((e) => Number.parseInt(e.event_id.slice(-12), 16));

function open(fs: MemoryFs, now = T0, cap = QUEUE_CAP, compactAfter?: number): EventQueue {
  const store = new DataStore(fs);
  store.recover((name) => (QUEUE_FILES as readonly string[]).includes(name));
  return new EventQueue(store, () => now, cap, compactAfter);
}

const NONE: DroppedCounts = { queueCap: 0, expired: 0, invalid: 0 };

/** What the queue must hold: an executable model of AC-17's rules (no expiry in these scripts). */
type Op =
  | { readonly kind: 'append'; readonly n: number }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'clear'; readonly k: number };
interface Model {
  readonly kept: readonly number[];
  readonly counts: DroppedCounts;
}

function applyModel(model: Model, op: Op, cap: number): Model {
  switch (op.kind) {
    case 'append': {
      const kept = [...model.kept, op.n];
      const excess = Math.max(0, kept.length - cap);
      return {
        kept: kept.slice(excess),
        counts: { ...model.counts, queueCap: model.counts.queueCap + excess },
      };
    }
    case 'invalid':
      return { ...model, counts: { ...model.counts, invalid: model.counts.invalid + 1 } };
    case 'clear':
      return { kept: model.kept.slice(op.k), counts: NONE };
  }
}

function runOp(queue: EventQueue, op: Op): void {
  if (op.kind === 'append') queue.append(eventAt(op.n));
  else if (op.kind === 'invalid') queue.countInvalid();
  else queue.clearSent(op.k);
}

describe('EventQueue', () => {
  it('keeps appended events, oldest first, across a restart', () => {
    const fs = new MemoryFs();
    const queue = open(fs);
    expect(queue.size()).toBe(0);
    for (let n = 1; n <= 3; n += 1) expect(queue.append(eventAt(n))).toBe(true);
    expect(queue.size()).toBe(3);
    const next = open(fs.reboot());
    expect(next.size()).toBe(3);
    expect(ids(next.events())).toEqual([1, 2, 3]);
    expect(next.dropped()).toEqual({ queueCap: 0, expired: 0, invalid: 0 });
  });

  it('touches no file until the first write (a fresh install reads nothing)', () => {
    const fs = new MemoryFs();
    const queue = open(fs);
    expect(queue.size()).toBe(0);
    expect(fs.writes).toEqual([]);
  });

  it('drops the oldest events at the cap and counts them', () => {
    const fs = new MemoryFs();
    const queue = open(fs, T0, 5);
    for (let n = 1; n <= 8; n += 1) queue.append(eventAt(n));
    expect(ids(queue.events())).toEqual([4, 5, 6, 7, 8]);
    expect(queue.dropped().queueCap).toBe(3);
    const next = open(fs.reboot(), T0, 5);
    expect(ids(next.events())).toEqual([4, 5, 6, 7, 8]);
    expect(next.dropped().queueCap).toBe(3);
  });

  it('caps at 5,000 events by default (AC-17)', () => {
    expect(QUEUE_CAP).toBe(5000);
    expect(QUEUE_MAX_AGE_MS).toBe(30 * DAY);
  });

  it('compacts the file once enough dropped events precede the live ones', () => {
    const fs = new MemoryFs();
    const queue = open(fs, T0, 2);
    for (let n = 1; n <= QUEUE_COMPACT_AFTER + 3; n += 1) queue.append(eventAt(n));
    const store = new DataStore(fs);
    const read = store.read(QUEUE_FILES[0], 10_000_000);
    expect(read.kind === 'ok' ? read.records.length : -1).toBeLessThan(QUEUE_COMPACT_AFTER);
    expect(ids(open(fs.reboot(), T0, 2).events())).toEqual([
      QUEUE_COMPACT_AFTER + 2,
      QUEUE_COMPACT_AFTER + 3,
    ]);
  });

  it('expires events older than 30 days at load and counts them', () => {
    const fs = new MemoryFs();
    const queue = open(fs, T0);
    queue.append(eventAt(1, T0 - 31 * DAY));
    queue.append(eventAt(2, T0 - 30 * DAY - 1));
    queue.append(eventAt(3, T0 - 29 * DAY));
    queue.append(eventAt(4, T0));
    const disk = fs.reboot();
    const later = open(disk, T0);
    expect(ids(later.events())).toEqual([3, 4]);
    expect(later.dropped()).toEqual({ queueCap: 0, expired: 2, invalid: 0 });
    // Persisted: the next start still reports them, and an older clock expires nothing more.
    expect(open(disk.reboot(), T0 - 40 * DAY).dropped().expired).toBe(2);
  });

  it('counts invalid events and persists the count', () => {
    const fs = new MemoryFs();
    const queue = open(fs);
    queue.countInvalid();
    queue.countInvalid();
    expect(queue.dropped().invalid).toBe(2);
    expect(open(fs.reboot()).dropped().invalid).toBe(2);
  });

  it('clears exactly the oldest sent events and resets the drop counts (design §5.9)', () => {
    const fs = new MemoryFs();
    const queue = open(fs, T0, 3);
    for (let n = 1; n <= 5; n += 1) queue.append(eventAt(n));
    queue.countInvalid();
    queue.clearSent(2);
    expect(ids(queue.events())).toEqual([5]);
    expect(queue.dropped()).toEqual({ queueCap: 0, expired: 0, invalid: 0 });
    queue.append(eventAt(6));
    const next = open(fs.reboot(), T0, 3);
    expect(ids(next.events())).toEqual([5, 6]);
    expect(next.dropped()).toEqual({ queueCap: 0, expired: 0, invalid: 0 });
    next.clearSent(99);
    expect(next.size()).toBe(0);
  });

  it('purges every queue file (consent withdrawn, AC-17)', () => {
    const fs = new MemoryFs();
    const queue = open(fs, T0, 2);
    for (let n = 1; n <= 3; n += 1) queue.append(eventAt(n));
    queue.countInvalid();
    queue.purge();
    expect(queue.size()).toBe(0);
    expect(queue.dropped()).toEqual({ queueCap: 0, expired: 0, invalid: 0 });
    expect([...fs.files.keys()]).toEqual([]);
    expect(open(fs.reboot()).size()).toBe(0);
  });

  it('keeps sequence numbers increasing after a purge or a full clear', () => {
    const fs = new MemoryFs();
    const queue = open(fs, T0, 2);
    queue.append(eventAt(1));
    queue.clearSent(1);
    queue.append(eventAt(2));
    expect(ids(open(fs.reboot(), T0, 2).events())).toEqual([2]);
  });

  it('survives a full disk: the event stays queued and the next write rewrites the file', () => {
    const fs = new MemoryFs();
    const queue = open(fs);
    queue.append(eventAt(1));
    fs.fullAfter = 3;
    expect(queue.append(eventAt(2))).toBe(false);
    expect(queue.size()).toBe(2);
    fs.fullAfter = null;
    expect(queue.append(eventAt(3))).toBe(true);
    expect(ids(open(fs.reboot()).events())).toEqual([1, 2, 3]);
  });

  it('rewrites a torn tail before appending after it', () => {
    const fs = new MemoryFs();
    open(fs).append(eventAt(1));
    const torn = encodeRecord('{"s":1,"e":{"partial":');
    fs.append(QUEUE_FILES[0], torn.subarray(0, 12));
    const disk = fs.reboot();
    const next = open(disk);
    expect(next.size()).toBe(1);
    next.append(eventAt(2));
    expect(ids(open(disk.reboot()).events())).toEqual([1, 2]);
  });

  it('keeps the readable prefix of a corrupt file and counts the loss as one invalid drop', () => {
    const fs = new MemoryFs();
    const queue = open(fs);
    for (let n = 1; n <= 3; n += 1) queue.append(eventAt(n));
    const bytes = fs.files.get(QUEUE_FILES[0]) ?? new Uint8Array(0);
    const second = bytes.length - 2 * (bytes.length / 3);
    bytes[second + 20] = 0x01; // a control byte inside record 2: not a torn tail, corruption
    fs.files.set(QUEUE_FILES[0], bytes);
    const disk = fs.reboot();
    const next = open(disk);
    expect(ids(next.events())).toEqual([1]);
    expect(next.dropped().invalid).toBe(1);
    next.append(eventAt(4));
    const reopened = open(disk.reboot());
    expect(ids(reopened.events())).toEqual([1, 4]);
    expect(reopened.dropped().invalid).toBe(1);
  });

  it('treats records that do not parse as invalid drops, never as events', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    const stamped = { event: 'nope', occurred_at: '2026-10-07T09:30:00.000Z' };
    store.append(QUEUE_FILES[0], [
      'not json',
      '{"s":"x"}',
      JSON.stringify({ s: 4, e: { event: 'nope' } }),
      JSON.stringify({ s: 5, e: stamped }),
    ]);
    const queue = open(fs);
    // Load reads only the sequence number and the time (cheap at start); a full schema check runs on read.
    expect(queue.size()).toBe(1);
    expect(queue.dropped().invalid).toBe(3);
    expect(queue.events()).toEqual([]);
    expect(queue.size()).toBe(0);
    expect(queue.dropped().invalid).toBe(4);
    expect(open(fs.reboot()).dropped().invalid).toBe(4);
  });

  it('counts a meta file that exists but cannot be read as one invalid drop', () => {
    const fs = new MemoryFs();
    open(fs).append(eventAt(1));
    new DataStore(fs).replace(QUEUE_FILES[1], ['{"v":9}']);
    const disk = fs.reboot();
    const queue = open(disk);
    expect(ids(queue.events())).toEqual([1]);
    expect(queue.dropped().invalid).toBe(1);
    expect(open(disk.reboot()).dropped().invalid).toBe(1);
  });

  it('never brings sent events back after a clear that hit a full disk (review M1)', () => {
    const fs = new MemoryFs();
    const queue = open(fs);
    for (let n = 1; n <= 3; n += 1) queue.append(eventAt(n));
    fs.fullAfter = 0;
    expect(queue.clearSent(3)).toBe(false);
    fs.fullAfter = null;
    queue.append(eventAt(4));
    expect(ids(open(fs.reboot()).events())).toEqual([4]);
    expect(open(new MemoryFs()).clearSent(0)).toBe(true);
  });

  it('keeps cap drops and their count when the meta write hit a full disk', () => {
    const fs = new MemoryFs();
    const queue = open(fs, T0, 2);
    queue.append(eventAt(1));
    queue.append(eventAt(2));
    fs.fullAfter = 0;
    expect(queue.append(eventAt(3))).toBe(false);
    fs.fullAfter = null;
    queue.append(eventAt(4));
    const reopened = open(fs.reboot(), T0, 2);
    expect(ids(reopened.events())).toEqual([3, 4]);
    expect(reopened.dropped().queueCap).toBe(2);
  });

  it('retries a failed meta write before counting the next invalid event', () => {
    const fs = new MemoryFs();
    const queue = open(fs, T0, 1);
    queue.append(eventAt(1));
    fs.fullAfter = 0;
    queue.append(eventAt(2));
    fs.fullAfter = null;
    queue.countInvalid();
    expect(open(fs.reboot(), T0, 1).dropped()).toEqual({ queueCap: 1, expired: 0, invalid: 1 });
  });

  it('backs off full-file rewrites on a full disk, then writes every queued event', () => {
    const fs = new MemoryFs();
    const queue = open(fs);
    queue.append(eventAt(1));
    fs.fullAfter = 0;
    const before = fs.writes.length;
    for (let n = 2; n <= 41; n += 1) queue.append(eventAt(n));
    // One failed append, then rewrites after 1, 2, 4, 8, 16 waits: far fewer than one per event.
    expect(fs.writes.length - before).toBeLessThan(10);
    fs.fullAfter = null;
    for (let n = 42; n <= 120; n += 1) queue.append(eventAt(n));
    expect(ids(open(fs.reboot()).events())).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
  });

  it('purges half-written temp files too', () => {
    const fs = new MemoryFs();
    open(fs).append(eventAt(1));
    fs.files.set(QUEUE_FILES[0] + TMP_SUFFIX, Uint8Array.of(1));
    fs.files.set(QUEUE_FILES[1] + TMP_SUFFIX, Uint8Array.of(1));
    expect(open(fs).purge()).toBe(true);
    expect([...fs.files.keys()]).toEqual([]);
  });

  it('reports a purge that could not delete a file', () => {
    const fs = new MemoryFs();
    const queue = open(fs);
    queue.append(eventAt(1));
    const stuck = Object.assign(Object.create(fs) as MemoryFs, {
      remove: (): void => {
        throw new Error('EACCES');
      },
    });
    expect(new EventQueue(new DataStore(stuck), () => T0).purge()).toBe(false);
  });

  it('matches the model exactly when the process is killed at any write boundary', () => {
    // Cap 4 and compaction after 2 dropped records, so cap drops, clears and compactions all happen and are killed.
    const cap = 4;
    const script: Op[] = [
      { kind: 'append', n: 1 },
      { kind: 'append', n: 2 },
      { kind: 'append', n: 3 },
      { kind: 'invalid' },
      { kind: 'append', n: 4 },
      { kind: 'append', n: 5 },
      { kind: 'clear', k: 2 },
      { kind: 'append', n: 6 },
      { kind: 'append', n: 7 },
      { kind: 'append', n: 8 },
      { kind: 'append', n: 9 },
      { kind: 'invalid' },
      { kind: 'clear', k: 1 },
      { kind: 'append', n: 10 },
      { kind: 'append', n: 11 },
    ];
    const dry = new MemoryFs();
    const dryQueue = open(dry, T0, cap, 2);
    for (const op of script) runOp(dryQueue, op);
    const total = dry.boundaries;
    expect(total).toBeGreaterThan(40);
    for (const tornBytes of [0, 5]) {
      for (let killAt = 0; killAt < total; killAt += 1) {
        const fs = new MemoryFs({ killAt, tornBytes });
        const queue = open(fs, T0, cap, 2);
        let model: Model = { kept: [], counts: NONE };
        let inFlight: Op | null = null;
        for (const op of script) {
          try {
            runOp(queue, op);
          } catch (error) {
            expect(error).toBeInstanceOf(ProcessKilled);
          }
          if (fs.killed) {
            inFlight = op;
            break;
          }
          model = applyModel(model, op, cap);
        }
        expect(inFlight).not.toBeNull();
        const disk = fs.reboot();
        const after = open(disk, T0, cap, 2);
        const actual: Model = { kept: ids(after.events()), counts: after.dropped() };
        // Exactly the state before the interrupted operation, or after it: committed events are all there, cleared
        // and capped events never come back, and the counts agree with the events.
        const candidates = [model, inFlight === null ? model : applyModel(model, inFlight, cap)];
        expect(candidates).toContainEqual(actual);
        after.append(eventAt(99));
        expect(ids(open(disk.reboot(), T0, cap, 2).events()).at(-1)).toBe(99);
      }
    }
  });

  it('reaches the same queue when the start-up recovery itself is killed at any boundary', () => {
    // A disk that needs every load-time repair: expiry, cap, compaction and a torn tail.
    const base = new MemoryFs();
    const writer = open(base, T0, 100, 2);
    writer.append(eventAt(1, T0 - 40 * DAY));
    writer.append(eventAt(2, T0 - 31 * DAY));
    for (let n = 3; n <= 8; n += 1) writer.append(eventAt(n));
    base.append(QUEUE_FILES[0], encodeRecord('{"s":9,"e":{"partial":').subarray(0, 14));
    const settle = (fs: MemoryFs): Model => {
      const queue = open(fs, T0, 3, 2);
      return { kept: ids(queue.events()), counts: queue.dropped() };
    };
    const reference = base.reboot();
    open(reference, T0, 3, 2).size();
    const expected = settle(reference.reboot());
    expect(expected).toEqual({ kept: [6, 7, 8], counts: { queueCap: 3, expired: 2, invalid: 0 } });
    const dry = base.reboot();
    open(dry, T0, 3, 2).size();
    expect(dry.boundaries).toBeGreaterThan(5);
    for (let killAt = 0; killAt < dry.boundaries; killAt += 1) {
      const fs = base.reboot({ killAt });
      try {
        open(fs, T0, 3, 2).size();
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessKilled);
      }
      expect(settle(fs.reboot())).toEqual(expected);
    }
  });

  it('holds at most the cap, oldest first, for any sequence of appends and clears (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.array(fc.oneof(fc.constant<'append'>('append'), fc.integer({ min: 0, max: 4 })), {
          maxLength: 40,
        }),
        (cap, ops) => {
          const fs = new MemoryFs();
          const queue = open(fs, T0, cap);
          const model: number[] = [];
          let n = 0;
          let capDrops = 0;
          for (const op of ops) {
            if (op === 'append') {
              n += 1;
              queue.append(eventAt(n));
              model.push(n);
              if (model.length > cap) {
                model.shift();
                capDrops += 1;
              }
            } else {
              queue.clearSent(op);
              model.splice(0, op);
              capDrops = 0;
            }
          }
          expect(ids(queue.events())).toEqual(model);
          expect(queue.dropped().queueCap).toBe(capDrops);
          const reopened = open(fs.reboot(), T0, cap);
          expect(ids(reopened.events())).toEqual(model);
          expect(reopened.dropped().queueCap).toBe(capDrops);
        },
      ),
    );
  });
});
