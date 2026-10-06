/**
 * Test support (not shipped: no app module imports it). An in-memory {@link FsPrimitives} that can simulate a
 * process kill at any write boundary (TM-01 acceptance test) or a full disk (`match.low_storage`).
 *
 * Every mutating call (`write`, `append`, `rename`, `remove`) is one boundary, numbered from 0. When the boundary
 * numbered `killAt` is reached, the process "dies": a `write` or `append` leaves only its first `tornBytes` bytes on
 * disk (default: none), a `rename` or `remove` does not happen, and every later call throws {@link ProcessKilled}.
 * `reboot()` returns the disk as the next process finds it.
 */
import type { FsPrimitives } from './data-store';

export class ProcessKilled extends Error {
  constructor() {
    super('process killed');
    this.name = 'ProcessKilled';
  }
}

export interface MemoryFsOptions {
  readonly killAt?: number;
  readonly tornBytes?: number;
}

export class MemoryFs implements FsPrimitives {
  readonly files = new Map<string, Uint8Array>();
  /** Mutating calls performed so far (the next boundary number). */
  boundaries = 0;
  killed = false;
  /** When set, `write` and `append` store this many bytes then throw, like a full disk. */
  fullAfter: number | null = null;
  /** Names read, for "no file read on mount" checks. */
  readonly reads: string[] = [];
  readonly writes: string[] = [];

  constructor(private readonly options: MemoryFsOptions = {}) {}

  /** The disk after the process died (or stopped): a new process with no fault planned. */
  reboot(options: MemoryFsOptions = {}): MemoryFs {
    const next = new MemoryFs(options);
    for (const [name, bytes] of this.files) next.files.set(name, bytes.slice());
    return next;
  }

  private boundary(): boolean {
    if (this.killed) throw new ProcessKilled();
    const index = this.boundaries;
    this.boundaries += 1;
    if (index === this.options.killAt) {
      this.killed = true;
      return true;
    }
    return false;
  }

  private store(name: string, bytes: Uint8Array, kill: boolean, base: Uint8Array): void {
    const full = this.fullAfter;
    const kept = kill ? (this.options.tornBytes ?? 0) : (full ?? bytes.length);
    const merged = new Uint8Array(base.length + Math.min(kept, bytes.length));
    merged.set(base);
    merged.set(bytes.subarray(0, Math.min(kept, bytes.length)), base.length);
    this.files.set(name, merged);
    this.writes.push(name);
    if (kill) throw new ProcessKilled();
    if (full !== null) throw new Error('ENOSPC');
  }

  read(name: string): Uint8Array | null {
    if (this.killed) throw new ProcessKilled();
    this.reads.push(name);
    return this.files.get(name)?.slice() ?? null;
  }

  size(name: string): number | null {
    if (this.killed) throw new ProcessKilled();
    return this.files.get(name)?.length ?? null;
  }

  write(name: string, bytes: Uint8Array): void {
    const kill = this.boundary();
    this.store(name, bytes, kill, new Uint8Array(0));
  }

  append(name: string, bytes: Uint8Array): void {
    const kill = this.boundary();
    this.store(name, bytes, kill, this.files.get(name) ?? new Uint8Array(0));
  }

  rename(from: string, to: string): void {
    if (this.boundary()) throw new ProcessKilled();
    const bytes = this.files.get(from);
    if (bytes === undefined) throw new Error(`rename: ${from} does not exist`);
    if (this.files.has(to)) throw new Error(`rename: ${to} exists`);
    this.files.delete(from);
    this.files.set(to, bytes);
    this.writes.push(to);
  }

  remove(name: string): void {
    if (this.boundary()) throw new ProcessKilled();
    if (this.files.delete(name)) this.writes.push(name);
  }

  list(): readonly string[] {
    if (this.killed) throw new ProcessKilled();
    return [...this.files.keys()];
  }
}
