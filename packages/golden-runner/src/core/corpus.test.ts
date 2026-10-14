import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GOLDEN_CORPUS } from './corpus.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Published golden JSON that is deliberately NOT in the runner corpus (ADR-0016 §D3 item 3). Anything else under
 * the golden directories must be in GOLDEN_CORPUS, so a newly added golden (protected-paths allows ADDING files
 * under scoring/v*, replays/v*) cannot silently skip the Hermes check.
 */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const EXCLUDED: Readonly<Record<string, string>> = {
  // Append-only pin of frozen rules digests; not a §D3 suite (it hashes rules data the scoring/replay suites run).
  'packages/game-engine/test/golden/rules-digests.json': 'not a §D3 item 3 suite',
  // BOT_VERSION 1 record: frozen, never executed (bot reasoning is not replayed, ADR-0013 §D2; bots golden test).
  'packages/bots/test/golden/decisions-v1.json': 'frozen record, not executed',
};

/** Every `*.json` below `dir`, as repository paths; `drafts/` directories are out of scope (§D3 item 3). */
function goldenFiles(dir: string): string[] {
  return readdirSync(join(repo, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => relative(repo, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((path) => !path.split('/').includes('drafts'));
}

describe('GOLDEN_CORPUS covers every published golden (review M2)', () => {
  const published = [
    ...goldenFiles('packages/game-engine/test/golden'),
    ...goldenFiles('packages/bots/test/golden'),
  ].sort(byCodeUnit);

  it('lists exactly the published golden files minus the documented exclusions', () => {
    const expected = published.filter((path) => !(path in EXCLUDED));
    expect(Object.keys(GOLDEN_CORPUS).sort(byCodeUnit)).toEqual(expected);
  });

  it('excludes only files that exist (no stale exclusions)', () => {
    expect(Object.keys(EXCLUDED).every((path) => published.includes(path))).toBe(true);
  });

  it('embeds each file as published (the JSON import is the file content)', () => {
    for (const [path, content] of Object.entries(GOLDEN_CORPUS)) {
      expect(content, path).toEqual(JSON.parse(readFileSync(join(repo, path), 'utf8')));
    }
  });
});
