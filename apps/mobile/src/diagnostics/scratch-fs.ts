/**
 * Scratch storage of the resume probe (DG1 note DS-6, §5.2): `<cache>/codelex-diagnostics/<fixture>/`, never the
 * app's data directory (`<documents>/codelex-data`: `current.log`, `current.snap`, `last.log`, `terms.seen`,
 * `resume.guard`). Lives in the diagnostics module (security review, non-blocking note), so production carries no
 * scratch factory. Same {@link FsPrimitives} as `persistence/device-fs.ts`, so the probe drives the production
 * `DataStore`/`createPersistence` code unchanged.
 */
import { Directory, File, Paths } from 'expo-file-system';

import type { FsPrimitives } from '../persistence/data-store';

/** The probe's directory in the app cache. */
export const SCRATCH_DIR = 'codelex-diagnostics';

/** Must stay different from `persistence/device-fs.ts` `DATA_DIR` (checked by a test). */
const FORBIDDEN = new Set(['codelex-data', 'codelex-share']);
const PLAIN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface ScratchStore {
  /** File primitives of one fixture's subdirectory. Throws on a name that is not plain. */
  fixture(name: string): FsPrimitives;
  /** Deletes the whole scratch directory; nothing when it does not exist. Never throws: false on failure. */
  clear(): boolean;
}

function directoryFs(directory: Directory): FsPrimitives {
  let created = false;
  const writable = (): Directory => {
    if (!created) {
      directory.create({ intermediates: true, idempotent: true });
      created = true;
    }
    return directory;
  };
  const file = (name: string, parent: Directory = directory): File => new File(parent, name);
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
      file(name, writable()).write(bytes);
    },
    append(name, bytes) {
      file(name, writable()).write(bytes, { append: true });
    },
    rename(from, to) {
      file(from, writable()).rename(to);
    },
    remove(name) {
      const f = file(name);
      if (f.exists) f.delete();
    },
    list() {
      if (!directory.exists) return [];
      return directory
        .list()
        .filter((entry) => entry instanceof File)
        .map((entry) => entry.name);
    },
  };
}

/**
 * The scratch store under the app cache. `root` is the directory name in the cache; it refuses the data and share
 * directories, so a wrong argument can never point the probe at the player's saved match (DG1-d).
 */
export function createScratchStore(root: string = SCRATCH_DIR): ScratchStore {
  if (!PLAIN.test(root) || FORBIDDEN.has(root)) {
    throw new RangeError('the scratch store lives in its own cache directory');
  }
  const base = (): Directory => new Directory(Paths.cache, root);
  return {
    fixture(name) {
      if (!PLAIN.test(name)) throw new RangeError('fixture names are plain');
      return directoryFs(new Directory(base(), name));
    },
    clear() {
      try {
        const dir = base();
        if (dir.exists) dir.delete();
        return true;
      } catch {
        return false;
      }
    },
  };
}
