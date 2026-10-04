import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { resolveIndexArtefact } from '@codelex/lexicon/indexes';

import {
  ASSET_FILE,
  BUNDLED_FLAGS,
  BUNDLED_PROFILE_ID,
  DESCRIPTOR_FILE,
  lexiconByteLimit,
  prepareLexiconAsset,
} from './lexicon-asset.mjs';

const VERSION = '0123456789abcdef';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A build:index output with one profile in both flags variants (the resolver checks bytes, not the format). */
function fixture(root, { f1 = Buffer.from('CLXI-with-gaddag'), tamper = false } = {}) {
  const indexes = join(root, 'indexes');
  mkdirSync(join(indexes, VERSION), { recursive: true });
  const f0 = Buffer.from('CLXI-no-gaddag');
  const entry = (flags, bytes) => ({
    id: BUNDLED_PROFILE_ID,
    kind: 'global',
    definitionHash: 'da1f36a3747e0dfe',
    formatVersion: 1,
    flags,
    gaddag: flags === 1,
    file: `${BUNDLED_PROFILE_ID}.f${flags}.clxi`,
    bytes: bytes.length,
    sha256: sha(bytes),
  });
  writeFileSync(
    join(indexes, 'current.json'),
    JSON.stringify({ lexiconVersion: VERSION, manifest: `${VERSION}/manifest.json` }),
  );
  writeFileSync(
    join(indexes, VERSION, 'manifest.json'),
    JSON.stringify({ lexiconVersion: VERSION, profiles: [entry(1, f1), entry(0, f0)] }),
  );
  const onDisk = Buffer.from(f1);
  if (tamper) onDisk[0] ^= 0xff;
  writeFileSync(join(indexes, VERSION, `${BUNDLED_PROFILE_ID}.f1.clxi`), onDisk);
  writeFileSync(join(indexes, VERSION, `${BUNDLED_PROFILE_ID}.f0.clxi`), f0);
  return { indexes, f1 };
}

function withTmp(run) {
  const root = mkdtempSync(join(tmpdir(), 'codelex-lexicon-asset-'));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('bundles the GADDAG variant (f1) of global-ranked by default', () => {
  assert.equal(BUNDLED_PROFILE_ID, 'global-ranked');
  assert.equal(BUNDLED_FLAGS, 1);
});

test('copies the resolved bytes and writes the descriptor', () => {
  withTmp((root) => {
    const { indexes, f1 } = fixture(root);
    const outDir = join(root, 'out');
    const descriptor = prepareLexiconAsset({
      resolve: (which) => resolveIndexArtefact(which, indexes),
      outDir,
      maxBytes: 1000,
    });
    const expected = {
      lexiconVersion: VERSION,
      profileId: BUNDLED_PROFILE_ID,
      flags: 1,
      sha256: sha(f1),
      bytes: f1.length,
    };
    assert.deepEqual(descriptor, expected);
    assert.deepEqual(readFileSync(join(outDir, ASSET_FILE)), f1);
    assert.deepEqual(JSON.parse(readFileSync(join(outDir, DESCRIPTOR_FILE), 'utf8')), expected);
  });
});

test('selects the requested flags variant explicitly', () => {
  withTmp((root) => {
    const { indexes } = fixture(root);
    const descriptor = prepareLexiconAsset({
      resolve: (which) => resolveIndexArtefact(which, indexes),
      outDir: join(root, 'out'),
      maxBytes: 1000,
      flags: 0,
    });
    assert.equal(descriptor.flags, 0);
    assert.equal(descriptor.sha256, sha(Buffer.from('CLXI-no-gaddag')));
  });
});

test('refuses an artefact that differs from its manifest and writes nothing', () => {
  withTmp((root) => {
    const { indexes } = fixture(root, { tamper: true });
    const outDir = join(root, 'out');
    assert.throws(
      () =>
        prepareLexiconAsset({
          resolve: (which) => resolveIndexArtefact(which, indexes),
          outDir,
          maxBytes: 1000,
        }),
      { code: 'INDEX_SHA_MISMATCH' },
    );
    assert.equal(existsSync(outDir), false);
  });
});

test('refuses a missing build and a missing profile', () => {
  withTmp((root) => {
    assert.throws(
      () =>
        prepareLexiconAsset({
          resolve: (which) => resolveIndexArtefact(which, join(root, 'none')),
          outDir: join(root, 'out'),
          maxBytes: 1000,
        }),
      { code: 'INDEX_NOT_BUILT' },
    );
    const { indexes } = fixture(root);
    assert.throws(
      () =>
        prepareLexiconAsset({
          resolve: (which) => resolveIndexArtefact(which, indexes),
          outDir: join(root, 'out'),
          maxBytes: 1000,
          profileId: 'season-1',
        }),
      { code: 'INDEX_PROFILE_MISSING' },
    );
  });
});

test('refuses an artefact over the lexiconBytes budget (size gate) and writes nothing', () => {
  withTmp((root) => {
    const { indexes, f1 } = fixture(root);
    const outDir = join(root, 'out');
    assert.throws(
      () =>
        prepareLexiconAsset({
          resolve: (which) => resolveIndexArtefact(which, indexes),
          outDir,
          maxBytes: f1.length - 1,
        }),
      /over the \d+ B lexiconBytes budget/,
    );
    assert.equal(existsSync(outDir), false);
  });
});

test('refuses a resolver answer for another profile or flags', () => {
  withTmp((root) => {
    const bytes = new Uint8Array([1, 2, 3]);
    assert.throws(
      () =>
        prepareLexiconAsset({
          resolve: () => ({
            lexiconVersion: VERSION,
            entry: { id: BUNDLED_PROFILE_ID, flags: 0, sha256: sha(bytes), bytes: 3 },
            bytes,
          }),
          outDir: join(root, 'out'),
          maxBytes: 1000,
        }),
      /resolver returned global-ranked f0 for global-ranked f1/,
    );
  });
});

test('lexiconByteLimit takes the smallest platform limit and requires one per platform', () => {
  assert.equal(
    lexiconByteLimit({
      $comment: 'x',
      android: { lexiconBytes: 10 },
      ios: { lexiconBytes: 7 },
    }),
    7,
  );
  assert.throws(() => lexiconByteLimit({ android: { lexiconBytes: 10 }, ios: {} }), /lexiconBytes/);
  assert.throws(() => lexiconByteLimit({ $comment: 'x' }), /lexiconBytes/);
});
