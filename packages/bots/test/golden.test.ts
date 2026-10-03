/**
 * Golden decisions pinned per BOT_VERSION (bots-api §7). A failure means behaviour changed: if intended, bump
 * BOT_VERSION, regenerate `golden/decisions-v<N>.json` with `computeGolden` and have the diff reviewed. Never edit
 * the file to make a failing test pass.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOT_VERSION } from '../src/index.js';
import { computeGolden, type GoldenFile } from './support/golden.js';
import { syntheticIndex } from './support/lexicons.js';

const golden = JSON.parse(
  readFileSync(
    join(import.meta.dirname, 'golden', `decisions-v${String(BOT_VERSION)}.json`),
    'utf8',
  ),
) as GoldenFile;

describe('golden decisions', () => {
  it('covers 20 positions × 3 personalities of the pinned lexicon', () => {
    expect(golden.botVersion).toBe(BOT_VERSION);
    expect(golden.decisions).toHaveLength(60);
  });

  it('reproduces every pinned decision', () => {
    // Pinned to the seeded 2,000-form synthetic fixture, not the real data: curator batches (C2) change the
    // real lexicon every sprint and must not break the bots' golden. Real-data behaviour is covered by properties.
    const lexicon = syntheticIndex(2000);
    expect(lexicon.version).toBe(golden.lexiconVersion);
    expect(computeGolden(lexicon)).toEqual(golden);
  });
});
