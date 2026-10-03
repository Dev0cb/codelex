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
import { computeLexiconVersion } from '../scripts/canonical.mjs';
import { INDEXES_DIR, readIndexManifest, resolveIndexArtefact } from '../scripts/indexes.mjs';
import { loadLexicon } from '../scripts/validate.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(PKG, 'scripts', 'build-index.mjs');
const { decodeLexiconIndex } = await import('../dist/index/index.js');

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

test('rejects an unknown argument', () => {
  const r = run('--nope');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^build:index: usage: build-index\.mjs \[--data <dir>\]/);
});
