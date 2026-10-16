/**
 * The "Send match log" file (E-1.5 AC-20, slice S6d; threat model TM-04; sprint 4 D1), envelope `exportFormat: 1`.
 * Two shapes, both strict:
 *
 * ```
 * readable:   { exportFormat: 1, kind: 'codelex.match_log', app, log: <ActionLog>, divergence?: { index, expected, actual } }
 * unreadable: { exportFormat: 1, kind: 'codelex.match_log', app, raw: <base64 of the record file, ≤ 256 KiB> }
 * ```
 *
 * - `log` is the JSON value of `serializeActionLog` output (ADR-0013 §D2; TM-04 wording): header (seed, versions,
 *   profile, setup), accepted actions, state hashes. It is validated by the engine's own strict parser, so the rules
 *   about its content live in one place. It holds no time, identifier or path (TM-01).
 * - `divergence` is the first divergent checkpoint when the log failed to replay (TM-10).
 * - `raw` is for a log the app cannot read: the record file's bytes as they are (on-device records hold no time,
 *   identifier or path by construction, TM-04), capped at the TM-02 log cap.
 * - No install id, no `local_match_id`, no timestamp, no device model or OS version (TM-04): the match log cannot be
 *   joined to the analytics data. `kind: 'codelex.match_log'` is the only addition to the TM-04 wording; it lets the
 *   import tell the two export files apart.
 * - Fixed file name; whole file capped at 384 KiB (within the TM-08 1 MB import cap).
 *
 * Not portable to plain Node (it uses `@codelex/game-engine` and the app's journal constants); the TM-08 import uses
 * `parseActionLog` directly.
 */
import type { Result } from '@codelex/config/result';
import { parseActionLog, type ActionLog } from '@codelex/game-engine';
import * as z from 'zod/mini';

// App modules outside the portable set keep the app's extensionless imports (this file is app-only anyway).
import { base64 } from '../match-log/base64';
import { LOG_MAX_BYTES } from '../persistence/match-journal';
import type { Divergence } from '../persistence/resume';
import {
  decodeExport,
  encodeExport,
  EXPORT_FORMAT,
  ExportAppSchema,
  type ExportApp,
  type ExportError,
} from './common.ts';

/** The `raw` encoding, shared with the on-device builder (`match-log/match-log-file.ts`). */
export { base64 };

export const MATCH_LOG_KIND = 'codelex.match_log';
export const MATCH_LOG_FILE_NAME = 'codelex-match-log.json';
/** TM-04: raw bytes of an unreadable log, at most the TM-02 log cap. */
export const MATCH_LOG_RAW_MAX_BYTES = LOG_MAX_BYTES;
/** Whole file: a raw export (base64 of 256 KiB ≈ 342 KiB) plus the envelope fits. */
export const MATCH_LOG_EXPORT_MAX_BYTES = 384 * 1024;

const BASE64_MAX_CHARS = Math.ceil(MATCH_LOG_RAW_MAX_BYTES / 3) * 4;
const HASH = () => z.string().check(z.regex(/^[0-9a-f]{16}$/));

/**
 * An action log the engine accepts (strict schema, canonical actions, registered rules version). The value is
 * re-serialised for `parseActionLog`: one extra parse, bounded by the file cap. Hostile depth makes `JSON.stringify`
 * throw, which counts as "not a log" (TM-08).
 */
const isActionLog = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  try {
    return parseActionLog(JSON.stringify(value)).ok;
  } catch {
    return false;
  }
};
const ActionLogSchema = z.custom<ActionLog>(isActionLog, 'not an action log the engine accepts');

const base = {
  exportFormat: z.literal(EXPORT_FORMAT),
  kind: z.literal(MATCH_LOG_KIND),
  app: ExportAppSchema,
};

export const ReadableMatchLogSchema = z.strictObject({
  ...base,
  log: ActionLogSchema,
  divergence: z.optional(
    z.strictObject({
      index: z.union([z.int().check(z.minimum(0)), z.enum(['final', 'from'])]),
      expected: HASH(),
      actual: HASH(),
    }),
  ),
});

export const RawMatchLogSchema = z.strictObject({
  ...base,
  raw: z
    .string()
    .check(
      z.minLength(4),
      z.maxLength(BASE64_MAX_CHARS),
      z.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    ),
});

export const MatchLogExportSchema = z.union([ReadableMatchLogSchema, RawMatchLogSchema]);
export type MatchLogExport = z.infer<typeof MatchLogExportSchema>;

/** The file for a log the engine can read, with its first divergence when it failed to replay. */
export function encodeMatchLog(
  app: ExportApp,
  log: ActionLog,
  divergence: Divergence | null,
): Result<string, ExportError> {
  const file: MatchLogExport = {
    exportFormat: EXPORT_FORMAT,
    kind: MATCH_LOG_KIND,
    app,
    log,
    ...(divergence === null ? {} : { divergence: { ...divergence } }),
  };
  return encodeExport(MatchLogExportSchema, file, MATCH_LOG_EXPORT_MAX_BYTES);
}

/** The file for a record file the app cannot read (corrupt framing or log). */
export function encodeRawMatchLog(app: ExportApp, bytes: Uint8Array): Result<string, ExportError> {
  if (bytes.length > MATCH_LOG_RAW_MAX_BYTES) {
    return {
      ok: false,
      error: { code: 'TOO_LARGE', bytes: bytes.length, maxBytes: MATCH_LOG_RAW_MAX_BYTES },
    };
  }
  const file: MatchLogExport = {
    exportFormat: EXPORT_FORMAT,
    kind: MATCH_LOG_KIND,
    app,
    raw: base64(bytes),
  };
  return encodeExport(MatchLogExportSchema, file, MATCH_LOG_EXPORT_MAX_BYTES);
}

/** Receiving side (TM-08 import): size cap, JSON, strict schema. */
export function decodeMatchLog(text: string): Result<MatchLogExport, ExportError> {
  return decodeExport(MatchLogExportSchema, text, MATCH_LOG_EXPORT_MAX_BYTES);
}
