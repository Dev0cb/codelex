/** TM-01: `replace` is crash-safe at every write boundary; `recover` closes an interrupted replace. */
import { describe, expect, it } from '@jest/globals';

import { DataStore, TMP_SUFFIX } from './data-store';
import { MemoryFs, ProcessKilled } from './memory-fs';

const read = (fs: MemoryFs, name: string) => {
  const store = new DataStore(fs);
  store.recover();
  return store.read(name, 1024);
};

describe('DataStore.replace under a kill (TM-01)', () => {
  it.each([0, 3])('leaves the old or the new content at every boundary (torn bytes %d)', (torn) => {
    // Boundaries 0–2 are the first replace (write tmp, delete, rename), 3–5 the second one.
    for (let killAt = 3; killAt < 6; killAt += 1) {
      const fs = new MemoryFs({ killAt, tornBytes: torn });
      const store = new DataStore(fs);
      store.replace('f', ['old']);
      expect(() => {
        store.replace('f', ['new']);
      }).toThrow(ProcessKilled);
      const after = read(fs.reboot(), 'f');
      expect(after.kind).toBe('ok');
      if (after.kind === 'ok') expect([['old'], ['new']]).toContainEqual(after.records);
    }
  });

  it('discards a first write killed mid-way (no file appears)', () => {
    const fs = new MemoryFs({ killAt: 0, tornBytes: 5 });
    expect(() => {
      new DataStore(fs).replace('f', ['first']);
    }).toThrow(ProcessKilled);
    const next = fs.reboot();
    expect(read(next, 'f')).toEqual({ kind: 'missing' });
    expect(next.files.has(`f${TMP_SUFFIX}`)).toBe(false);
  });

  it('promotes a complete temp file whose target was already deleted', () => {
    // Boundary 5 = the rename of the second replace: `f` is already deleted, its temp file is complete.
    const fs2 = new MemoryFs({ killAt: 5 });
    const store2 = new DataStore(fs2);
    store2.replace('f', ['old']);
    expect(() => {
      store2.replace('f', ['new']);
    }).toThrow(ProcessKilled);
    expect(fs2.files.has('f')).toBe(false);
    expect(read(fs2.reboot(), 'f')).toEqual({ kind: 'ok', records: ['new'], droppedTail: false });
  });
});

describe('DataStore.recover scope', () => {
  it('recovers only the files its owner names, so two owners share one directory', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    store.replace('mine', ['old']);
    store.replace('theirs', ['old']);
    // Interrupted replaces of both files: a complete temp file next to a deleted target.
    for (const name of ['mine', 'theirs']) {
      fs.files.set(name + TMP_SUFFIX, fs.files.get(name) ?? new Uint8Array(0));
      fs.files.delete(name);
    }
    store.recover((name) => name === 'mine');
    expect(fs.files.has('mine')).toBe(true);
    expect(fs.files.has(`theirs${TMP_SUFFIX}`)).toBe(true);
    expect(fs.files.has('theirs')).toBe(false);
  });
});

describe('DataStore.read', () => {
  it('checks the size cap before reading (TM-02)', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    store.append('f', ['x'.repeat(100)]);
    expect(store.read('f', 50)).toEqual({ kind: 'too_large' });
    expect(fs.reads).toEqual([]);
  });

  it('reports a bad record before the tail as corrupt', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    store.append('f', ['aaaa', 'bbbb']);
    const bytes = fs.files.get('f');
    if (bytes === undefined) throw new Error('missing');
    bytes[9] = 0x7a;
    expect(store.read('f', 1024)).toEqual({ kind: 'corrupt', prefix: [] });
  });

  it('moves a file over another and removes files', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    store.append('a', ['1']);
    store.append('b', ['2']);
    store.move('a', 'b');
    expect(store.exists('a')).toBe(false);
    expect(store.read('b', 64)).toEqual({ kind: 'ok', records: ['1'], droppedTail: false });
    store.remove('b');
    expect(store.read('b', 64)).toEqual({ kind: 'missing' });
  });
});

describe('DataStore.readBytes (S6d raw match log, TM-02 cap)', () => {
  it('returns the bytes as they are, checks the cap before reading, and reports a missing file', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    expect(store.readBytes('x', 8)).toEqual({ kind: 'missing' });
    fs.files.set('x', Uint8Array.from([1, 2, 3]));
    expect(store.readBytes('x', 3)).toEqual({ kind: 'ok', bytes: Uint8Array.from([1, 2, 3]) });
    fs.reads.length = 0;
    expect(store.readBytes('x', 2)).toEqual({ kind: 'too_large' });
    expect(fs.reads).toEqual([]);
  });
});
