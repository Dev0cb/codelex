/**
 * Canonical JSON for the state hash: the RFC 8785 (JCS) subset of ADR-0013 §D3.
 *
 * Accepted values: plain objects (prototype `Object.prototype` or `null`, own enumerable string keys only),
 * dense arrays (no holes, no extra properties), strings of printable ASCII (0x20–0x7E, keys included) and
 * safe integers other than `-0`. On that subset RFC 8785 reduces to: keys sorted by UTF-16 code units, no
 * whitespace, only `"` and `\` escaped, integers in shortest decimal form. Everything else (booleans, `null`,
 * fractions, `undefined`, functions, symbols, bigints, class instances, non-ASCII or control characters) is a
 * programmer error and throws: `TypeError` for a value of the wrong kind, `RangeError` for a value of the
 * right kind outside the subset (number range, character range, nesting depth).
 *
 * Pure: no `JSON.stringify` (ADR-0013 §D4.2), no `TextEncoder`; recursion is bounded by {@link JCS_MAX_DEPTH}
 * (§D4.8), which also turns a cyclic input into a `RangeError` instead of a stack overflow.
 */

import { asciiBytes, sha256Hex } from './sha256.js';

/** Maximum nesting of arrays and objects (ADR-0013 §D4.8: Hermes has a small native stack). */
export const JCS_MAX_DEPTH = 64;

/** Length of the truncated hash of ADR-0013 §D3 (`stateHash`) and §D7 (`lexiconVersion`). */
const HASH16_LENGTH = 16;

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const FIRST_PRINTABLE = 0x20;
const LAST_PRINTABLE = 0x7e;

type Path = (string | number)[];

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * JSONPath-like location for error messages, e.g. `$.seats[1].score` or `$["x y"]`. Keys are pushed onto the
 * path only after `quote` accepted them, so every key segment is printable ASCII and `quote` cannot throw here.
 */
function formatPath(path: Path): string {
  let out = '$';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${String(segment)}]`;
    else if (IDENTIFIER.test(segment)) out += `.${segment}`;
    else out += `[${quote(segment, [], 'key')}]`;
  }
  return out;
}

function fail(kind: 'type' | 'range', message: string, path: Path): never {
  const text = `canonicalJson: ${message} at ${formatPath(path)} (ADR-0013 §D3 subset)`;
  throw kind === 'type' ? new TypeError(text) : new RangeError(text);
}

/** JSON string literal of `text`; throws on any code unit outside printable ASCII. */
function quote(text: string, path: Path, what: string): string {
  let out = '"';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < FIRST_PRINTABLE || code > LAST_PRINTABLE) {
      fail(
        'range',
        `${what} has code unit 0x${code.toString(16)} at index ${String(i)}, outside printable ASCII 0x20-0x7e`,
        path,
      );
    }
    if (code === QUOTE || code === BACKSLASH) {
      out += `${text.slice(start, i)}\\`;
      start = i;
    }
  }
  return `${out}${text.slice(start)}"`;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function writeArray(items: readonly unknown[], depth: number, path: Path): string {
  if (Object.getPrototypeOf(items) !== Array.prototype) fail('type', 'array subclass', path);
  let out = '[';
  for (let i = 0; i < items.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(items, i))
      fail('type', `sparse array (hole at index ${String(i)})`, path);
    path.push(i);
    out += `${i === 0 ? '' : ','}${write(items[i], depth, path)}`;
    path.pop();
  }
  // Own keys of a dense plain array are its indices plus `length`; anything else is an extra property.
  if (Reflect.ownKeys(items).length !== items.length + 1)
    fail('type', 'array with extra properties', path);
  return `${out}]`;
}

function writeObject(record: object, depth: number, path: Path): string {
  const proto: unknown = Object.getPrototypeOf(record);
  if (proto !== Object.prototype && proto !== null) fail('type', 'non-plain object', path);
  const keys = Object.keys(record);
  if (Reflect.ownKeys(record).length !== keys.length) {
    fail('type', 'object with symbol keys or non-enumerable properties', path);
  }
  keys.sort(byCodeUnit);
  let out = '{';
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] as string;
    const name = quote(key, path, 'key');
    path.push(key);
    out += `${i === 0 ? '' : ','}${name}:${write((record as Record<string, unknown>)[key], depth, path)}`;
    path.pop();
  }
  return `${out}}`;
}

function write(value: unknown, depth: number, path: Path): string {
  switch (typeof value) {
    case 'string':
      return quote(value, path, 'string');
    case 'number':
      if (!Number.isSafeInteger(value))
        fail('range', `number ${String(value)} is not a safe integer`, path);
      if (Object.is(value, -0)) fail('range', 'negative zero', path);
      return String(value);
    case 'object': {
      if (value === null) return fail('type', 'null', path);
      if (depth >= JCS_MAX_DEPTH) {
        fail('range', `nesting deeper than ${String(JCS_MAX_DEPTH)} (or a cycle)`, path);
      }
      return Array.isArray(value)
        ? writeArray(value, depth + 1, path)
        : writeObject(value, depth + 1, path);
    }
    case 'boolean':
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      return fail('type', `${typeof value} value`, path);
  }
}

/**
 * RFC 8785 canonical JSON text of `value`, restricted to the ADR-0013 §D3 subset (see the module comment).
 * The output is ASCII, so its UTF-8 bytes are `asciiBytes(output)`. The input is never modified.
 * @throws TypeError | RangeError when `value` contains anything outside the subset (programmer error).
 */
export function canonicalJson(value: unknown): string {
  return write(value, 0, []);
}

/**
 * `hex(SHA-256(UTF-8(JCS(value))))[0..16)`: the 16 lowercase hex chars (64 bits) used by `stateHash`
 * (ADR-0013 §D3). Divergence detection only, not a security commitment.
 * @throws TypeError | RangeError as {@link canonicalJson}.
 */
export function hash16(value: unknown): string {
  return sha256Hex(asciiBytes(canonicalJson(value))).slice(0, HASH16_LENGTH);
}
