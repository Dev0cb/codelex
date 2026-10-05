#!/usr/bin/env node
// Builds the `.clxi` artefacts of every profile in BUILT_PROFILES (`global-ranked`, and the simulation-only
// `global-no-inflections`, E-1.7 D-14) (lexicon-index note §3.4, sprints L4 and L5), one per header
// flags value: with the GADDAG (flags 1, server and default) and without it (flags 0, mobile fallback):
//   dist/indexes/<lexiconVersion>/<profileId>.f<flags>.clxi + dist/indexes/<lexiconVersion>/manifest.json
// Both variants share (lexiconVersion, profile id, definitionHash) but not their bytes, so the file name and
// the manifest entry carry the flags.
//   dist/indexes/current.json — stable pointer for consumers that cannot know the version in advance (L6):
//   { lexiconVersion, manifest: "<lexiconVersion>/manifest.json" }. Read it through `@codelex/lexicon/indexes`.
// dist/indexes/ holds exactly one version: it is emptied before writing, so the Turborepo `build:index` outputs
// (packages/lexicon/turbo.json) never cache a stale version next to the current one.
// Refuses to build when the data cannot be loaded or `validateLexicon` reports any error, and refuses to write an
// artefact that does not decode with the expected version and profile. Artefacts are reproducible and git-ignored.
// Needs `pnpm --filter @codelex/lexicon build` first (imports the compiled builder from dist/).
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILT_PROFILES,
  canonicalize,
  computeLexiconVersion,
  lexiconContentDocument,
  profileBuildInput,
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
const indexesDir = join(ROOT, 'dist', 'indexes');
const outDir = join(indexesDir, version);

// Header flags bit 0 = GADDAG present (src/index/clxi/format.ts).
const VARIANTS = [
  { flags: 1, gaddag: true },
  { flags: 0, gaddag: false },
];

const profiles = [];
const artefacts = [];
for (const definition of BUILT_PROFILES) {
  // One definition gives both the option the builder applies and the definitionHash that covers it (D-14).
  const profile = profileBuildInput(definition);
  const { definitionHash } = profile;
  for (const { flags, gaddag } of VARIANTS) {
    const built = buildLexiconIndex(
      {
        version,
        profile,
        document,
        blocklist: [...lex.blocklist],
      },
      { formatVersion: 1, gaddag },
    );
    if (!built.ok) {
      console.error(
        `build:index failed for ${definition.id}: ${built.error.code} ${built.error.message}`,
      );
      process.exit(1);
    }
    // Self-check before anything is written: the artefact must decode as the requested version and profile.
    const check = decodeLexiconIndex(built.value, { version, profileId: definition.id });
    if (!check.ok || (check.value.gaddag !== undefined) !== gaddag) {
      console.error(
        `build:index refused for ${definition.id}: artefact fails its own decoder: ${check.ok ? 'GADDAG presence differs from flags' : `${check.error.code} ${check.error.message}`}`,
      );
      process.exit(1);
    }
    const file = `${definition.id}.f${flags}.clxi`;
    artefacts.push({ file, bytes: built.value });
    const sha256 = createHash('sha256').update(built.value).digest('hex');
    profiles.push({
      id: definition.id,
      kind: definition.kind,
      definitionHash,
      formatVersion: 1,
      flags,
      gaddag,
      file,
      bytes: built.value.length,
      sha256,
    });
    console.log(`${file}: ${built.value.length} bytes, sha256 ${sha256}`);
  }
}
// Every artefact passed its self-check: only now is the previous output replaced.
rmSync(indexesDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const { file, bytes } of artefacts) writeFileSync(join(outDir, file), bytes);
writeFileSync(
  join(outDir, 'manifest.json'),
  `${canonicalize({ lexiconVersion: version, profiles })}\n`,
);
writeFileSync(
  join(indexesDir, 'current.json'),
  `${canonicalize({ lexiconVersion: version, manifest: `${version}/manifest.json` })}\n`,
);
// Package-relative: Turborepo replays this log on cache hits, possibly built on another machine.
console.log(
  `lexiconVersion ${version} → dist/indexes/${version} (pointer dist/indexes/current.json)`,
);
