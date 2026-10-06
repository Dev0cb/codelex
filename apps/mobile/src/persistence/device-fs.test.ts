/**
 * The device primitives against a real file system (the Node stand-in of expo-file-system), and the TM-03 contract
 * between the data directory and the backup-exclusion config plugin.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { createRequire } from 'node:module';

import { Directory, Paths } from 'expo-file-system';

import { DataStore } from './data-store';
import { createDeviceFs, DATA_DIR } from './device-fs';

jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));

const requireCjs = createRequire(__filename);

describe('device file primitives', () => {
  it('reads without creating the data directory (nothing saved = nothing on disk)', () => {
    const fs = createDeviceFs();
    expect(fs.list()).toEqual([]);
    expect(fs.read('a')).toBeNull();
    fs.remove('a');
    expect(new Directory(Paths.document, DATA_DIR).exists).toBe(false);
  });

  it('writes, appends, renames, lists and removes in the data directory', () => {
    const fs = createDeviceFs();
    expect(fs.read('a')).toBeNull();
    expect(fs.size('a')).toBeNull();
    fs.write('a', Uint8Array.of(1, 2));
    fs.append('a', Uint8Array.of(3));
    expect(fs.read('a')).toEqual(Uint8Array.of(1, 2, 3));
    expect(fs.size('a')).toBe(3);
    fs.rename('a', 'b');
    expect(fs.list()).toEqual(['b']);
    expect(() => {
      fs.write('c', Uint8Array.of(0));
      fs.rename('b', 'c');
    }).toThrow();
    fs.remove('b');
    fs.remove('b');
    fs.remove('c');
    expect(fs.list()).toEqual([]);
  });

  it('runs the record store on top of them', () => {
    const store = new DataStore(createDeviceFs());
    store.replace('x', ['one']);
    store.replace('x', ['two']);
    store.append('x', ['three']);
    expect(store.read('x', 1024)).toEqual({
      kind: 'ok',
      records: ['two', 'three'],
      droppedTail: false,
    });
  });

  it('uses the directory the backup-exclusion plugin excludes (TM-03)', () => {
    const plugin = requireCjs('../../plugins/with-backup-exclusion.cjs') as { DATA_DIR: string };
    expect(plugin.DATA_DIR).toBe(DATA_DIR);
  });
});
