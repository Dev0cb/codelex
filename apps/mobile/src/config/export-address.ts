/**
 * The address the export screen suggests ("Send it to: …", design §5.9; threat model TM-07, S-2).
 *
 * - The address is a **build constant** (`BUNDLED_EXPORT_ADDRESS`), reviewed in a PR like any code; it is not an
 *   environment variable, a flag or remote config.
 * - Remote config (AC-19, a Stage 1 gate; none in Phase 1 builds) may only **hide** the line (`null`) or pick another
 *   entry of the bundled allowlist. Any other remote value is ignored: the bundled address stays.
 * - No address is configured yet (design O-4: the playtest operator sets it at enrollment), so the line is hidden.
 *   ASSUMPTION: the operator's address lands as a one-line change of both constants below before Stage 0, reviewed
 *   by privacy-compliance (it must be the restricted team mailbox named in the consent form).
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
export const EXPORT_ADDRESS_ALLOWLIST: readonly string[] = [];

/** The address shown by default; null = the line is hidden. Must be in the allowlist. */
export const BUNDLED_EXPORT_ADDRESS: string | null = null;

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
