/**
 * The consented event queue (E-1.5 AC-17, slice S6a): append-only on disk, survives a process kill at every write
 * boundary, 5,000-event cap with the oldest dropped first and counted, 30-day expiry counted, "Sent" clears exactly
 * the oldest events, purge leaves nothing behind.
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { DataStore } from '../persistence/data-store';
import { MemoryFs, ProcessKilled } from '../persistence/memory-fs';
import { encodeRecord } from '../persistence/records';
import { parseAnalyticsEvent, type AnalyticsEvent } from './events';
import {
  EventQueue,
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

function open(fs: MemoryFs, now = T0, cap = QUEUE_CAP): EventQueue {
  const store = new DataStore(fs);
  store.recover((name) => (QUEUE_FILES as readonly string[]).includes(name));
  return new EventQueue(store, () => now, cap);
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

  it('ignores a meta file it cannot read', () => {
    const fs = new MemoryFs();
    open(fs).append(eventAt(1));
    new DataStore(fs).replace(QUEUE_FILES[1], ['{"v":9}']);
    expect(ids(open(fs.reboot()).events())).toEqual([1]);
  });

  it('loses no committed event when the process is killed at any write boundary', () => {
    // Run a scripted sequence once to count its boundaries, then kill at each one.
    const script = (queue: EventQueue, committed: number[]): void => {
      for (let n = 1; n <= 7; n += 1) {
        if (queue.append(eventAt(n))) committed.push(n);
        if (n === 4) queue.countInvalid();
        if (n === 5) queue.clearSent(2);
      }
    };
    const dry = new MemoryFs();
    script(open(dry, T0, 4), []);
    const total = dry.boundaries;
    expect(total).toBeGreaterThan(10);
    for (const tornBytes of [0, 5]) {
      for (let killAt = 0; killAt < total; killAt += 1) {
        const fs = new MemoryFs({ killAt, tornBytes });
        const committed: number[] = [];
        try {
          script(open(fs, T0, 4), committed);
        } catch (error) {
          // The queue reports a failed write as `false`; anything that escapes must be the simulated kill.
          expect(error).toBeInstanceOf(ProcessKilled);
        }
        expect(fs.killed).toBe(true);
        const disk = fs.reboot();
        const after = open(disk, T0, 4);
        const kept = ids(after.events());
        // Every event that is kept was appended, in order, and the queue never exceeds its cap.
        expect(kept).toEqual([...kept].sort((a, b) => a - b));
        expect(kept.length).toBeLessThanOrEqual(4);
        // The newest committed event is never lost (only the cap or a confirmed "Sent" removes events).
        const last = committed.at(-1);
        if (last !== undefined) expect(kept).toContain(last);
        // The file stays appendable.
        after.append(eventAt(99));
        expect(ids(open(disk.reboot(), T0, 4).events()).at(-1)).toBe(99);
      }
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
