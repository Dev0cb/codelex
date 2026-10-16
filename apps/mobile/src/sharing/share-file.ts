/**
 * The one share-and-cleanup path for files that leave the device on a tap (threat model TM-04, I-3; slice S6c):
 * "Send playtest data" now, "Send match log" (S6d) and the preview-only Diagnostics report (DG1) next.
 *
 * - The file is written to its own directory in the app **cache** (`<cache>/codelex-share/`), never to shared or
 *   external storage, and never to the backup-excluded data directory (`codelex-data`, TM-03).
 * - It is shared through the OS share sheet, which hands other apps a scoped, per-share URI (Android: the
 *   non-exported `FileProvider` of expo-sharing with a temporary read grant; iOS: the activity view controller).
 * - The whole directory is deleted when the sheet closes, whatever the tester did, and swept again at every app start
 *   (`sweepShareDirectory`), so a file left by a kill while the sheet was open does not survive the next launch. The
 *   sweep deletes the **directory**, not a list of names, so production code needs no other feature's file name
 *   (Diagnostics note DS-7, §6).
 * - Fixed file names without date or id (TM-04); the name is checked to be a plain file name.
 *
 * Effects are injected (`ShareServices`): `device-share.ts` on the device, an in-memory double in tests.
 */

/** The share directory in the app cache. */
export const SHARE_DIR = 'codelex-share';

const PLAIN_FILE_NAME = /^[a-z0-9][a-z0-9.-]{0,63}\.json$/;

export interface ShareDirectory {
  /** Writes `text` (UTF-8) as `name` in the share directory, creating it; returns the file URI. Throws on failure. */
  write(name: string, text: string): string;
  /** Deletes the share directory and everything in it; nothing when it does not exist. Throws on failure. */
  clear(): void;
}

export interface ShareSheetOptions {
  readonly mimeType: string;
  /** iOS Uniform Type Identifier. */
  readonly uti: string;
  /** Android chooser title (and the iOS share-sheet subject where supported). */
  readonly title: string;
}

export interface ShareSheet {
  isAvailable(): Promise<boolean>;
  /** Resolves when the sheet closes. The platforms do not say whether the file was sent (hence "Did you send it?"). */
  open(uri: string, options: ShareSheetOptions): Promise<void>;
}

export interface ShareServices {
  readonly directory: ShareDirectory;
  readonly sheet: ShareSheet;
}

/** `closed`: the sheet opened and closed (sent or not); `file_error`: the file could not be written; `share_error`. */
export type ShareOutcome = 'closed' | 'file_error' | 'share_error';

export interface ShareFile {
  readonly name: string;
  readonly text: string;
  readonly mimeType: string;
  readonly uti: string;
  readonly title: string;
}

/** Deletes the share directory (app start, before and after every share). True when it is gone. */
export function sweepShareDirectory(directory: ShareDirectory): boolean {
  try {
    directory.clear();
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes `file`, opens the share sheet and deletes the share directory when it closes. Never throws. The file is
 * written only once the sheet is known to be available, so an unavailable sheet leaves nothing behind.
 */
export async function shareTextFile(
  services: ShareServices,
  file: ShareFile,
): Promise<ShareOutcome> {
  if (!PLAIN_FILE_NAME.test(file.name)) return 'file_error';
  const { directory, sheet } = services;
  sweepShareDirectory(directory);
  let available: boolean;
  try {
    available = await sheet.isAvailable();
  } catch {
    available = false;
  }
  if (!available) return 'share_error';
  let uri: string;
  try {
    uri = directory.write(file.name, file.text);
  } catch {
    sweepShareDirectory(directory);
    return 'file_error';
  }
  try {
    await sheet.open(uri, { mimeType: file.mimeType, uti: file.uti, title: file.title });
    return 'closed';
  } catch {
    return 'share_error';
  } finally {
    sweepShareDirectory(directory);
  }
}
