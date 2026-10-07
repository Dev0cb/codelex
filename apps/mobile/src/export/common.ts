/**
 * Shared parts of the two user-initiated export files (sprint 4 D1): "Send playtest data" (slice S6c, AC-17) and
 * "Send match log" (slice S6d, AC-20; threat model TM-04). Both are JSON objects with `exportFormat: 1`, a `kind`
 * that tells them apart on import, and the exporting build in `app`. Contracts only: screens, share sheet and temp-file
 * cleanup are S6c/S6d.
 *
 * Versioning: `exportFormat` is bumped on any change an importer must know about (a key added, removed or retyped);
 * importers reject a format they do not know. Event-level changes are versioned by each event's `schema_version`.
 *
 * Portable: imports only `zod/mini` and sibling modules, so plain Node can reuse it (readout, TM-08 import).
 */
import type { Result } from '@codelex/config/result';
import * as z from 'zod/mini';

import { APP_VERSION_PATTERN, PLATFORMS } from '../analytics/events.ts';

export const EXPORT_FORMAT = 1;

/**
 * The exporting build: app version, store build number, platform. Nothing finer (no device model, no OS version,
 * TM-04): with ~40 testers, finer build data would help fingerprinting and adds nothing to a bug report.
 */
export const ExportAppSchema = z.strictObject({
  version: z.string().check(z.regex(APP_VERSION_PATTERN)),
  build: z.string().check(z.regex(/^\d{1,10}$/)),
  platform: z.enum(PLATFORMS),
});
export type ExportApp = z.infer<typeof ExportAppSchema>;

export type ExportError =
  /** The file does not match its schema; paths and codes only, never values. */
  | { readonly code: 'INVALID'; readonly issues: readonly string[] }
  | { readonly code: 'TOO_LARGE'; readonly bytes: number; readonly maxBytes: number };

/** UTF-8 byte length of `text` (no TextEncoder needed). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

export const issuesOf = (error: z.core.$ZodError): string[] =>
  error.issues.map((i) => `${i.path.map(String).join('.') || '<root>'}: ${i.code}`);

/**
 * The file's text: validated against `schema` (strict: unknown keys rejected) and capped at `maxBytes`. The export
 * screens write exactly this text; nothing else may build an export file.
 */
export function encodeExport<T>(
  schema: z.ZodMiniType<T>,
  file: T,
  maxBytes: number,
): Result<string, ExportError> {
  const parsed = schema.safeParse(file);
  if (!parsed.success)
    return { ok: false, error: { code: 'INVALID', issues: issuesOf(parsed.error) } };
  const text = JSON.stringify(parsed.data);
  const bytes = utf8Length(text);
  if (bytes > maxBytes) return { ok: false, error: { code: 'TOO_LARGE', bytes, maxBytes } };
  return { ok: true, value: text };
}

/**
 * Parses an export file's text on the receiving side: size cap before parsing (TM-08), then JSON, then the strict
 * schema. Never evaluates content.
 */
export function decodeExport<T>(
  schema: z.ZodMiniType<T>,
  text: string,
  maxBytes: number,
): Result<T, ExportError> {
  const bytes = utf8Length(text);
  if (bytes > maxBytes) return { ok: false, error: { code: 'TOO_LARGE', bytes, maxBytes } };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: 'INVALID', issues: ['<root>: invalid_json'] } };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: { code: 'INVALID', issues: issuesOf(parsed.error) } };
}
