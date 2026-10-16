/** DG1 note §4: 7 taps, each within 1 s of the previous; a longer gap restarts the count. */
import { describe, expect, it } from '@jest/globals';

import { createTapCounter, ENTRY_TAPS, ENTRY_WINDOW_MS } from './tap-gesture';

function counterAt(times: number[]): boolean[] {
  let i = 0;
  const counter = createTapCounter(() => times[i] ?? 0);
  return times.map(() => {
    const opened = counter.tap();
    i += 1;
    return opened;
  });
}

describe('createTapCounter (7 taps within 1 s each)', () => {
  it('opens on the 7th tap only', () => {
    expect(ENTRY_TAPS).toBe(7);
    expect(ENTRY_WINDOW_MS).toBe(1000);
    const opened = counterAt([0, 900, 1800, 2700, 3600, 4500, 5400]);
    expect(opened).toEqual([false, false, false, false, false, false, true]);
  });

  it('restarts after a gap longer than 1 s', () => {
    const opened = counterAt([
      0, 100, 200, 300, 400, 500, 1501, 1600, 1700, 1800, 1900, 2000, 2100,
    ]);
    expect(opened.indexOf(true)).toBe(12);
    expect(opened.filter(Boolean)).toHaveLength(1);
  });

  it('restarts the count after opening', () => {
    const times = Array.from({ length: 14 }, (_, i) => i * 10);
    const opened = counterAt(times);
    expect(opened.map((o, i) => (o ? i : -1)).filter((i) => i >= 0)).toEqual([6, 13]);
  });
});
