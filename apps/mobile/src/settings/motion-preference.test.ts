import { describe, expect, it } from '@jest/globals';

import { DataStore, TMP_SUFFIX } from '../persistence/data-store';
import { MemoryFs } from '../persistence/memory-fs';
import { readMotionPreference, SETTINGS_FILE, writeMotionPreference } from './motion-preference';

describe('motion preference storage (D-22)', () => {
  it('defaults to following the system', () => {
    expect(readMotionPreference(new DataStore(new MemoryFs()))).toBe('system');
  });

  it('round-trips every value and recovers an interrupted write', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    for (const value of ['reduced', 'full', 'system'] as const) {
      expect(writeMotionPreference(store, value)).toBe(true);
      expect(readMotionPreference(new DataStore(fs.reboot()))).toBe(value);
    }
    writeMotionPreference(store, 'full');
    fs.files.set(SETTINGS_FILE + TMP_SUFFIX, fs.files.get(SETTINGS_FILE) ?? new Uint8Array(0));
    fs.files.delete(SETTINGS_FILE);
    expect(readMotionPreference(new DataStore(fs))).toBe('full');
  });

  it('falls back to system on unknown or unreadable content', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    store.replace(SETTINGS_FILE, ['{"v":1,"motion":"wild"}']);
    expect(readMotionPreference(store)).toBe('system');
    store.replace(SETTINGS_FILE, ['not json']);
    expect(readMotionPreference(store)).toBe('system');
    store.replace(SETTINGS_FILE, ['null']);
    expect(readMotionPreference(store)).toBe('system');
  });

  it('reports a failed write (settings.save_error)', () => {
    const fs = new MemoryFs();
    fs.fullAfter = 0;
    expect(writeMotionPreference(new DataStore(fs), 'reduced')).toBe(false);
  });
});
