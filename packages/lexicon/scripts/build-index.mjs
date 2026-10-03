#!/usr/bin/env node
// Builds the `.clxi` artefact of every profile (lexicon-index note §3.4, sprint L4):
//   dist/indexes/<lexiconVersion>/<profileId>.clxi + dist/indexes/<lexiconVersion>/manifest.json
// Refuses to build when the data cannot be loaded or `validateLexicon` reports any error, and refuses to write an
// artefact that does not decode with the expected version and profile. Artefacts are reproducible and git-ignored.
// Needs `pnpm --filter @codelex/lexicon build` first (imports the compiled builder from dist/).
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GLOBAL_PROFILE,
  canonicalize,
  computeLexiconVersion,
  lexiconContentDocument,
  profileDefinitionHash,
} from './canonical.mjs';
import { loadLexicon, validateLexicon } from './validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { buildLexiconIndex, decodeLexiconIndex } = await import('../dist/index/index.js');

// Optional `--data <dir>`: another data directory (tests, curator previews); default `data/` of this package.
const args = process.argv.slice(2);
let dataDir;
if (args.length === 2 && args[0] === '--data' && args[1]) dataDir = args[1];
else if (args.length > 0) {
  console.error('build:index: usage: build-index.mjs [--data <dir>]');
  process.exit(1);
}

let lex;
try {
  lex = loadLexicon(dataDir);
} catch (e) {
  // A refusal, not a crash: no stack trace (malformed JSON, bad blocklist line, missing directory…).
  console.error(
    `build:index refused: lexicon data cannot be loaded: ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exit(1);
}
const { errors } = validateLexicon(lex);
if (errors.length > 0) {
  console.error(
    `build:index refused: ${errors.length} validation error(s); run pnpm lexicon:validate`,
  );
  process.exit(1);
}
const version = computeLexiconVersion(lex);
const document = lexiconContentDocument(lex);
const outDir = join(ROOT, 'dist', 'indexes', version);
mkdirSync(outDir, { recursive: true });

const profiles = [];
for (const definition of [GLOBAL_PROFILE]) {
  const definitionHash = profileDefinitionHash(definition);
  const built = buildLexiconIndex(
    {
      version,
      profile: { id: definition.id, kind: definition.kind, definitionHash },
      document,
      blocklist: [...lex.blocklist],
    },
    { formatVersion: 1, gaddag: false },
  );
  if (!built.ok) {
    console.error(
      `build:index failed for ${definition.id}: ${built.error.code} ${built.error.message}`,
    );
    process.exit(1);
  }
  // Self-check before anything is written: the artefact must decode as the requested version and profile.
  const check = decodeLexiconIndex(built.value, { version, profileId: definition.id });
  if (!check.ok) {
    console.error(
      `build:index refused for ${definition.id}: artefact fails its own decoder: ${check.error.code} ${check.error.message}`,
    );
    process.exit(1);
  }
  const file = `${definition.id}.clxi`;
  writeFileSync(join(outDir, file), built.value);
  const sha256 = createHash('sha256').update(built.value).digest('hex');
  profiles.push({
    id: definition.id,
    kind: definition.kind,
    definitionHash,
    formatVersion: 1,
    file,
    bytes: built.value.length,
    sha256,
  });
  console.log(`${file}: ${built.value.length} bytes, sha256 ${sha256}`);
}
writeFileSync(
  join(outDir, 'manifest.json'),
  `${canonicalize({ lexiconVersion: version, profiles })}\n`,
);
console.log(`lexiconVersion ${version} → ${outDir}`);
