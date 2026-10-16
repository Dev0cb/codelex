/**
 * {@link ShareServices} on the device (slice S6c, TM-04): the share directory in the app cache through
 * expo-file-system (already a dependency), and the OS share sheet through expo-sharing (new in S6c: React Native's
 * `Share` API cannot share a file on Android). expo-sharing shares through its own non-exported `FileProvider`
 * (`${applicationId}.SharingFileProvider`, `grantUriPermissions`), so the receiving app gets a temporary read grant on
 * one `content://` URI, never a file path; on iOS it presents `UIActivityViewController`. Its promise resolves when
 * the sheet is dismissed. The share-into-app config plugin of expo-sharing is not used (not in `app.json`).
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { SHARE_DIR, type ShareServices } from './share-file';

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
      open: (uri, options) =>
        Sharing.shareAsync(uri, {
          mimeType: options.mimeType,
          UTI: options.uti,
          dialogTitle: options.title,
        }),
    },
  };
}
