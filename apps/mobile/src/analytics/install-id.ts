/**
 * The install-scoped pseudonymous id (E-1.5 "Events", AC-17): a random UUID v4 generated on the device, the
 * `user_id` of every event and the `installId` of the export, shown in Settings so a tester can ask for the deletion
 * of data already sent. Stored in the backup-excluded data directory (threat model TM-03, I-1, R1-4), so it never
 * reaches an OS backup and a reinstall gives a new one. Purged with the queue when consent is withdrawn; turning
 * consent back on generates a new one (a fresh pseudonym, unlinkable to the data sent before).
 */
import type { DataStore } from '../persistence/data-store';

export const INSTALL_ID_FILE = 'install.id';

/** RFC 9562 version 4, the form `z.uuidv4()` of the event schemas accepts. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const isUuidV4 = (value: string): boolean => UUID_V4.test(value);

/** The stored id, or null when there is none or it is not a UUID v4. */
export function readInstallId(store: DataStore): string | null {
  try {
    const read = store.read(INSTALL_ID_FILE, 128);
    const id = read.kind === 'ok' && read.records.length === 1 ? (read.records[0] ?? '') : '';
    return isUuidV4(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * The stored id, or a new one written now. A failed write (full disk) still returns the new id for this process; the
 * next start generates another, which the readout sees as a new install (a counted, visible effect, not a loss).
 */
export function ensureInstallId(store: DataStore, newUuid: () => string): string {
  const stored = readInstallId(store);
  if (stored !== null) return stored;
  const id = newUuid().toLowerCase();
  try {
    store.replace(INSTALL_ID_FILE, [id]);
  } catch {
    // Low storage: see above.
  }
  return id;
}
