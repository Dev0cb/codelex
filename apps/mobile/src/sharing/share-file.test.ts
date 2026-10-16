/**
 * TM-04 / I-3 share and cleanup path (slice S6c): the temp file exists only while the sheet is open, in the share
 * directory, and the directory is swept as a whole (DS-7). Failures are outcomes, never exceptions.
 */
import { describe, expect, it } from '@jest/globals';

import { shareTextFile, sweepShareDirectory, type ShareFile } from './share-file';
import { createTestShare } from './test-share';

const FILE: ShareFile = {
  name: 'codelex-playtest-data.json',
  text: '{"exportFormat":1}',
  mimeType: 'application/json',
  uti: 'public.json',
  title: 'Send playtest data',
};

describe('shareTextFile (TM-04)', () => {
  it('writes the file, opens the sheet with it, and deletes the directory when the sheet closes', async () => {
    const share = createTestShare();
    share.files.set('codelex-diagnostics.json', 'left by a killed process');
    expect(await shareTextFile(share, FILE)).toBe('closed');
    expect(share.opened).toHaveLength(1);
    const [opened] = share.opened;
    expect(opened?.uri).toBe('file:///cache/codelex-share/codelex-playtest-data.json');
    expect(opened?.options).toEqual({
      mimeType: 'application/json',
      uti: 'public.json',
      title: 'Send playtest data',
    });
    // Only this file was there while the sheet was open (leftovers swept first).
    expect([...(opened?.files.entries() ?? [])]).toEqual([[FILE.name, FILE.text]]);
    expect(share.files.size).toBe(0);
  });

  it('keeps the file while the sheet is open and removes it once it closes', async () => {
    const share = createTestShare();
    share.holdSheet = true;
    const outcome = shareTextFile(share, FILE);
    await Promise.resolve();
    await Promise.resolve();
    expect(share.files.has(FILE.name)).toBe(true);
    share.closeSheet();
    expect(await outcome).toBe('closed');
    expect(share.files.size).toBe(0);
  });

  it('writes nothing when the sheet is unavailable', async () => {
    const share = createTestShare();
    share.available = false;
    expect(await shareTextFile(share, FILE)).toBe('share_error');
    expect(share.opened).toHaveLength(0);
    expect(share.files.size).toBe(0);
    share.available = true;
    share.sheet.isAvailable = () => Promise.reject(new Error('module missing'));
    expect(await shareTextFile(share, FILE)).toBe('share_error');
  });

  it('reports a write failure (low storage) and leaves nothing', async () => {
    const share = createTestShare();
    share.failWrite = true;
    expect(await shareTextFile(share, FILE)).toBe('file_error');
    expect(share.opened).toHaveLength(0);
    expect(share.files.size).toBe(0);
  });

  it('reports a sheet that fails to open and still deletes the file', async () => {
    const share = createTestShare();
    share.failOpen = true;
    expect(await shareTextFile(share, FILE)).toBe('share_error');
    expect(share.files.size).toBe(0);
  });

  it('refuses a name that is not a plain .json file name', async () => {
    const share = createTestShare();
    for (const name of ['../codelex-data/install.id', 'a/b.json', 'report.txt', '']) {
      expect(await shareTextFile(share, { ...FILE, name })).toBe('file_error');
    }
    expect(share.opened).toHaveLength(0);
  });

  it('sweepShareDirectory clears the whole directory and never throws', () => {
    const share = createTestShare();
    share.files.set('anything.json', 'x');
    share.files.set('other.bin', 'y');
    expect(sweepShareDirectory(share.directory)).toBe(true);
    expect(share.files.size).toBe(0);
    share.directory.clear = () => {
      throw new Error('EBUSY');
    };
    expect(sweepShareDirectory(share.directory)).toBe(false);
  });
});
