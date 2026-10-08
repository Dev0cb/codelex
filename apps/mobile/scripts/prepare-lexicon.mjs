#!/usr/bin/env node
// Usage: node scripts/prepare-lexicon.mjs. Turborepo task `prepare:lexicon` (depends on @codelex/lexicon#build:index).
// Writes assets/lexicon/lexicon.clxi, assets/lexicon/lexicon.json and the Knowledge Card text assets/lexicon/cards.json
// (scripts/cards-asset.mjs); exits 1 when the artefact is missing, differs from its manifest, exceeds the lexiconBytes
// budget, or the lexicon data is not the version the index was built from.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveIndexArtefact } from '@codelex/lexicon/indexes';
import { loadLexicon } from '@codelex/lexicon/validate';

import { CARDS_FILE, prepareCardsAsset } from './cards-asset.mjs';
import {
  ASSET_FILE,
  prepareLexiconAsset,
  readLexiconByteLimit,
  writeAssetFile,
} from './lexicon-asset.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(appDir, 'assets', 'lexicon');
try {
  const d = prepareLexiconAsset({
    resolve: resolveIndexArtefact,
    outDir,
    maxBytes: readLexiconByteLimit(join(appDir, 'bundle-budget.json')),
  });
  console.log(
    `${ASSET_FILE}: ${d.profileId} f${d.flags} lexiconVersion ${d.lexiconVersion}, ${d.bytes} B, sha256 ${d.sha256}`,
  );
  const cards = prepareCardsAsset(loadLexicon(), d.lexiconVersion);
  writeAssetFile(outDir, CARDS_FILE, `${JSON.stringify(cards)}\n`);
  console.log(
    `${CARDS_FILE}: cardsVersion ${cards.cardsVersion}, ${cards.jsonLength} B JSON, ${cards.data.length} B base64`,
  );
} catch (error) {
  console.error(`prepare:lexicon: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
