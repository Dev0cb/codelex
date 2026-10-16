/**
 * The device share services (slice S6c, TM-04): the file goes to `<cache>/codelex-share/`, never to the data
 * directory; clearing deletes the whole directory (DS-7); the sheet is expo-sharing with a JSON type.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createDeviceShare } from './device-share';
import { SHARE_DIR, shareTextFile } from './share-file';

jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

interface SharingMock {
  isAvailableAsync: jest.Mock<() => Promise<boolean>>;
  shareAsync: jest.Mock<(uri: string, options: unknown) => Promise<void>>;
}
const sharing = jest.requireMock<SharingMock>('expo-sharing');
const { Paths } = jest.requireActual<{
  Paths: { cache: { uri: string }; document: { uri: string } };
}>('../../jest/expo-file-system.cjs');

describe('createDeviceShare', () => {
  it('writes into the cache share directory and clears the whole directory', () => {
    const share = createDeviceShare();
    const dir = join(Paths.cache.uri, SHARE_DIR);
    share.directory.clear(); // nothing to clear: no throw
    const uri = share.directory.write('codelex-playtest-data.json', '{"a":"é"}');
    expect(uri).toBe(join(dir, 'codelex-playtest-data.json'));
    expect(readFileSync(uri, 'utf8')).toBe('{"a":"é"}');
    expect(uri.startsWith(Paths.document.uri)).toBe(false);
    writeFileSync(join(dir, 'codelex-diagnostics.json'), 'x');
    expect(readdirSync(dir).sort()).toEqual([
      'codelex-diagnostics.json',
      'codelex-playtest-data.json',
    ]);
    share.directory.clear();
    expect(existsSync(dir)).toBe(false);
  });

  it('shares through expo-sharing with the JSON type and deletes the file after', async () => {
    const share = createDeviceShare();
    let during: string[] = [];
    sharing.shareAsync.mockImplementationOnce(() => {
      during = readdirSync(join(Paths.cache.uri, SHARE_DIR));
      return Promise.resolve();
    });
    const outcome = await shareTextFile(share, {
      name: 'codelex-playtest-data.json',
      text: '{}',
      mimeType: 'application/json',
      uti: 'public.json',
      title: 'Send playtest data',
    });
    expect(outcome).toBe('closed');
    expect(sharing.isAvailableAsync).toHaveBeenCalled();
    expect(sharing.shareAsync).toHaveBeenCalledWith(
      join(Paths.cache.uri, SHARE_DIR, 'codelex-playtest-data.json'),
      { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Send playtest data' },
    );
    expect(during).toEqual(['codelex-playtest-data.json']);
    expect(existsSync(join(Paths.cache.uri, SHARE_DIR))).toBe(false);
  });
});
