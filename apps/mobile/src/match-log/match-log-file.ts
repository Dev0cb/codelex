/**
 * The "Send match log" file built on the device (E-1.5 AC-20, slice S6d; threat model TM-04, I-2), without zod at
 * runtime. The D1 contract `export/match-log.ts` validates with `zod/mini`, which Metro bundles whole (+555 KB per
 * platform, S6a), so the app cannot import it; this module is its hand-written mirror, as `playtest-file.ts` is for
 * "Send playtest data". `match-log-file.test.ts` proves the text equal to D1's `encodeMatchLog` /
 * `encodeRawMatchLog`, byte for byte, and accepted by `decodeMatchLog` (the TM-08 import path).
 *
 * The file is built from an **allowlist**, never by copying a file of `codelex-data`:
 * - which match: the in-progress one (`current.log`), else the last finished one (`last.log`), else none (design
 *   §5.8). No other file of the data directory is ever read here (install id, analytics queue, settings, terms),
 *   except this module's own crash guard ({@link MATCH_LOG_GUARD_FILE}), which never enters the file.
 * - readable log: the record file is decoded (`storedLog`), checked by the engine's strict `parseActionLog` (unknown
 *   keys rejected, canonical actions, registered rules version), then re-serialised with `serializeActionLog` (JCS),
 *   so `log` can only hold `logVersion`, `header` (seed, versions, profile, setup), `actions` and `stateHashes`.
 *   `divergence` is the engine's first mismatching checkpoint when the log does not replay (TM-10). A log the resume
 *   found corrupt is never replayed here (its replay may be what crashed the app): the resume's divergence is used,
 *   none when the crash counter fired. Any other replay runs behind a crash guard (`guardedDivergence`).
 * - unreadable log (bad framing, unknown rules version, schema failure): `raw`, the record file's bytes in base64,
 *   capped at the TM-02 log cap. On-device records hold no time, identifier or path by construction (TM-01), so
 *   these bytes are safe as they are.
 * - envelope: `exportFormat: 1`, `kind: 'codelex.match_log'`, `app: { version, build, platform }`. No install id,
 *   `local_match_id`, timestamp, device model, OS version, path or stack trace (TM-04).
 */
import type { Result } from '@codelex/config/result';
import {
  parseActionLog,
  replay,
  serializeActionLog,
  type ActionLog,
  type EngineContext,
} from '@codelex/game-engine';

import { GUARD_APP_VERSION, GUARD_PLATFORMS } from '../analytics/event-guard';
import type { Platform } from '../analytics/events';
import { utf8Length } from '../analytics/utf8';
import type { DataStore } from '../persistence/data-store';
import { FILES, LOG_MAX_BYTES, storedLog } from '../persistence/match-journal';
import type { Divergence } from '../persistence/resume';
import { base64 } from './base64';

/** Mirrors of the D1 constants (equality tested). */
export const MATCH_LOG_FILE_FORMAT = 1;
export const MATCH_LOG_FILE_KIND = 'codelex.match_log';
/** Fixed, no date or id in it (TM-04). */
export const MATCH_LOG_FILE_NAME = 'codelex-match-log.json';
/** TM-04: raw bytes of an unreadable log, at most the TM-02 log cap. */
export const MATCH_LOG_FILE_RAW_MAX_BYTES = LOG_MAX_BYTES;
/** Whole file: a raw export (base64 of 256 KiB ≈ 342 KiB) plus the envelope fits (TM-08 import cap is 1 MB). */
export const MATCH_LOG_FILE_MAX_BYTES = 384 * 1024;
/**
 * Crash guard of the divergence replay (TM-04): written before it, removed after; it holds `scope bytes actions` of
 * the log being replayed, nothing else. Owned by match persistence (`MATCH_FILE_NAMES`).
 */
export const MATCH_LOG_GUARD_FILE = 'matchlog.guard';
const GUARD_MAX_BYTES = 256;

const BUILD_PATTERN = /^\d{1,10}$/;
const HASH = /^[0-9a-f]{16}$/;

/** Which match the file holds (`matchlog.scope.*`). */
export type MatchLogScope = 'current' | 'last';

/** The D1 `ExportApp` (assignability tested both ways): the exporting build, nothing finer (TM-04). */
export interface MatchLogApp {
  readonly version: string;
  readonly build: string;
  readonly platform: Platform;
}

export type MatchLogFileError =
  /** The match file went away between the sheet and the tap (e.g. "Start a new match" in between). */
  | { readonly code: 'MISSING' }
  /** The envelope does not match the contract (a bug; never echoes values). */
  | { readonly code: 'INVALID' }
  /** Over the raw or whole-file cap (cannot happen for a file the app wrote: logs are capped at 256 KiB). */
  | { readonly code: 'TOO_LARGE' };

const SCOPE_FILE: Readonly<Record<MatchLogScope, string>> = {
  current: FILES.log,
  last: FILES.last,
};

/** The match "Send match log" would export: the in-progress match, else the last finished one, else null. */
export function findMatchLog(store: DataStore): MatchLogScope | null {
  if (store.exists(FILES.log)) return 'current';
  if (store.exists(FILES.last)) return 'last';
  return null;
}

/** The D1 `ExportAppSchema` checks, in schema key order (so the text equals D1's). */
function canonicalApp(app: MatchLogApp): MatchLogApp | null {
  const valid =
    typeof app.version === 'string' &&
    GUARD_APP_VERSION.test(app.version) &&
    typeof app.build === 'string' &&
    BUILD_PATTERN.test(app.build) &&
    (GUARD_PLATFORMS as readonly string[]).includes(app.platform);
  return valid ? { version: app.version, build: app.build, platform: app.platform } : null;
}

/** The log as the engine accepts it, or null when it cannot be read (then the raw bytes are exported). */
function readableLog(
  store: DataStore,
  name: string,
): { readonly log: ActionLog; readonly bytes: number } | null {
  const stored = storedLog(store.read(name, LOG_MAX_BYTES));
  if (stored.kind !== 'ok') return null;
  const parsed = parseActionLog(stored.text);
  return parsed.ok ? { log: parsed.value, bytes: utf8Length(stored.text) } : null;
}

/** First divergent checkpoint (every stored hash verified), or null when the log replays or fails otherwise. */
function divergenceOf(log: ActionLog, ctx: EngineContext): Divergence | null {
  try {
    const replayed = replay(log, ctx, { verify: 'all' });
    if (replayed.ok || replayed.error.code !== 'HASH_MISMATCH') return null;
    const { index, expected, actual } = replayed.error.details;
    const indexOk =
      index === 'final' || index === 'from' || (Number.isSafeInteger(index) && index >= 0);
    return indexOk && HASH.test(expected) && HASH.test(actual) ? { index, expected, actual } : null;
  } catch {
    return null;
  }
}

/**
 * {@link divergenceOf} behind a crash guard (TM-04; the "Send match log" twin of the TM-02 D-1 resume counter). A
 * replay that never returns (native crash, out of memory, a hang the player kills) leaves {@link MATCH_LOG_GUARD_FILE}
 * naming that log; every later export of the same log then skips the replay and goes out without `divergence`, so the
 * one log that matters can always be sent. Another log (a new match) replays again and replaces the guard. When the
 * guard cannot be written (full disk) the replay is not run either: availability over the divergence hint.
 */
function guardedDivergence(
  store: DataStore,
  fingerprint: string,
  log: ActionLog,
  ctx: EngineContext,
): Divergence | null {
  if (store.exists(MATCH_LOG_GUARD_FILE)) {
    const guard = store.read(MATCH_LOG_GUARD_FILE, GUARD_MAX_BYTES);
    if (guard.kind === 'ok' && guard.records[0] === fingerprint) return null;
  }
  try {
    store.replace(MATCH_LOG_GUARD_FILE, [fingerprint]);
  } catch {
    return null;
  }
  const divergence = divergenceOf(log, ctx);
  try {
    store.remove(MATCH_LOG_GUARD_FILE);
  } catch {
    // Left behind: the next export of this log skips the replay, which is only a lost hint.
  }
  return divergence;
}

function capped(text: string): Result<string, MatchLogFileError> {
  return utf8Length(text) > MATCH_LOG_FILE_MAX_BYTES
    ? { ok: false, error: { code: 'TOO_LARGE' } }
    : { ok: true, value: text };
}

export interface MatchLogBuildOptions {
  /**
   * The resume's verdict when it found `current.log` unusable (`state_corrupt`, the corrupt card), including the
   * TM-02 D-1 crash counter firing (`divergence: null`). For `current`, its divergence is used as is and the log is
   * never replayed here: that replay may be what crashed the app (TM-04).
   */
  readonly corrupt?: { readonly divergence: Divergence | null } | null;
}

/**
 * The file's exact text for `scope` (read now, from disk). Never throws. Readable logs are re-serialised by the
 * engine; unreadable ones go out as `raw`.
 */
export function buildMatchLogFile(
  store: DataStore,
  scope: MatchLogScope,
  app: MatchLogApp,
  ctx: EngineContext,
  options: MatchLogBuildOptions = {},
): Result<string, MatchLogFileError> {
  try {
    const envelopeApp = canonicalApp(app);
    if (envelopeApp === null) return { ok: false, error: { code: 'INVALID' } };
    const name = SCOPE_FILE[scope];
    const base = {
      exportFormat: MATCH_LOG_FILE_FORMAT,
      kind: MATCH_LOG_FILE_KIND,
      app: envelopeApp,
    };
    const readable = readableLog(store, name);
    if (readable !== null) {
      const { log } = readable;
      const corrupt = scope === 'current' ? (options.corrupt ?? null) : null;
      const divergence =
        corrupt !== null
          ? corrupt.divergence
          : guardedDivergence(
              store,
              [scope, readable.bytes, log.actions.length].join(' '),
              log,
              ctx,
            );
      // `serializeActionLog` (JCS) re-serialises only the engine-checked fields: the allowlist of `log`.
      const canonical: unknown = JSON.parse(serializeActionLog(log));
      return capped(
        JSON.stringify({
          ...base,
          log: canonical,
          ...(divergence === null ? {} : { divergence }),
        }),
      );
    }
    const raw = store.readBytes(name, MATCH_LOG_FILE_RAW_MAX_BYTES);
    if (raw.kind === 'missing') return { ok: false, error: { code: 'MISSING' } };
    if (raw.kind === 'too_large' || raw.bytes.length === 0) {
      // An empty file has nothing to report; the D1 schema needs at least one base64 quantum.
      return { ok: false, error: { code: raw.kind === 'too_large' ? 'TOO_LARGE' : 'MISSING' } };
    }
    return capped(JSON.stringify({ ...base, raw: base64(raw.bytes) }));
  } catch {
    return { ok: false, error: { code: 'INVALID' } };
  }
}
