/**
 * `corpus.digest` (ADR-0016 §D3.1): SHA-256 hex of the JCS of `{ path: content }` for every corpus file, computed
 * by every host from the values it embedded, with the engine's own serialiser and SHA-256.
 *
 * The golden files are JSON, not documents of the ADR-0013 §D3 subset: they hold booleans (`main`, `blank`,
 * `budgetExhausted`), one `null` (`wentOut`) and non-ASCII text (`§` in notes). The engine serialiser rejects all
 * three, so each value is first mapped, injectively, into the subset:
 *
 * - a string becomes `"s:" + escape(s)`, where `escape` writes every code unit outside 0x20–0x7D (so `~` itself,
 *   0x7E, too) as `~` + four lowercase hex digits;
 * - `true` / `false` / `null` become the strings `"b:1"` / `"b:0"` / `"n:"`, which no string can collide with;
 * - safe integers (not `-0`) stay numbers; arrays stay arrays; object keys are escaped the same way, without the
 *   prefix (a key is never a value).
 *
 * Fractions and unsafe integers are not in the corpus and throw `RangeError` (a new golden file with one needs a
 * decision, not a silent encoding). The digest identifies a corpus; it is not a security commitment.
 */
import { asciiBytes, canonicalJson, isJcsInteger, sha256Hex } from '@codelex/game-engine/canonical';

const ESCAPE = 0x7e; // '~'
const FIRST_PLAIN = 0x20;
const HEX_DIGITS = '0123456789abcdef';

function hex4(code: number): string {
  return (
    HEX_DIGITS.charAt((code >>> 12) & 0xf) +
    HEX_DIGITS.charAt((code >>> 8) & 0xf) +
    HEX_DIGITS.charAt((code >>> 4) & 0xf) +
    HEX_DIGITS.charAt(code & 0xf)
  );
}

/** Printable ASCII except `~` stays; everything else becomes `~XXXX` (UTF-16 code unit). Injective. */
export function escapeText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    out += code < FIRST_PLAIN || code >= ESCAPE ? `~${hex4(code)}` : text.charAt(i);
  }
  return out;
}

/** Maps a decoded JSON value into the ADR-0013 §D3 subset (module comment). Never modifies `value`. */
export function subsetOf(value: unknown): unknown {
  if (typeof value === 'string') return `s:${escapeText(value)}`;
  if (typeof value === 'boolean') return value ? 'b:1' : 'b:0';
  if (value === null) return 'n:';
  if (typeof value === 'number') {
    if (!isJcsInteger(value)) {
      throw new RangeError(`corpus digest: ${String(value)} is not a safe integer`);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(subsetOf);
  if (typeof value === 'object') {
    const out = Object.create(null) as Record<string, unknown>;
    for (const [key, item] of Object.entries(value)) out[escapeText(key)] = subsetOf(item);
    return out;
  }
  throw new TypeError(`corpus digest: ${typeof value} is not a JSON value`);
}

/** SHA-256 hex of the JCS of the subset image of `{ path: content }` (module comment). */
export function corpusDigest(files: Readonly<Record<string, unknown>>): string {
  return sha256Hex(asciiBytes(canonicalJson(subsetOf(files))));
}
