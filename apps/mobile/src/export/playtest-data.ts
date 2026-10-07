/**
 * The "Send playtest data" file (E-1.5 AC-17, slice S6c; sprint 4 D1), envelope `exportFormat: 1`:
 *
 * ```
 * { exportFormat: 1, kind: 'codelex.playtest_data', app, installId, exportedAt,
 *   dropped: { queueCap, expired, invalid }, remaining, events: [ <wire-form events, oldest first> ] }
 * ```
 *
 * - The only identifier is `installId`, the install-scoped random UUID v4 shown in Settings (reset on reinstall). Every
 *   event's `user_id` must equal it. No name, email, device id, device model or OS version (AC-17, TM-04).
 * - `exportedAt` (device clock) replaces a per-event `uploaded_at`: buffering delay = `exportedAt − occurred_at`.
 * - `dropped` counts events lost since the last confirmed export: oldest dropped at the 5,000 cap, purged after 30
 *   days, and rejected by the event schemas at record time. `remaining` counts queued events left out of this file
 *   by the size cap; the tester sends them with the next file.
 * - Size cap 1,000,000 bytes: the TM-08 import accepts `.json` ≤ 1 MB. `fitEventsToCap` picks the oldest events
 *   that fit; "Yes, I sent it" clears exactly those (design §5.9).
 * - Fixed file name, no date or id in it (TM-04).
 *
 * Portable: zod/mini and sibling modules only, so the readout (sprint 4 KR) imports `decodePlaytestExport` from Node.
 */
import type { Result } from '@codelex/config/result';
import * as z from 'zod/mini';

import { AnalyticsEventSchema, type AnalyticsEvent } from '../analytics/events.ts';
import {
  decodeExport,
  encodeExport,
  EXPORT_FORMAT,
  ExportAppSchema,
  utf8Length,
  type ExportError,
} from './common.ts';

export const PLAYTEST_DATA_KIND = 'codelex.playtest_data';
export const PLAYTEST_DATA_FILE_NAME = 'codelex-playtest-data.json';
/** TM-08: the analysts' import accepts files up to 1 MB. */
export const PLAYTEST_EXPORT_MAX_BYTES = 1_000_000;
/** The queue cap (AC-17): a file never holds more events than the queue can. */
export const PLAYTEST_EXPORT_MAX_EVENTS = 5000;

const count = () => z.int().check(z.minimum(0));

export const PlaytestDataExportSchema = z
  .strictObject({
    exportFormat: z.literal(EXPORT_FORMAT),
    kind: z.literal(PLAYTEST_DATA_KIND),
    app: ExportAppSchema,
    installId: z.uuidv4(),
    exportedAt: z.iso.datetime(),
    dropped: z.strictObject({ queueCap: count(), expired: count(), invalid: count() }),
    remaining: count(),
    events: z.array(AnalyticsEventSchema).check(
      z.minLength(1),
      z.maxLength(PLAYTEST_EXPORT_MAX_EVENTS),
      z.refine((events) => new Set(events.map((e) => e.event_id)).size === events.length, {
        message: 'duplicate event_id',
      }),
    ),
  })
  .check(
    z.refine((file) => file.events.every((e) => e.user_id === file.installId), {
      message: 'every event user_id equals installId',
      path: ['events'],
    }),
  );

export type PlaytestDataExport = z.infer<typeof PlaytestDataExportSchema>;
export type PlaytestDataHeader = Omit<PlaytestDataExport, 'events' | 'remaining'>;

/** The file's text, or why it cannot be written. */
export function encodePlaytestExport(file: PlaytestDataExport): Result<string, ExportError> {
  return encodeExport(PlaytestDataExportSchema, file, PLAYTEST_EXPORT_MAX_BYTES);
}

/** Receiving side (readout, TM-08 import): size cap, JSON, strict schema. */
export function decodePlaytestExport(text: string): Result<PlaytestDataExport, ExportError> {
  return decodeExport(PlaytestDataExportSchema, text, PLAYTEST_EXPORT_MAX_BYTES);
}

/**
 * How many of `queued` (oldest first) fit in one file with `header`, at most `PLAYTEST_EXPORT_MAX_EVENTS`. Exact for
 * `JSON.stringify` output: the size of the header with an empty `events` array, plus each event, plus the commas.
 * `remaining` is sized for its largest value, so the result never overshoots. 0 means not even one event fits.
 */
export function fitEventsToCap(
  header: PlaytestDataHeader,
  queued: readonly AnalyticsEvent[],
  maxBytes: number = PLAYTEST_EXPORT_MAX_BYTES,
): number {
  let bytes = utf8Length(JSON.stringify({ ...header, remaining: queued.length, events: [] }));
  const limit = Math.min(queued.length, PLAYTEST_EXPORT_MAX_EVENTS);
  for (let n = 0; n < limit; n += 1) {
    bytes += utf8Length(JSON.stringify(queued[n])) + (n > 0 ? 1 : 0);
    if (bytes > maxBytes) return n;
  }
  return limit;
}

/** The file for the oldest events that fit, with `remaining` set (the caller keeps the rest queued). */
export function buildPlaytestExport(
  header: PlaytestDataHeader,
  queued: readonly AnalyticsEvent[],
): Result<{ readonly text: string; readonly included: number }, ExportError> {
  const included = fitEventsToCap(header, queued);
  const file: PlaytestDataExport = {
    ...header,
    remaining: queued.length - included,
    events: queued.slice(0, included),
  };
  const encoded = encodePlaytestExport(file);
  return encoded.ok ? { ok: true, value: { text: encoded.value, included } } : encoded;
}
