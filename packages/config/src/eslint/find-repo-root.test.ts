import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from './index.js';

describe('findRepoRoot', () => {
  it('finds the nearest ancestor holding pnpm-workspace.yaml', () => {
    expect(findRepoRoot(resolve(import.meta.dirname, '..', '..'))).toBe(
      resolve(import.meta.dirname, '..', '..', '..', '..'),
    );
  });

  it('throws a helpful error when there is no workspace above', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codelex-no-workspace-'));
    try {
      expect(() => findRepoRoot(dir)).toThrow(/pass \{ repoRoot \}/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
