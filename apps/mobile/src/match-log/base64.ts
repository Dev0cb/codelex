const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Standard base64 with padding (RFC 4648 §4), without relying on `btoa` or `Buffer`: the `raw` form of "Send match
 * log" (TM-04). Shared by the on-device builder (`match-log-file.ts`) and the D1 contract (`export/match-log.ts`).
 */
export function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63);
    out += i + 1 < bytes.length ? ALPHABET.charAt((n >> 6) & 63) : '=';
    out += i + 2 < bytes.length ? ALPHABET.charAt(n & 63) : '=';
  }
  return out;
}
