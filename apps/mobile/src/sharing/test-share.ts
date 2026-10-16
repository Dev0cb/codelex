/**
 * Test support (not shipped: nothing in the app imports it). An in-memory share directory and a scripted share
 * sheet that records what it was given and what was on "disk" while it was open. Files are keyed by their visible
 * name; the URI carries a new subdirectory per write, as on the device.
 */
import type { ShareServices, ShareSheetOptions } from './share-file';

export interface TestShare extends ShareServices {
  /** Files in the share directory now. */
  readonly files: Map<string, string>;
  /** One entry per opened sheet: the URI, options and the files present while it was open. */
  readonly opened: { uri: string; options: ShareSheetOptions; files: Map<string, string> }[];
  available: boolean;
  /** Next `write` throws (full disk). */
  failWrite: boolean;
  /** Next `open` rejects. */
  failOpen: boolean;
  /** Held until `closeSheet()` when true; otherwise the sheet closes at once. */
  holdSheet: boolean;
  closeSheet: () => void;
  clears: number;
  /** Files written so far (each in its own subdirectory). */
  writes: number;
}

export function createTestShare(): TestShare {
  const files = new Map<string, string>();
  let close: (() => void) | null = null;
  const share: TestShare = {
    files,
    opened: [],
    available: true,
    failWrite: false,
    failOpen: false,
    holdSheet: false,
    clears: 0,
    writes: 0,
    closeSheet: () => {
      const pending = close;
      close = null;
      pending?.();
    },
    directory: {
      write(name, text) {
        if (share.failWrite) {
          share.failWrite = false;
          throw new Error('ENOSPC');
        }
        files.set(name, text);
        share.writes += 1;
        // A fresh subdirectory per share, as on the device (a deterministic UUID v4 here).
        const id = `00000000-0000-4000-8000-${share.writes.toString(16).padStart(12, '0')}`;
        return `file:///cache/codelex-share/${id}/${name}`;
      },
      clear() {
        share.clears += 1;
        files.clear();
      },
    },
    sheet: {
      isAvailable: () => Promise.resolve(share.available),
      open(uri, options) {
        share.opened.push({ uri, options, files: new Map(files) });
        if (share.failOpen) {
          share.failOpen = false;
          return Promise.reject(new Error('no activity'));
        }
        if (!share.holdSheet) return Promise.resolve();
        return new Promise<void>((resolve) => {
          close = resolve;
        });
      },
    },
  };
  return share;
}
