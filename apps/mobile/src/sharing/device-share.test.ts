/**
 * The device share services (slice S6c, TM-04): the file goes to `<cache>/codelex-share/<random UUID>/`, never to
 * the data directory; clearing deletes the whole directory (DS-7); the sheet is expo-sharing with a JSON type.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createDeviceShare } from './device-share';
import { isInShareDirectory, SHARE_DIR, shareTextFile } from './share-file';

jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
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
  it('writes into a new random subdirectory of the cache share directory and clears the whole directory', () => {
    const ids = ['3f0c8a4e-9b1d-4c2a-8e6f-1a2b3c4d5e6f', '7a1e2b3c-4d5e-4f60-9a1b-2c3d4e5f6a7b'];
    const share = createDeviceShare(() => ids.shift() ?? 'none');
    const dir = join(Paths.cache.uri, SHARE_DIR);
    share.directory.clear(); // nothing to clear: no throw
    const uri = share.directory.write('codelex-playtest-data.json', '{"a":"é"}');
    expect(uri).toBe(
      join(dir, '3f0c8a4e-9b1d-4c2a-8e6f-1a2b3c4d5e6f', 'codelex-playtest-data.json'),
    );
    expect(readFileSync(uri, 'utf8')).toBe('{"a":"é"}');
    expect(uri.startsWith(Paths.document.uri)).toBe(false);
    // The next share gets another URI (expo-sharing never revokes a grant), with the same visible name.
    const next = share.directory.write('codelex-playtest-data.json', '{}');
    expect(next).toBe(
      join(dir, '7a1e2b3c-4d5e-4f60-9a1b-2c3d4e5f6a7b', 'codelex-playtest-data.json'),
    );
    writeFileSync(join(dir, 'codelex-diagnostics.json'), 'x');
    expect(readdirSync(dir).sort()).toEqual([
      '3f0c8a4e-9b1d-4c2a-8e6f-1a2b3c4d5e6f',
      '7a1e2b3c-4d5e-4f60-9a1b-2c3d4e5f6a7b',
      'codelex-diagnostics.json',
    ]);
    share.directory.clear();
    expect(existsSync(dir)).toBe(false);
    // An id that is not a UUID v4 never becomes a path.
    expect(() => share.directory.write('codelex-playtest-data.json', '{}')).toThrow('UUID v4');
    expect(existsSync(dir)).toBe(false);
  });

  it('shares through expo-sharing with the JSON type and deletes the file after', async () => {
    const share = createDeviceShare();
    let during: string[] = [];
    sharing.shareAsync.mockImplementationOnce(() => {
      during = readdirSync(join(Paths.cache.uri, SHARE_DIR), { recursive: true }).map(String);
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
    const [[uri, options] = []] = sharing.shareAsync.mock.calls;
    // expo-crypto's CSPRNG UUID v4 names the subdirectory.
    const subdir = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
    const [id = ''] = during.filter((p) => subdir.test(p));
    expect(uri).toBe(join(Paths.cache.uri, SHARE_DIR, id, 'codelex-playtest-data.json'));
    expect(options).toEqual({
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Send playtest data',
    });
    expect(during.sort()).toEqual([id, join(id, 'codelex-playtest-data.json')]);
    expect(existsSync(join(Paths.cache.uri, SHARE_DIR))).toBe(false);
  });

  it('opens the sheet only for a file in the share directory (the FileProvider also exposes other paths)', async () => {
    const share = createDeviceShare();
    const dir = join(Paths.cache.uri, SHARE_DIR);
    sharing.shareAsync.mockClear();
    const options = {
      mimeType: 'application/json',
      uti: 'public.json',
      title: 'Send playtest data',
    };
    for (const uri of [
      join(Paths.document.uri, 'codelex-data', 'install.id'),
      join(Paths.cache.uri, 'codelex-playtest-data.json'),
      `${dir}/../codelex-data/install.id`,
      `${dir}/./x.json`,
      `${dir}-other/codelex-playtest-data.json`,
      `${dir}/`,
      dir,
      `${dir}/x.json?y=1`,
      '/sdcard/Download/codelex-playtest-data.json',
    ]) {
      await expect(share.sheet.open(uri, options)).rejects.toThrow('outside the share directory');
    }
    expect(sharing.shareAsync).not.toHaveBeenCalled();
    await share.sheet.open(`${dir}/codelex-playtest-data.json`, options);
    expect(sharing.shareAsync).toHaveBeenCalledTimes(1);
  });

  it('isInShareDirectory accepts plain names under the directory, with or without its trailing slash', () => {
    const base = 'file:///data/user/0/app/cache/codelex-share/';
    expect(isInShareDirectory(`${base}a.json`, base)).toBe(true);
    expect(isInShareDirectory(`${base}0b1d/a.json`, base.slice(0, -1))).toBe(true);
    expect(isInShareDirectory(`${base}..%2Fx.json`, base)).toBe(false);
    expect(isInShareDirectory(`${base}a//b.json`, base)).toBe(false);
    expect(isInShareDirectory('file:///data/user/0/app/files/a.json', base)).toBe(false);
  });
});
