/**
 * {@link FsPrimitives} on the device: expo-file-system (already a dependency for the lexicon; no new package) in the
 * app's private data directory `<documents>/codelex-data`. That is internal storage on Android (`filesDir`, other
 * apps cannot read it) and the sandbox `Documents` folder on iOS (not exposed in the Files app: the build sets neither
 * `UIFileSharingEnabled` nor `LSSupportsOpeningDocumentsInPlace`).
 *
 * Kept out of OS backups (threat model TM-03): Android backup and device transfer are off for the whole app
 * (`plugins/with-backup-exclusion.cjs`), and on iOS the same plugin marks this directory excluded from iCloud and
 * computer backups at every launch, before any JavaScript runs.
 */
import { Directory, File, Paths } from 'expo-file-system';

import type { FsPrimitives } from './data-store';

/** Must equal `DATA_DIR` in plugins/with-backup-exclusion.cjs (checked by a test). */
export const DATA_DIR = 'codelex-data';

export function createDeviceFs(): FsPrimitives {
  let directory: Directory | null = null;
  const dir = (): Directory => {
    if (directory === null) {
      const created = new Directory(Paths.document, DATA_DIR);
      created.create({ intermediates: true, idempotent: true });
      directory = created;
    }
    return directory;
  };
  const file = (name: string): File => new File(dir(), name);
  return {
    read(name) {
      const f = file(name);
      return f.exists ? f.bytesSync() : null;
    },
    size(name) {
      const f = file(name);
      return f.exists ? f.size : null;
    },
    write(name, bytes) {
      file(name).write(bytes);
    },
    append(name, bytes) {
      file(name).write(bytes, { append: true });
    },
    rename(from, to) {
      file(from).rename(to);
    },
    remove(name) {
      const f = file(name);
      if (f.exists) f.delete();
    },
    list() {
      return dir()
        .list()
        .filter((entry) => entry instanceof File)
        .map((entry) => entry.name);
    },
  };
}
