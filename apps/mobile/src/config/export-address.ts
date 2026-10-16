/**
 * The address the export screen suggests ("Send it to: …", design §5.9; threat model TM-07, S-2).
 *
 * - The address is a **build constant** (`BUNDLED_EXPORT_ADDRESS`), reviewed in a PR like any code; it is not an
 *   environment variable, a flag or remote config.
 * - Remote config (AC-19, a Stage 1 gate; none in Phase 1 builds) may only **hide** the line (`null`) or pick another
 *   entry of the bundled allowlist. Any other remote value is ignored: the bundled address stays.
 * - The address is the playtest mailbox named in the privacy policy and the consent form (design O-4, set by the
 *   product owner on 2026-10-16; privacy review of #100, condition m3). Changing it needs a privacy-compliance review.
 */

/**
 * A plain lower-case email address: no display name, no spaces, no line break, no list, no `mailto:`, a dotted domain
 * (TM-07: the line is copied by hand into a mail app, so nothing but the address may reach it).
 */
const EXPORT_ADDRESS_FORMAT =
  /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export function isExportAddress(value: string): boolean {
  return value.length <= 254 && EXPORT_ADDRESS_FORMAT.test(value);
}

/** Every address an export screen may ever display (TM-07 allowlist); each must pass {@link isExportAddress}. */
export const EXPORT_ADDRESS_ALLOWLIST: readonly string[] = ['titanfst00@gmail.com'];

/** The address shown by default; null = the line is hidden. Must be in the allowlist. */
export const BUNDLED_EXPORT_ADDRESS: string | null = 'titanfst00@gmail.com';

/**
 * The address to display, or null to hide the line. `remote` is the cached remote-config value, `undefined` when
 * there is none (always, in Phase 1).
 */
export function resolveExportAddress(
  remote: unknown,
  bundled: string | null = BUNDLED_EXPORT_ADDRESS,
  allowlist: readonly string[] = EXPORT_ADDRESS_ALLOWLIST,
): string | null {
  const allowed = (value: unknown): value is string =>
    typeof value === 'string' && allowlist.includes(value) && isExportAddress(value);
  const fallback = allowed(bundled) ? bundled : null;
  if (remote === null) return null;
  if (allowed(remote)) return remote;
  return fallback;
}
