/**
 * The "Send playtest data" file built on the device (E-1.5 AC-17, slice S6c), without zod at runtime.
 *
 * The D1 contract `export/playtest-data.ts` (envelope `exportFormat: 1`) validates with `zod/mini`, which Metro bundles
 * whole (+555 KB per platform, S6a), so the app cannot import it. This module is its hand-written mirror, as
 * `event-guard.ts` is for the event schemas: same constants, same header checks, same event checks (each event goes
 * through `guardEvent` again: the file is built from an allowlist, never by copying state, TM-04), the same size fit
 * and the same JSON text, key order included (header and events rebuilt in schema order). `playtest-file.test.ts`
 * proves it equal to the D1 builder and decoder, which stay the Node-side reference (readout KR, TM-08 import).
 *
 * Only `import type` from `events.ts` (no zod in the bundle; `no-runtime-zod.test.ts`).
 */
import type { Result } from '@codelex/config/result';

import {
  GUARD_APP_VERSION,
  GUARD_ISO_DATETIME,
  GUARD_PLATFORMS,
  GUARD_UUID_V4,
  canonicalEvent,
  guardEvent,
} from './event-guard';
import type { AnalyticsEvent, Platform } from './events';
import { utf8Length } from './utf8';

/** Mirrors of the D1 constants (equality tested). */
export const PLAYTEST_FILE_FORMAT = 1;
export const PLAYTEST_FILE_KIND = 'codelex.playtest_data';
/** Fixed, no date or id in it (TM-04). */
export const PLAYTEST_FILE_NAME = 'codelex-playtest-data.json';
/** TM-08: the analysts' import accepts files up to 1 MB. */
export const PLAYTEST_FILE_MAX_BYTES = 1_000_000;
/** A file never holds more events than the queue can (AC-17). */
export const PLAYTEST_FILE_MAX_EVENTS = 5000;
const BUILD_PATTERN = /^\d{1,10}$/;

export interface PlaytestFileDropped {
  readonly queueCap: number;
  readonly expired: number;
  readonly invalid: number;
}

/** The D1 `PlaytestDataHeader` (assignability tested both ways). */
export interface PlaytestFileHeader {
  readonly exportFormat: 1;
  readonly kind: 'codelex.playtest_data';
  readonly app: { readonly version: string; readonly build: string; readonly platform: Platform };
  readonly installId: string;
  readonly exportedAt: string;
  readonly dropped: PlaytestFileDropped;
}

export type PlaytestFileError =
  /** The header or an event does not match the contract (never echoes values). */
  | { readonly code: 'INVALID' }
  /** Not even one event fits in the size cap (cannot happen for valid events, which are under 2 KB). */
  | { readonly code: 'TOO_LARGE' }
  /** Nothing to send: Share is disabled on an empty queue (design §5.9). */
  | { readonly code: 'EMPTY' };

export interface PlaytestFile {
  /** The file's exact text (UTF-8 ≤ 1 MB). */
  readonly text: string;
  /** Oldest events of `queued` in the file; "Yes, I sent it" clears exactly those. */
  readonly included: number;
  /** Queued events left for the next file (`remaining` in the file). */
  readonly remaining: number;
}

const isCount = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0;

/** The header in D1 key order (the order zod's strict parse returns), so the text equals D1's byte for byte. */
function canonicalHeader(header: PlaytestFileHeader): PlaytestFileHeader {
  return {
    exportFormat: header.exportFormat,
    kind: header.kind,
    app: {
      version: header.app.version,
      build: header.app.build,
      platform: header.app.platform,
    },
    installId: header.installId,
    exportedAt: header.exportedAt,
    dropped: {
      queueCap: header.dropped.queueCap,
      expired: header.dropped.expired,
      invalid: header.dropped.invalid,
    },
  };
}

/** The D1 header checks: literals, version and build patterns, platform, UUID v4, ISO time, counts. */
export function isValidHeader(header: PlaytestFileHeader): boolean {
  const { app, dropped } = header;
  // Widened: the types say these literals hold, the check is for data that does not follow the types.
  const literals: { readonly exportFormat: number; readonly kind: string } = header;
  return (
    literals.exportFormat === PLAYTEST_FILE_FORMAT &&
    literals.kind === PLAYTEST_FILE_KIND &&
    typeof app.version === 'string' &&
    GUARD_APP_VERSION.test(app.version) &&
    typeof app.build === 'string' &&
    BUILD_PATTERN.test(app.build) &&
    (GUARD_PLATFORMS as readonly string[]).includes(app.platform) &&
    typeof header.installId === 'string' &&
    GUARD_UUID_V4.test(header.installId) &&
    typeof header.exportedAt === 'string' &&
    GUARD_ISO_DATETIME.test(header.exportedAt) &&
    isCount(dropped.queueCap) &&
    isCount(dropped.expired) &&
    isCount(dropped.invalid)
  );
}

/**
 * How many of `queued` (oldest first) fit in one file with `header`, at most {@link PLAYTEST_FILE_MAX_EVENTS}: the
 * D1 `fitEventsToCap` algorithm (the header with an empty `events` array and `remaining` at its largest value, plus
 * each event, plus the commas). 0 means not even one event fits.
 */
export function fitPlaytestEvents(
  header: PlaytestFileHeader,
  queued: readonly AnalyticsEvent[],
  maxBytes: number = PLAYTEST_FILE_MAX_BYTES,
): number {
  let bytes = utf8Length(
    JSON.stringify({ ...canonicalHeader(header), remaining: queued.length, events: [] }),
  );
  const limit = Math.min(queued.length, PLAYTEST_FILE_MAX_EVENTS);
  for (let n = 0; n < limit; n += 1) {
    bytes += utf8Length(JSON.stringify(queued[n])) + (n > 0 ? 1 : 0);
    if (bytes > maxBytes) return n;
  }
  return limit;
}

/**
 * The file for the oldest events of `queued` that fit, with `remaining` set; the caller keeps the rest queued. The
 * included events must each pass `guardEvent`, carry `user_id === installId` and have distinct `event_id`s, as the
 * D1 schema requires; otherwise nothing is written (`INVALID`).
 */
export function buildPlaytestFile(
  header: PlaytestFileHeader,
  queued: readonly AnalyticsEvent[],
  maxBytes: number = PLAYTEST_FILE_MAX_BYTES,
): Result<PlaytestFile, PlaytestFileError> {
  if (queued.length === 0) return { ok: false, error: { code: 'EMPTY' } };
  if (!isValidHeader(header)) return { ok: false, error: { code: 'INVALID' } };
  const included = fitPlaytestEvents(header, queued, maxBytes);
  if (included === 0) return { ok: false, error: { code: 'TOO_LARGE' } };
  const events: AnalyticsEvent[] = [];
  const ids = new Set<string>();
  for (const event of queued.slice(0, included)) {
    if (!guardEvent(event).ok || event.user_id !== header.installId || ids.has(event.event_id)) {
      return { ok: false, error: { code: 'INVALID' } };
    }
    ids.add(event.event_id);
    // Schema key order, as D1's encoder writes it, whatever order the stored event has (the fit is unchanged:
    // reordering keys does not change the length).
    events.push(canonicalEvent(event));
  }
  const remaining = queued.length - included;
  // Never over `maxBytes`: the fit is exact for `JSON.stringify` output (property-tested against D1).
  const text = JSON.stringify({ ...canonicalHeader(header), remaining, events });
  return { ok: true, value: { text, included, remaining } };
}
