// scripts/indexes.mjs (`@codelex/lexicon/indexes`, sprint L6): the consumer side of build:index used by app copy
// steps. Fixtures are synthetic directories: every refusal is a typed IndexArtefactError, never a partial result.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  IndexArtefactError,
  readIndexManifest,
  resolveIndexArtefact,
} from '../scripts/indexes.mjs';

const VERSION = '0123456789abcdef';
const BYTES = Buffer.from('not really a clxi, the helper does not decode');

const entry = (over = {}) => ({
  id: 'global-ranked',
  kind: 'global',
  definitionHash: 'abc',
  formatVersion: 1,
  flags: 0,
  gaddag: false,
  file: 'global-ranked.f0.clxi',
  bytes: BYTES.length,
  sha256: createHash('sha256').update(BYTES).digest('hex'),
  ...over,
});

/** Writes a fixture layout; returns its root. `opts` overrides pieces to make it invalid. */
const fixture = (opts = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'clx-indexes-'));
  const dir = join(root, VERSION);
  mkdirSync(dir);
  const pointer =
    'pointer' in opts
      ? opts.pointer
      : { lexiconVersion: VERSION, manifest: `${VERSION}/manifest.json` };
  writeFileSync(
    join(root, 'current.json'),
    typeof pointer === 'string' ? pointer : JSON.stringify(pointer),
  );
  const manifest =
    'manifest' in opts ? opts.manifest : { lexiconVersion: VERSION, profiles: [entry()] };
  if (manifest !== null) writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  if (opts.bytes !== null) writeFileSync(join(dir, 'global-ranked.f0.clxi'), opts.bytes ?? BYTES);
  return root;
};

const withFixture = (opts, fn) => {
  const root = fixture(opts);
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const throwsCode = (fn, code) =>
  assert.throws(
    fn,
    (e) => e instanceof IndexArtefactError && e.code === code && e.message.startsWith(code),
  );

test('resolves an artefact whose size and sha256 match the manifest', () => {
  withFixture({}, (root) => {
    const r = resolveIndexArtefact({ profileId: 'global-ranked', flags: 0 }, root);
    assert.equal(r.lexiconVersion, VERSION);
    assert.equal(r.path, join(root, VERSION, 'global-ranked.f0.clxi'));
    assert.deepEqual(r.entry, entry());
    assert.deepEqual(r.bytes, BYTES);
    assert.equal(readIndexManifest(root).dir, join(root, VERSION));
  });
});

test('INDEX_NOT_BUILT: no current.json, or an artefact listed but absent', () => {
  const empty = mkdtempSync(join(tmpdir(), 'clx-indexes-'));
  try {
    throwsCode(() => readIndexManifest(empty), 'INDEX_NOT_BUILT');
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
  withFixture({ manifest: null }, (root) =>
    throwsCode(() => readIndexManifest(root), 'INDEX_NOT_BUILT'),
  );
  withFixture({ bytes: null }, (root) =>
    throwsCode(
      () => resolveIndexArtefact({ profileId: 'global-ranked', flags: 0 }, root),
      'INDEX_NOT_BUILT',
    ),
  );
});

test('INDEX_MANIFEST_INVALID: non-JSON, bad pointer, version mismatch, malformed entry', () => {
  const cases = [
    { pointer: '{ nope' },
    { pointer: null },
    { pointer: { lexiconVersion: VERSION, manifest: 'elsewhere.json' } },
    { pointer: { lexiconVersion: 'latest', manifest: 'latest/manifest.json' } },
    { manifest: { lexiconVersion: 'fedcba9876543210', profiles: [entry()] } },
    { manifest: { lexiconVersion: VERSION } },
    { manifest: { lexiconVersion: VERSION, profiles: [entry({ sha256: 'short' })] } },
    { manifest: { lexiconVersion: VERSION, profiles: [entry({ file: '../escape.clxi' })] } },
    { manifest: { lexiconVersion: VERSION, profiles: [entry({ flags: '0' })] } },
    { manifest: { lexiconVersion: VERSION, profiles: [null] } },
  ];
  for (const opts of cases) {
    withFixture(opts, (root) =>
      throwsCode(() => readIndexManifest(root), 'INDEX_MANIFEST_INVALID'),
    );
  }
});

test('INDEX_PROFILE_MISSING: unknown profile or flags variant', () => {
  withFixture({}, (root) => {
    throwsCode(
      () => resolveIndexArtefact({ profileId: 'global-ranked', flags: 1 }, root),
      'INDEX_PROFILE_MISSING',
    );
    throwsCode(
      () => resolveIndexArtefact({ profileId: 'season-1', flags: 0 }, root),
      'INDEX_PROFILE_MISSING',
    );
  });
});

test('INDEX_SHA_MISMATCH: same size different bytes, or truncated', () => {
  const flipped = Buffer.from(BYTES);
  flipped[0] ^= 1;
  for (const bytes of [flipped, BYTES.subarray(1)]) {
    withFixture({ bytes }, (root) =>
      throwsCode(
        () => resolveIndexArtefact({ profileId: 'global-ranked', flags: 0 }, root),
        'INDEX_SHA_MISMATCH',
      ),
    );
  }
});
