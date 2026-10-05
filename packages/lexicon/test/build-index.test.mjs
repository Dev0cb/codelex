// scripts/build-index.mjs (lexicon-index note §3.1, §3.4): refusals are one-line messages with exit code 1 and
// no stack trace; a successful build writes artefacts that decode as the manifest says. Runs the compiled dist/
// builder, like the script itself (`pnpm test` runs after `build` and `build:index`, turbo dependsOn).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GLOBAL_PROFILE,
  NO_INFLECTIONS_PROFILE,
  computeLexiconVersion,
  lexiconContentDocument,
  profileDefinitionHash,
} from '../scripts/canonical.mjs';
import { INDEXES_DIR, readIndexManifest, resolveIndexArtefact } from '../scripts/indexes.mjs';
import { loadLexicon } from '../scripts/validate.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(PKG, 'scripts', 'build-index.mjs');
const { buildLexiconIndex, decodeLexiconIndex } = await import('../dist/index/index.js');

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('refuses unloadable data with a one-line message, exit 1, no stack trace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clx-build-index-'));
  try {
    mkdirSync(join(dir, 'terms'));
    writeFileSync(join(dir, 'categories.json'), '{ not json');
    const r = run('--data', dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^build:index refused: lexicon data cannot be loaded: /);
    assert.equal(r.stderr.trim().split('\n').length, 1);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
    assert.equal(r.stdout, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses invalid data (validation errors), exit 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clx-build-index-'));
  try {
    mkdirSync(join(dir, 'terms'));
    writeFileSync(join(dir, 'categories.json'), JSON.stringify({ categories: [] }));
    writeFileSync(
      join(dir, 'terms', 'devops.json'),
      JSON.stringify({ schemaVersion: 2, category: 'devops', terms: [{ id: 'x' }] }),
    );
    const r = run('--data', dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^build:index refused: \d+ validation error\(s\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The real artefacts are not rebuilt here: `test` depends on the Turborepo `build:index` task
// (packages/lexicon/turbo.json), so this checks the very output that a cache hit restores and that apps copy
// (one build per CI run, sprint L6).
test('the build:index output decodes and matches its manifest (sha256, bytes, flags, current data)', () => {
  const { lexiconVersion, dir, profiles } = readIndexManifest();
  assert.equal(lexiconVersion, computeLexiconVersion(loadLexicon()), 'stale build:index output');
  assert.deepEqual(readdirSync(INDEXES_DIR).sort(), [lexiconVersion, 'current.json'].sort());
  assert.deepEqual(
    readdirSync(dir).sort(),
    ['manifest.json', ...profiles.map((p) => p.file)].sort(),
  );
  assert.deepEqual(profiles.map((p) => `${p.id}.f${p.flags}`).sort(), [
    'global-no-inflections.f0',
    'global-no-inflections.f1',
    'global-ranked.f0',
    'global-ranked.f1',
  ]);
  for (const profile of profiles) {
    const { bytes, entry } = resolveIndexArtefact({ profileId: profile.id, flags: profile.flags });
    assert.deepEqual(entry, profile);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), profile.sha256);
    assert.equal(profile.file, `${profile.id}.f${profile.flags}.clxi`);
    assert.equal(profile.gaddag, profile.flags === 1);
    const decoded = decodeLexiconIndex(bytes, { version: lexiconVersion, profileId: profile.id });
    assert.equal(decoded.ok, true);
    assert.equal(decoded.ok && decoded.value.gaddag !== undefined, profile.gaddag);
  }
});

// Sprint 3 P8 (E-1.7 D-14): the `inflections` profile option must not move a single byte of the default
// artefacts (batch 3 and letters-v2 are frozen balance-check inputs), and the no-inflection artefacts must be the
// very bytes the simulator built by stripping inflections before P8.
//
// 1. Pinned bytes. sha256 of the four artefacts built by the pre-P8 code (origin/main at 00dad89) for
//    lexiconVersion e568477b5592a994: global-ranked from `build:index`, global-no-inflections from the pre-P8
//    simulator call (profile without the option, document with every inflection removed). Only meaningful for
//    that lexiconVersion; any later data change is a new version and skips this pin.
const PRE_P8_VERSION = 'e568477b5592a994';
const PRE_P8_SHA256 = Object.freeze({
  'global-ranked.f0': '95432a499456f3c7e969744cf5b914621507d6d98a6d520a81c7c249e0889e8a',
  'global-ranked.f1': 'f81e276042b4954ab4f5a0a6ff3ef81cd91d38b0b514e3bb768b8ec62bb4eb2e',
  'global-no-inflections.f0': '3a666a4fdeef9c60b14807efcd4031b128d2b161e03caefb896046fc2ca05f5b',
  'global-no-inflections.f1': '9410c4bda0364233f1f1b3518a6bd6bc44ee3f9599830398dc6a7c0acaba8585',
});
test('profile option inflections: the four artefacts equal the pre-P8 builds (pinned sha256)', (t) => {
  const { lexiconVersion, profiles } = readIndexManifest();
  if (lexiconVersion !== PRE_P8_VERSION) {
    t.skip(`pin recorded for ${PRE_P8_VERSION}, data is now ${lexiconVersion}`);
    return;
  }
  const actual = {};
  for (const p of profiles) {
    const { bytes } = resolveIndexArtefact({ profileId: p.id, flags: p.flags });
    actual[`${p.id}.f${p.flags}`] = createHash('sha256').update(bytes).digest('hex');
    assert.equal(p.sha256, actual[`${p.id}.f${p.flags}`]);
  }
  assert.deepEqual(actual, PRE_P8_SHA256);
});

// 2. Option paths, with the current builder (holds for any data): `all` / the option-less reference give the
//    same bytes, and `none` gives the same bytes as a document with every inflection removed.
test('profile option inflections: option paths equal the option-less builder calls; `none` is canonical-only', () => {
  const lex = loadLexicon();
  const version = computeLexiconVersion(lex);
  const document = lexiconContentDocument(lex);
  const blocklist = [...lex.blocklist];
  const stripped = { terms: document.terms.map((t) => ({ ...t, inflections: [] })) };
  const legacy = (definition, doc, gaddag) => {
    const r = buildLexiconIndex(
      {
        version,
        profile: {
          id: definition.id,
          kind: definition.kind,
          definitionHash: profileDefinitionHash(definition),
        },
        document: doc,
        blocklist,
      },
      { formatVersion: 1, gaddag },
    );
    assert.equal(r.ok, true);
    return r.ok ? r.value : new Uint8Array();
  };
  for (const flags of [0, 1]) {
    const gaddag = flags === 1;
    const ranked = resolveIndexArtefact({ profileId: GLOBAL_PROFILE.id, flags });
    assert.deepEqual(
      new Uint8Array(ranked.bytes),
      legacy(GLOBAL_PROFILE, document, gaddag),
      `global-ranked f${flags}`,
    );
    const none = resolveIndexArtefact({ profileId: NO_INFLECTIONS_PROFILE.id, flags });
    assert.deepEqual(
      new Uint8Array(none.bytes),
      legacy(NO_INFLECTIONS_PROFILE, stripped, gaddag),
      `none f${flags}`,
    );
    assert.equal(none.entry.definitionHash, profileDefinitionHash(NO_INFLECTIONS_PROFILE));
    const index = decodeLexiconIndex(none.bytes, {
      version,
      profileId: NO_INFLECTIONS_PROFILE.id,
    });
    assert.equal(index.ok, true);
    if (index.ok) {
      assert.equal(index.value.size, index.value.termCount);
      for (let f = 0; f < index.value.size; f += 1) {
        assert.equal(index.value.formMeta(f).kind, 'canonical');
      }
    }
  }
});

test('rejects an unknown argument', () => {
  const r = run('--nope');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^build:index: usage: build-index\.mjs \[--data <dir>\]/);
});
