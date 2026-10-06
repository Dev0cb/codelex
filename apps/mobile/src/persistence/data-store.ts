/**
 * The app's private data directory as record files (threat model TM-01). Built on five file primitives so the same
 * crash-safety protocol runs on the device (expo-file-system, `device-fs.ts`) and under fault injection in Jest.
 *
 * - `append` adds framed records at the end of a file (the match log).
 * - `replace` swaps a whole file: write `<name>.tmp`, delete `<name>`, rename. The platforms' "move with overwrite"
 *   is itself a delete then a rename, so the protocol makes the gap explicit and `recover` closes it on the next
 *   start: a `.tmp` next to its file is an unfinished write (discarded); a `.tmp` alone was complete when its file
 *   was deleted, and is promoted if it decodes without a torn tail (a first write killed mid-way is discarded).
 *
 * Writes are synchronous and return once the OS has the bytes, which survives a process kill. There is no fsync in
 * expo-file-system: after a power loss the torn-tail rule of `records.ts` applies.
 */
import { decodeRecords, encodeRecord } from './records';

export interface FsPrimitives {
  /** Null when the file does not exist. */
  read(name: string): Uint8Array | null;
  /** Bytes, or null when the file does not exist. */
  size(name: string): number | null;
  /** Creates or truncates. */
  write(name: string, bytes: Uint8Array): void;
  /** Creates the file if needed. */
  append(name: string, bytes: Uint8Array): void;
  /** `to` must not exist. */
  rename(from: string, to: string): void;
  /** No-op when the file does not exist. */
  remove(name: string): void;
  list(): readonly string[];
}

export const TMP_SUFFIX = '.tmp';

export type ReadRecords =
  | { readonly kind: 'missing' }
  | { readonly kind: 'too_large' }
  | { readonly kind: 'corrupt' }
  | { readonly kind: 'ok'; readonly records: readonly string[]; readonly droppedTail: boolean };

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

export class DataStore {
  constructor(private readonly fs: FsPrimitives) {}

  /** Closes an interrupted `replace` (see the module comment). Run once per process, before any read. */
  recover(): void {
    const names = new Set(this.fs.list());
    for (const name of names) {
      if (!name.endsWith(TMP_SUFFIX)) continue;
      const target = name.slice(0, -TMP_SUFFIX.length);
      const bytes = names.has(target) ? null : this.fs.read(name);
      const decoded = bytes === null ? null : decodeRecords(bytes);
      if (decoded?.ok === true && !decoded.droppedTail && decoded.records.length > 0) {
        this.fs.rename(name, target);
      } else {
        this.fs.remove(name);
      }
    }
  }

  /** The records of `name`; the size cap is checked before reading (TM-02). */
  read(name: string, maxBytes: number): ReadRecords {
    const size = this.fs.size(name);
    if (size === null) return { kind: 'missing' };
    if (size > maxBytes) return { kind: 'too_large' };
    const bytes = this.fs.read(name);
    if (bytes === null) return { kind: 'missing' };
    const decoded = decodeRecords(bytes);
    return decoded.ok
      ? { kind: 'ok', records: decoded.records, droppedTail: decoded.droppedTail }
      : { kind: 'corrupt' };
  }

  list(): readonly string[] {
    return this.fs.list();
  }

  exists(name: string): boolean {
    return this.fs.size(name) !== null;
  }

  append(name: string, payloads: readonly string[]): void {
    this.fs.append(name, concat(payloads.map(encodeRecord)));
  }

  replace(name: string, payloads: readonly string[]): void {
    const tmp = name + TMP_SUFFIX;
    this.fs.write(tmp, concat(payloads.map(encodeRecord)));
    this.fs.remove(name);
    this.fs.rename(tmp, name);
  }

  /** Renames `from` over `to` (rotation); a kill in between leaves `from` in place, so the caller redoes it. */
  move(from: string, to: string): void {
    this.fs.remove(to);
    this.fs.rename(from, to);
  }

  remove(name: string): void {
    this.fs.remove(name);
  }
}
