/**
 * Deep-link guard (docs/security/audit-exceptions.md, GHSA-vcc3-ghjq-m6fr). Expo Router parses incoming URLs with
 * `query-string` 7, whose `decode-uri-component` 0.2.2 falls back to an exponential decoder when the native
 * `decodeURIComponent` throws on malformed percent-encoding; a crafted link could freeze the JS thread. The patched
 * 0.5.0 is ESM-only and cannot replace 0.2.2 under `query-string` 7's `require()`, so every system URL is checked here,
 * in `+native-intent`, before routing: bounded length, printable ASCII only (OS URLs are percent-encoded), and the
 * whole URL must decode natively. A URL that decodes as a whole has only valid `%XX` runs, and `query-string` splits
 * on `&`, `=` and `+`, which never occur inside a run, so every component it decodes takes the native fast path.
 * Anything else opens Home.
 */

/** Longest accepted system URL; CODELEX links (invites, replays) are far shorter. */
export const MAX_DEEP_LINK_LENGTH = 512;

/** Where a rejected link lands. */
export const DEEP_LINK_FALLBACK = '/';

const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

/** True when `url` may reach the router. */
export function isSafeDeepLink(url: string): boolean {
  if (url.length > MAX_DEEP_LINK_LENGTH || !PRINTABLE_ASCII.test(url)) return false;
  try {
    decodeURIComponent(url);
    return true;
  } catch {
    return false;
  }
}

/** Expo Router `redirectSystemPath` hook: unchanged when safe, Home otherwise. */
export function redirectSystemPath({
  path,
}: {
  readonly path: string;
  readonly initial: boolean;
}): string {
  return isSafeDeepLink(path) ? path : DEEP_LINK_FALLBACK;
}
