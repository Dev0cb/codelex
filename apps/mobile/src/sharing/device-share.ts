/**
 * {@link ShareServices} on the device (slice S6c, TM-04): the share directory in the app cache through
 * expo-file-system (already a dependency), and the OS share sheet through expo-sharing (new in S6c: React Native's
 * `Share` API cannot share a file on Android). expo-sharing shares through its own non-exported `FileProvider`
 * (`${applicationId}.SharingFileProvider`, `grantUriPermissions`), so the receiving app gets a temporary read grant on
 * one `content://` URI, never a file path; on iOS it presents `UIActivityViewController`. Its promise resolves when
 * the sheet is dismissed. The share-into-app config plugin of expo-sharing is not used (not in `app.json`). That
 * provider's paths also cover the app's files and external storage, so `open` refuses any URI outside the share
 * directory (`isInShareDirectory`).
 */
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { isInShareDirectory, SHARE_DIR, type ShareServices } from './share-file';

/** A random UUID v4: the per-share subdirectory. */
const SHARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * @param newShareId A random UUID v4 per share (expo-crypto's CSPRNG on the device; tests inject one). It names the
 *   subdirectory the file is written to, so the `content://` URI differs at every share: a grant expo-sharing never
 *   revokes cannot read a later file (TM-04). The file keeps its visible name.
 */
export function createDeviceShare(newShareId: () => string = randomUUID): ShareServices {
  const directory = (): Directory => new Directory(Paths.cache, SHARE_DIR);
  return {
    directory: {
      write(name, text) {
        const id = newShareId();
        if (!SHARE_ID.test(id)) throw new Error('share id is not a UUID v4');
        const dir = new Directory(directory(), id);
        dir.create({ intermediates: true, idempotent: false });
        const file = new File(dir, name);
        file.write(text);
        return file.uri;
      },
      clear() {
        const dir = directory();
        if (dir.exists) dir.delete();
      },
    },
    sheet: {
      isAvailable: () => Sharing.isAvailableAsync(),
      open(uri, options) {
        // The FileProvider also exposes files-path and external-path: only the share directory may leave (TM-04).
        if (!isInShareDirectory(uri, directory().uri)) {
          return Promise.reject(new Error('refused: outside the share directory'));
        }
        return Sharing.shareAsync(uri, {
          mimeType: options.mimeType,
          UTI: options.uti,
          dialogTitle: options.title,
        });
      },
    },
  };
}
