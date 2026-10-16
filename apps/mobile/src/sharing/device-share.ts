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
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { isInShareDirectory, SHARE_DIR, type ShareServices } from './share-file';

export function createDeviceShare(): ShareServices {
  const directory = (): Directory => new Directory(Paths.cache, SHARE_DIR);
  return {
    directory: {
      write(name, text) {
        const dir = directory();
        dir.create({ intermediates: true, idempotent: true });
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
