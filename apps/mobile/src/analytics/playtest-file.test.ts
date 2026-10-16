/**
 * The zod-free on-device builder (slice S6c) equals the D1 contract `export/playtest-data.ts`, which stays the
 * Node-side reference: same constants, same accept/reject decisions, same fit, same text, and every file it builds
 * decodes with `decodePlaytestExport` (the readout and TM-08 import path).
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  buildPlaytestExport,
  decodePlaytestExport,
  fitEventsToCap,
  PLAYTEST_DATA_FILE_NAME,
  PLAYTEST_DATA_KIND,
  PLAYTEST_EXPORT_MAX_BYTES,
  PLAYTEST_EXPORT_MAX_EVENTS,
  type PlaytestDataHeader,
} from '../export/playtest-data.ts';
import { EXPORT_FORMAT } from '../export/common.ts';
import { EVENT_NAMES, type AnalyticsEvent } from './events.ts';
import {
  buildPlaytestFile,
  fitPlaytestEvents,
  PLAYTEST_FILE_FORMAT,
  PLAYTEST_FILE_KIND,
  PLAYTEST_FILE_MAX_BYTES,
  PLAYTEST_FILE_MAX_EVENTS,
  PLAYTEST_FILE_NAME,
  type PlaytestFileHeader,
} from './playtest-file';
import { INSTALL_ID, sampleEvent } from './test-support.ts';
import { utf8Length } from './utf8';

const HEADER: PlaytestFileHeader = {
  exportFormat: 1,
  kind: 'codelex.playtest_data',
  app: { version: '0.1.0', build: '42', platform: 'android' },
  installId: INSTALL_ID,
  exportedAt: '2026-10-14T18:00:00.000Z',
  dropped: { queueCap: 3, expired: 1, invalid: 0 },
};

// Type-level equivalence with the D1 header, both ways.
const asD1: PlaytestDataHeader = HEADER;
const fromD1: PlaytestFileHeader = asD1;

const events = (n: number, offset = 0): AnalyticsEvent[] =>
  Array.from(
    { length: n },
    (_, i) =>
      sampleEvent(
        EVENT_NAMES[(i + offset) % EVENT_NAMES.length] ?? 'app_opened',
        i + 1,
      ) as AnalyticsEvent,
  );

/** Same decision and, when both accept, the same text and count. */
function expectSameAsD1(header: PlaytestFileHeader, queued: readonly AnalyticsEvent[]): void {
  const mine = buildPlaytestFile(header, queued);
  const reference = buildPlaytestExport(header, queued);
  expect(mine.ok).toBe(reference.ok);
  if (mine.ok && reference.ok) {
    expect(mine.value.text).toBe(reference.value.text);
    expect(mine.value.included).toBe(reference.value.included);
    expect(mine.value.remaining).toBe(queued.length - reference.value.included);
    expect(decodePlaytestExport(mine.value.text).ok).toBe(true);
  }
}

describe('on-device playtest file (S6c) ≡ D1 contract', () => {
  it('mirrors the D1 constants', () => {
    expect(fromD1).toBe(HEADER);
    expect(PLAYTEST_FILE_FORMAT).toBe(EXPORT_FORMAT);
    expect(PLAYTEST_FILE_KIND).toBe(PLAYTEST_DATA_KIND);
    expect(PLAYTEST_FILE_NAME).toBe(PLAYTEST_DATA_FILE_NAME);
    expect(PLAYTEST_FILE_MAX_BYTES).toBe(PLAYTEST_EXPORT_MAX_BYTES);
    expect(PLAYTEST_FILE_MAX_EVENTS).toBe(PLAYTEST_EXPORT_MAX_EVENTS);
  });

  it('builds the same text as D1 for every event type, and it decodes', () => {
    expectSameAsD1(HEADER, events(EVENT_NAMES.length * 3));
  });

  it('keeps D1 key order even when the header is given in another order', () => {
    const shuffled = {
      dropped: { invalid: 0, expired: 1, queueCap: 3 },
      installId: INSTALL_ID,
      app: { platform: 'android', build: '42', version: '0.1.0' },
      exportedAt: HEADER.exportedAt,
      kind: HEADER.kind,
      exportFormat: 1,
    } as const;
    expectSameAsD1(shuffled, events(5));
  });

  it('splits a full queue into files under 1 MB exactly as D1 does (multi-round share)', () => {
    let queued = events(PLAYTEST_FILE_MAX_EVENTS);
    let files = 0;
    while (queued.length > 0) {
      const built = buildPlaytestFile(HEADER, queued);
      if (!built.ok) throw new Error(built.error.code);
      expect(utf8Length(built.value.text)).toBeLessThanOrEqual(PLAYTEST_FILE_MAX_BYTES);
      expect(built.value.included).toBe(fitEventsToCap(HEADER, queued));
      expectSameAsD1(HEADER, queued);
      queued = queued.slice(built.value.included);
      expect(built.value.remaining).toBe(queued.length);
      files += 1;
    }
    expect(files).toBeGreaterThanOrEqual(2);
    expect(files).toBeLessThanOrEqual(4);
  });

  it('rejects what D1 rejects: empty, bad header fields, foreign user_id, duplicate ids, unknown keys', () => {
    const list = events(3);
    const first = list[0] as AnalyticsEvent;
    const bad: [PlaytestFileHeader, AnalyticsEvent[], string][] = [
      [HEADER, [], 'EMPTY'],
      [{ ...HEADER, installId: 'tester-moussa' }, list, 'INVALID'],
      [{ ...HEADER, exportedAt: '2026-10-14 18:00' }, list, 'INVALID'],
      [{ ...HEADER, app: { ...HEADER.app, build: 'b42' } }, list, 'INVALID'],
      [{ ...HEADER, app: { ...HEADER.app, version: 'v1' } }, list, 'INVALID'],
      [{ ...HEADER, app: { ...HEADER.app, platform: 'web' as 'ios' } }, list, 'INVALID'],
      [{ ...HEADER, dropped: { ...HEADER.dropped, invalid: -1 } }, list, 'INVALID'],
      [{ ...HEADER, dropped: { ...HEADER.dropped, expired: 1.5 } }, list, 'INVALID'],
      [{ ...HEADER, exportFormat: 2 as 1 }, list, 'INVALID'],
      [{ ...HEADER, kind: 'codelex.match_log' as 'codelex.playtest_data' }, list, 'INVALID'],
      [HEADER, [{ ...first, user_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }], 'INVALID'],
      [HEADER, [first, first], 'INVALID'],
      [HEADER, [{ ...first, deviceModel: 'SM-A135F' } as unknown as AnalyticsEvent], 'INVALID'],
    ];
    for (const [header, queued, code] of bad) {
      const mine = buildPlaytestFile(header, queued);
      expect(mine).toEqual({ ok: false, error: { code } });
      expect(buildPlaytestExport(header, queued).ok).toBe(false);
    }
  });

  it('property: same fit as D1 for any cap, and the same decision on mutated events', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 0, max: 16 }),
        fc.integer({ min: 300, max: 40_000 }),
        (n, offset, cap) => {
          const queued = events(n, offset);
          expect(fitPlaytestEvents(HEADER, queued, cap)).toBe(fitEventsToCap(HEADER, queued, cap));
        },
      ),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 16 }),
        fc.constantFrom('event_id', 'occurred_at', 'locale', 'schema_version', 'user_id'),
        fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
        (offset, key, value) => {
          const queued = events(2, offset);
          const mutated = [
            { ...queued[0], [key]: value } as AnalyticsEvent,
            queued[1] as AnalyticsEvent,
          ];
          expectSameAsD1(HEADER, mutated);
        },
      ),
    );
  });

  it('an event too large for the cap on its own is TOO_LARGE, never a partial file', () => {
    const queued = events(3);
    expect(fitPlaytestEvents(HEADER, queued, 10)).toBe(0);
    expect(buildPlaytestFile(HEADER, queued, 10)).toEqual({
      ok: false,
      error: { code: 'TOO_LARGE' },
    });
    const small = buildPlaytestFile(HEADER, queued, 1200);
    if (!small.ok) throw new Error(small.error.code);
    expect(utf8Length(small.value.text)).toBeLessThanOrEqual(1200);
    expect(small.value.included + small.value.remaining).toBe(3);
  });
});
