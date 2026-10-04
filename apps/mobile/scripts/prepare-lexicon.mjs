#!/usr/bin/env node
// Usage: node scripts/prepare-lexicon.mjs. Turborepo task `prepare:lexicon` (depends on @codelex/lexicon#build:index).
// Writes assets/lexicon/lexicon.clxi and assets/lexicon/lexicon.json; exits 1 when the artefact is missing, differs
// from its manifest or exceeds the lexiconBytes budget.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveIndexArtefact } from '@codelex/lexicon/indexes';

import { ASSET_FILE, prepareLexiconAsset, readLexiconByteLimit } from './lexicon-asset.mjs';

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
} catch (error) {
  console.error(`prepare:lexicon: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
