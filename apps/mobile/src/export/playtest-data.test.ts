/**
 * "Send playtest data" envelope `exportFormat: 1` (AC-17, S6c contract; sprint 4 D1): strict, install-scoped id
 * only, size-capped, versioned, and round-trips through the receiving side's decoder.
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { EVENT_NAMES, type AnalyticsEvent } from '../analytics/events.ts';
import { INSTALL_ID, sampleEvent } from '../analytics/test-support.ts';
import { utf8Length } from './common.ts';
import {
  buildPlaytestExport,
  decodePlaytestExport,
  encodePlaytestExport,
  fitEventsToCap,
  PLAYTEST_DATA_FILE_NAME,
  PLAYTEST_EXPORT_MAX_BYTES,
  PLAYTEST_EXPORT_MAX_EVENTS,
  type PlaytestDataExport,
  type PlaytestDataHeader,
} from './playtest-data.ts';

const HEADER: PlaytestDataHeader = {
  exportFormat: 1,
  kind: 'codelex.playtest_data',
  app: { version: '0.1.0', build: '42', platform: 'android' },
  installId: INSTALL_ID,
  exportedAt: '2026-10-14T18:00:00.000Z',
  dropped: { queueCap: 0, expired: 0, invalid: 0 },
};

/** `n` events cycling through every event type, distinct ids. */
const events = (n: number): AnalyticsEvent[] =>
  Array.from(
    { length: n },
    (_, i) =>
      sampleEvent(EVENT_NAMES[i % EVENT_NAMES.length] ?? 'app_opened', i + 1) as AnalyticsEvent,
  );

const fileOf = (list: AnalyticsEvent[]): PlaytestDataExport => ({
  ...HEADER,
  remaining: 0,
  events: list,
});

/** Every key path of a JSON value (array indices collapsed to []). */
function keyPaths(value: unknown, path = ''): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(value)) {
    for (const item of value) for (const p of keyPaths(item, `${path}[]`)) out.add(p);
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.add(`${path}.${k}`);
      for (const p of keyPaths(v, `${path}.${k}`)) out.add(p);
    }
  }
  return out;
}

describe('playtest data export (exportFormat 1)', () => {
  it('uses a fixed file name with no date or id', () => {
    expect(PLAYTEST_DATA_FILE_NAME).toBe('codelex-playtest-data.json');
  });

  it('encodes and decodes every event type', () => {
    const file = fileOf(events(EVENT_NAMES.length * 2));
    const encoded = encodePlaytestExport(file);
    if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
    const decoded = decodePlaytestExport(encoded.value);
    expect(decoded).toEqual({ ok: true, value: file });
  });

  it('holds only allowlisted keys (no device, name or location field anywhere)', () => {
    const encoded = encodePlaytestExport(fileOf(events(EVENT_NAMES.length)));
    if (!encoded.ok) throw new Error('encode failed');
    const top = [...keyPaths(JSON.parse(encoded.value))].filter((p) => p.split('.').length === 2);
    expect(top.sort()).toEqual(
      [
        '.app',
        '.dropped',
        '.events',
        '.exportFormat',
        '.exportedAt',
        '.installId',
        '.kind',
        '.remaining',
      ].sort(),
    );
    const forbidden = new Set(
      'device model os email name phone ip lat lon lng location advertising idfa gaid imei serial mac file dir uri stack'.split(
        ' ',
      ),
    );
    const offending = [...keyPaths(JSON.parse(encoded.value))].filter((p) =>
      p.split(/[._[\]]+/).some((token) => forbidden.has(token.toLowerCase())),
    );
    expect(offending).toEqual([]);
  });

  it('rejects an unknown key, a wrong format or kind, and a foreign user_id', () => {
    const file = fileOf(events(3));
    const bad: unknown[] = [
      { ...file, deviceModel: 'SM-A135F' },
      { ...file, exportFormat: 2 },
      { ...file, kind: 'codelex.match_log' },
      { ...file, app: { ...file.app, osVersion: '14' } },
      { ...file, dropped: { ...file.dropped, other: 1 } },
      { ...file, installId: 'tester-moussa' },
      { ...file, events: [] },
      { ...file, events: [{ ...file.events[0], user_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }] },
      { ...file, events: [file.events[0], file.events[0]] },
    ];
    for (const candidate of bad) {
      const encoded = encodePlaytestExport(candidate as PlaytestDataExport);
      expect(encoded.ok).toBe(false);
      if (!encoded.ok) expect(encoded.error.code).toBe('INVALID');
    }
  });

  it('decoder: rejects oversize before parsing, bad JSON, and prototype keys', () => {
    expect(decodePlaytestExport('x'.repeat(PLAYTEST_EXPORT_MAX_BYTES + 1))).toEqual({
      ok: false,
      error: {
        code: 'TOO_LARGE',
        bytes: PLAYTEST_EXPORT_MAX_BYTES + 1,
        maxBytes: PLAYTEST_EXPORT_MAX_BYTES,
      },
    });
    expect(decodePlaytestExport('{"exportFormat":1,')).toEqual({
      ok: false,
      error: { code: 'INVALID', issues: ['<root>: invalid_json'] },
    });
    const encoded = encodePlaytestExport(fileOf(events(1)));
    if (!encoded.ok) throw new Error('encode failed');
    // Insert an own `__proto__` key as the first member of the top-level object.
    expect(encoded.value.startsWith('{')).toBe(true);
    const polluted = `{"__proto__":{"admin":true},${encoded.value.slice(1)}`;
    expect(decodePlaytestExport(polluted).ok).toBe(false);
    expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
  });

  it('decoder: deep nesting is an INVALID result, never an exception (TM-08)', () => {
    const depth = 150_000; // arrays: 2 bytes per level
    const objectDepth = 60_000; // objects: 6 bytes per level, under the cap
    const deepArray = `{"events":${'['.repeat(depth)}${']'.repeat(depth)}}`;
    const deepObject = `{"events":[${'{"a":'.repeat(objectDepth)}1${'}'.repeat(objectDepth)}]}`;
    for (const text of [deepArray, deepObject]) {
      expect(utf8Length(text)).toBeLessThanOrEqual(PLAYTEST_EXPORT_MAX_BYTES);
      const decoded = decodePlaytestExport(text);
      expect(decoded.ok).toBe(false);
      if (!decoded.ok) expect(decoded.error.code).toBe('INVALID');
    }
  });

  it('caps the file at 1,000,000 bytes (TM-08) and 5,000 events (queue cap)', () => {
    const queued = events(PLAYTEST_EXPORT_MAX_EVENTS + 10);
    const built = buildPlaytestExport(HEADER, queued);
    if (!built.ok) throw new Error(JSON.stringify(built.error));
    const { text, included } = built.value;
    expect(utf8Length(text)).toBeLessThanOrEqual(PLAYTEST_EXPORT_MAX_BYTES);
    expect(included).toBeLessThan(queued.length);
    const decoded = decodePlaytestExport(text);
    if (!decoded.ok) throw new Error('decode failed');
    expect(decoded.value.remaining).toBe(queued.length - included);
    expect(decoded.value.events.map((e) => e.event_id)).toEqual(
      queued.slice(0, included).map((e) => e.event_id),
    );
    // One more event would not have fitted.
    const tooMany: PlaytestDataExport = {
      ...HEADER,
      remaining: queued.length - included - 1,
      events: queued.slice(0, included + 1),
    };
    const over = encodePlaytestExport(tooMany);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe('TOO_LARGE');
  });

  it('never packs more than 5,000 events even when they are small', () => {
    const tiny = events(PLAYTEST_EXPORT_MAX_EVENTS + 1);
    expect(fitEventsToCap(HEADER, tiny, Number.MAX_SAFE_INTEGER)).toBe(PLAYTEST_EXPORT_MAX_EVENTS);
    expect(fitEventsToCap(HEADER, tiny, 10)).toBe(0);
    const empty = buildPlaytestExport(HEADER, []);
    expect(empty.ok).toBe(false);
  });

  it('property: the packed file is exactly as large as fitEventsToCap predicts, never over the cap', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 600, max: 30_000 }),
        (n, cap) => {
          const queued = events(n);
          const included = fitEventsToCap(HEADER, queued, cap);
          if (included === 0) return;
          const text = JSON.stringify({
            ...HEADER,
            remaining: queued.length,
            events: queued.slice(0, included),
          });
          expect(utf8Length(text)).toBeLessThanOrEqual(cap);
          if (included < n) {
            const next = JSON.stringify({
              ...HEADER,
              remaining: queued.length,
              events: queued.slice(0, included + 1),
            });
            expect(utf8Length(next)).toBeGreaterThan(cap);
          }
        },
      ),
    );
  });

  it('measures the bytes of an average event (for the S6c "several files" decision)', () => {
    const sample = events(EVENT_NAMES.length);
    const mean = sample.reduce((n, e) => n + utf8Length(JSON.stringify(e)), 0) / sample.length;
    // About 500 B per event: a full 5,000-event queue needs about three files under the 1 MB cap.
    expect(mean).toBeGreaterThan(300);
    expect(mean).toBeLessThan(700);
  });
});

describe('utf8Length', () => {
  it('counts UTF-8 bytes like Buffer.byteLength', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        expect(utf8Length(s)).toBe(Buffer.byteLength(s, 'utf8'));
      }),
    );
    // Lone surrogates encode as U+FFFD (3 bytes).
    expect(utf8Length('\ud800')).toBe(3);
    expect(utf8Length('\ud800x')).toBe(4);
    expect(utf8Length('\udc00')).toBe(3);
  });
});
