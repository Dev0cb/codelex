// scripts/build-index.mjs (lexicon-index note §3.1, §3.4): refusals are one-line messages with exit code 1 and
// no stack trace; a successful build writes artefacts that decode as the manifest says. Runs the compiled dist/
// builder, like the script itself (`pnpm test` runs after `build`, turbo dependsOn).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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

test('builds the real data: every artefact decodes with the version and profile of its manifest', () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const outDir = /→ (.+)$/m.exec(r.stdout)?.[1];
  assert.ok(outDir);
  const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
  assert.ok(manifest.profiles.length > 0);
  for (const profile of manifest.profiles) {
    const bytes = readFileSync(join(outDir, profile.file));
    assert.equal(bytes.length, profile.bytes);
    const decoded = decodeLexiconIndex(bytes, {
      version: manifest.lexiconVersion,
      profileId: profile.id,
    });
    assert.equal(decoded.ok, true);
  }
});

test('rejects an unknown argument', () => {
  const r = run('--nope');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^build:index: usage: build-index\.mjs \[--data <dir>\]/);
});
