/**
 * Case plumbing of the runner core (ADR-0016 §D3.1): a case computes `observed` with public engine and bots APIs
 * and states what the golden file `expected`; it passes iff both have the same canonical bytes (the engine's own
 * serialiser). A thrown error or a typed engine/bots error becomes an `error` case with a typed name only, never a
 * message or a stack trace.
 */
import { asciiBytes, canonicalJson, sha256Hex } from '@codelex/game-engine/canonical';

import type { CoreCase } from './types.js';

/** §D3.1: `observed` holds the value itself up to 1 KB of canonical JSON, its SHA-256 above. */
export const OBSERVED_LIMIT = 1024;

const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const ERROR_NAME_MAX = 64;

/** What one case computed: both sides as values of the JCS subset, or a typed error. */
export type CaseResult =
  { readonly observed: unknown; readonly expected: unknown } | { readonly errorCode: string };

/** A case that is run lazily, so that one failing case never stops the suite. */
export interface CaseSpec {
  readonly id: string;
  readonly run: () => CaseResult;
}

/** Thrown inside a case to report a typed error (an engine or bots error code, a malformed golden file). */
export class CaseError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'CaseError';
    this.code = code;
  }
}

/** `errorCode` of the report: a typed name matching the A2 schema, `Error` when none is usable. */
export function errorCodeOf(error: unknown): string {
  const name = error instanceof CaseError ? error.code : error instanceof Error ? error.name : '';
  return ERROR_NAME.test(name) && name.length <= ERROR_NAME_MAX ? name : 'Error';
}

/** `observed` as reported: the value, or `{ sha256 }` of its canonical JSON when that is above 1 KB. */
export function reportedObserved(observed: unknown): unknown {
  const text = canonicalJson(observed);
  return text.length > OBSERVED_LIMIT ? { sha256: sha256Hex(asciiBytes(text)) } : observed;
}

/** Runs one case: never throws (a case that cannot be serialised is an `error` case too). */
export function runCase(spec: CaseSpec): CoreCase {
  try {
    const result = spec.run();
    if ('errorCode' in result) {
      return {
        id: spec.id,
        status: 'error',
        errorCode: errorCodeOf(new CaseError(result.errorCode)),
      };
    }
    const observed = canonicalJson(result.observed);
    const pass = observed === canonicalJson(result.expected);
    return {
      id: spec.id,
      status: pass ? 'pass' : 'fail',
      observed: reportedObserved(result.observed),
    };
  } catch (error) {
    return { id: spec.id, status: 'error', errorCode: errorCodeOf(error) };
  }
}

/** A value computed once, on first use (fixture lexicons, the replay), shared by the cases of a suite. */
export function lazy<T>(compute: () => T): () => T {
  let done = false;
  let value: T | undefined;
  return () => {
    if (!done) {
      value = compute();
      done = true;
    }
    return value as T;
  };
}

/** `ok` value of a `Result`, or a {@link CaseError} named after the error's `code`. */
export function unwrap<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string } },
): T {
  if (!result.ok) throw new CaseError(result.error.code);
  return result.value;
}

/** Integer encoding of a boolean for `observed` (the JCS subset has no booleans, ADR-0013 §D3). */
export function bit(flag: boolean): number {
  return flag ? 1 : 0;
}
