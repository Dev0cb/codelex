/**
 * zod building blocks for the ADR-0013 §D3 JCS subset: ASCII-printable strings (0x20-0x7E), safe integers other
 * than `-0`, arrays and plain objects. No booleans, no `null`, no fractions. Every report of this package is a
 * document of that subset, so the engine's own serialiser (`@codelex/game-engine/canonical`) can canonicalise it.
 *
 * Pure (ADR-0016 §D3.2): no `Date`, `Math.random`, `Intl`, `TextEncoder` or `node:*`.
 */
import { canonicalJson, isJcsInteger } from '@codelex/game-engine/canonical';
import { z } from 'zod';

/** Printable ASCII only (ADR-0013 §D3). */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/** Lowercase hex SHA-256 digest (64 chars). */
export const SHA256_HEX = /^[0-9a-f]{64}$/;

/** A string of the JCS subset. */
export const jcsString = z
  .string()
  .regex(PRINTABLE_ASCII, { message: 'must be printable ASCII (0x20-0x7E), ADR-0013 §D3' });

/** A bounded, non-empty identifier-like string of the JCS subset. */
export function jcsText(maxLength: number): z.ZodString {
  return jcsString.min(1).max(maxLength);
}

/** A number of the JCS subset: a safe integer other than `-0`. */
export const jcsInteger = z
  .int()
  .refine(isJcsInteger, { message: 'must be a safe integer other than -0, ADR-0013 §D3' });

/** A non-negative integer of the JCS subset. */
export const jcsCount = jcsInteger.check(z.nonnegative());

/** A positive integer of the JCS subset. */
export const jcsPositive = jcsInteger.check(z.positive());

/** Any value of the JCS subset (recursive; depth is bounded by {@link isCanonicalisable}). */
export type JcsValue = string | number | readonly JcsValue[] | { readonly [key: string]: JcsValue };

export const jcsValue: z.ZodType<JcsValue> = z.lazy(() =>
  z.union([jcsString, jcsInteger, z.array(jcsValue), z.record(jcsString, jcsValue)]),
);

/**
 * Canonical text of `value` per the engine serialiser, or `undefined` if `value` is outside the subset (for
 * instance nested deeper than `JCS_MAX_DEPTH`). The text is ASCII, so its length is its UTF-8 byte length.
 */
export function canonicalOrUndefined(value: unknown): string | undefined {
  try {
    return canonicalJson(value);
  } catch {
    return undefined;
  }
}

/**
 * True when `parsed` (a zod output) has the same canonical bytes as `input`. zod silently drops an own
 * `__proto__` key produced by `JSON.parse`, so a parse could otherwise accept a document and return different
 * content; the report parsers refuse that.
 */
export function sameCanonical(input: unknown, parsed: unknown): boolean {
  const text = canonicalOrUndefined(input);
  return text !== undefined && text === canonicalOrUndefined(parsed);
}

/** True when the engine serialiser accepts `value` (ADR-0013 §D3 subset, depth ≤ `JCS_MAX_DEPTH`). */
export function isCanonicalisable(value: unknown): boolean {
  return canonicalOrUndefined(value) !== undefined;
}

const SURROGATE_FIRST = 0xd800;
const SURROGATE_LAST = 0xdfff;
const HIGH_SURROGATE_LAST = 0xdbff;
const ONE_BYTE_LAST = 0x7f;
const TWO_BYTES_LAST = 0x7ff;

/**
 * UTF-8 byte length of `text` (lone surrogates count as U+FFFD, 3 bytes), computed by hand because
 * `TextEncoder` is not available on every runtime (ADR-0013 §D4.2).
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= ONE_BYTE_LAST) bytes += 1;
    else if (code <= TWO_BYTES_LAST) bytes += 2;
    else if (code >= SURROGATE_FIRST && code <= HIGH_SURROGATE_LAST) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next > HIGH_SURROGATE_LAST && next <= SURROGATE_LAST) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}
