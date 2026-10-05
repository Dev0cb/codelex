/**
 * Test support (not shipped: nothing in the app imports it). Loads the very `.clxi` that `prepare:lexicon` bundles,
 * through the real loader; callers mock expo-asset, expo-crypto and expo-file-system with the Node stand-ins in
 * `jest/` (see jest.config.js).
 */
import { createMatch, type MatchState, type SeedHex } from '@codelex/game-engine';

import { createBundledLexiconSource } from '../lexicon/bundled-lexicon-source';
import { loadLexicon, type LoadedLexicon } from '../lexicon/load-lexicon';
import { HUMAN_SEAT, playMatchConfig } from './play-config';

let cached: Promise<LoadedLexicon> | undefined;

export function loadBundledLexicon(): Promise<LoadedLexicon> {
  cached ??= loadLexicon(createBundledLexiconSource()).then((result) => {
    if (!result.ok) throw new Error(`bundled lexicon failed to load: ${result.error.code}`);
    return result.value;
  });
  return cached;
}

/** `n` as a seed (16 hex chars). */
export const seedOf = (n: number): SeedHex => n.toString(16).padStart(16, '0') as SeedHex;

/** A new play match for `seed`; throws on an engine error (tests only). */
export function newPlayState(seed: SeedHex, lexicon: LoadedLexicon): MatchState {
  const created = createMatch(playMatchConfig(seed, lexicon.index), { lexicon: lexicon.index });
  if (!created.ok) throw new Error(created.error.message);
  return created.value.state;
}

/** The first seed from `from` whose match the given seat starts (R-CORE-004 draw). */
export function seedWhereFirst(seat: number, lexicon: LoadedLexicon, from = 1): SeedHex {
  for (let n = from; n < from + 64; n += 1) {
    if (newPlayState(seedOf(n), lexicon).firstSeat === seat) return seedOf(n);
  }
  throw new Error('no seed found');
}

export const humanStarts = (lexicon: LoadedLexicon, from?: number): SeedHex =>
  seedWhereFirst(HUMAN_SEAT, lexicon, from);
