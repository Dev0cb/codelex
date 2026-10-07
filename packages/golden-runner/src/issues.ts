/**
 * Typed parse issues shared by the report parsers. Messages never contain stack traces; paths are JSONPath-like
 * (`$.suites[1].cases[0].observed`).
 */
import { err, ok, type Result } from '@codelex/config/result';
import type { z } from 'zod';

import { utf8ByteLength } from './jcs.js';

export interface ReportIssue {
  /** JSONPath-like location, `$` for the whole document. */
  readonly path: string;
  readonly message: string;
}

/** A document zod accepted but returned with different canonical bytes (see `sameCanonical`). */
export const CHANGED_BY_PARSING: ReportIssue = {
  path: '$',
  message: 'report content would change when parsed (for instance a "__proto__" key)',
};

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `$`, `$.a`, `$.a[0]`, `$["x y"]`. */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = '$';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${String(segment)}]`;
    else {
      const key = String(segment);
      out += IDENTIFIER.test(key) ? `.${key}` : `[${quoteKey(key)}]`;
    }
  }
  return out;
}

function quoteKey(key: string): string {
  let out = '"';
  for (const char of key) out += char === '"' || char === '\\' ? `\\${char}` : char;
  return `${out}"`;
}

export function issuesOf(error: z.ZodError): ReportIssue[] {
  return error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message }));
}

/**
 * Parses report text: rejects text above `maxBytes` UTF-8 bytes before `JSON.parse` (a cheap guard, ADR-0016
 * §D3.1 / §D7), then JSON syntax errors. The value is not validated here.
 */
export function parseJsonText(
  text: string,
  maxBytes: number,
  what: string,
): Result<unknown, ReportIssue[]> {
  const bytes = utf8ByteLength(text);
  if (bytes > maxBytes) {
    return err([
      {
        path: '$',
        message: `${what} is ${String(bytes)} bytes, above the ${String(maxBytes)}-byte limit`,
      },
    ]);
  }
  try {
    const value: unknown = JSON.parse(text);
    return ok(value);
  } catch {
    return err([{ path: '$', message: `${what} is not valid JSON` }]);
  }
}
