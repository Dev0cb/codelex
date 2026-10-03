/**
 * BOT-2 belt and braces (the eslint `@typescript-eslint/no-restricted-imports` rule is the primary guard): shipped
 * source never imports the match state, replay, the seed derivation or an RNG constructor.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');
const BANNED = [
  'MatchState',
  'SeatState',
  'apply',
  'createMatch',
  'replay',
  'parseState',
  'serializeState',
  'stateHash',
  'observe',
  'deriveStream',
  'deriveRng',
  'deriveStreamState',
  'createRng',
  'stateFromDigest',
];

function shippedFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return shippedFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('purity of src/', () => {
  const files = shippedFiles(SRC);

  it('finds the shipped sources', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('%s imports nothing state- or seed-related from the engine', (file) => {
    const text = readFileSync(file, 'utf8');
    const engineImports = [
      ...text.matchAll(/import\s+(?:type\s+)?([^;]*?)\s+from\s+'(@codelex\/game-engine[^']*)'/gs),
    ];
    for (const [, clause = '', source = ''] of engineImports) {
      expect(['@codelex/game-engine', '@codelex/game-engine/rng']).toContain(source);
      expect(clause).not.toMatch(/\*/);
      const names = clause
        .replace(/[{}]/g, '')
        .split(',')
        .map(
          (n) =>
            n
              .trim()
              .replace(/^type\s+/, '')
              .split(/\s+as\s+/)[0] ?? '',
        )
        .filter((n) => n !== '');
      for (const name of names) expect(BANNED).not.toContain(name);
    }
    expect(text).not.toMatch(/\bMath\.random\b|\bDate\.now\b/);
  });
});
