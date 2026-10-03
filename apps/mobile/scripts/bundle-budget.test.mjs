import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkBudget, checkBundledLexicon, measureExport } from './bundle-budget.mjs';

const budget = {
  $comment: 'ignored',
  android: { bundleBytes: 100, assetBytes: 10, lexiconBytes: 50 },
  ios: { bundleBytes: 100, assetBytes: 10, lexiconBytes: 50 },
};
const sized = (bundleBytes, assetBytes, lexiconBytes) => ({
  bundleBytes,
  assetBytes,
  lexiconBytes,
  lexiconFiles: [],
});

test('passes within budget and reports every metric', () => {
  const sizes = { android: sized(100, 0, 50), ios: sized(50, 10, 0) };
  const { ok, lines } = checkBudget(sizes, budget);
  assert.equal(ok, true);
  assert.equal(lines.length, 6);
});

test('fails over budget, on a missing platform and on a missing limit', () => {
  assert.equal(checkBudget({ android: sized(101, 0, 0), ios: sized(1, 1, 1) }, budget).ok, false);
  const lexiconOver = checkBudget({ android: sized(1, 1, 51), ios: sized(1, 1, 1) }, budget);
  assert.equal(lexiconOver.ok, false);
  assert.match(lexiconOver.lines.join('\n'), /FAIL android\.lexiconBytes: 51 \/ 50 B/);
  const missing = checkBudget({ android: sized(1, 1, 1) }, budget);
  assert.equal(missing.ok, false);
  assert.match(missing.lines.at(-1), /ios: not in the export/);
  const noLimit = checkBudget({ web: sized(1, 1, 1) }, { web: { bundleBytes: 2, assetBytes: 2 } });
  assert.equal(noLimit.ok, false);
  assert.match(noLimit.lines.at(-1), /web\.lexiconBytes: no budget/);
});

test('every platform in bundle-budget.json has the three limits', () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'bundle-budget.json');
  const real = JSON.parse(readFileSync(file, 'utf8'));
  for (const [platform, limits] of Object.entries(real)) {
    if (platform.startsWith('$')) continue;
    for (const metric of ['bundleBytes', 'assetBytes', 'lexiconBytes']) {
      assert.equal(Number.isInteger(limits[metric]), true, `${platform}.${metric}`);
    }
  }
});

test('measures an export directory from metadata.json, lexicon index on its own line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codelex-export-'));
  try {
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'a.hbc'), Buffer.alloc(7));
    writeFileSync(join(dir, 'assets', 'x'), Buffer.alloc(3));
    writeFileSync(join(dir, 'assets', 'y'), Buffer.alloc(2));
    writeFileSync(join(dir, 'assets', 'lex'), Buffer.alloc(11));
    writeFileSync(
      join(dir, 'metadata.json'),
      JSON.stringify({
        fileMetadata: {
          android: {
            bundle: 'a.hbc',
            assets: [
              { path: 'assets/x', ext: 'png' },
              { path: 'assets/y', ext: 'ttf' },
              { path: 'assets/lex', ext: 'clxi' },
            ],
          },
          ios: { bundle: 'a.hbc' },
        },
      }),
    );
    assert.deepEqual(measureExport(dir), {
      android: { bundleBytes: 7, assetBytes: 5, lexiconBytes: 11, lexiconFiles: ['assets/lex'] },
      ios: { bundleBytes: 7, assetBytes: 0, lexiconBytes: 0, lexiconFiles: [] },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the bundled lexicon index must be exactly the descriptor artefact, once per platform', () => {
  const descriptor = { bytes: 11, sha256: 'a'.repeat(64) };
  const inspect = (path) =>
    path === 'assets/good'
      ? { bytes: 11, sha256: 'a'.repeat(64) }
      : { bytes: 11, sha256: 'b'.repeat(64) };
  const withFiles = (lexiconFiles) => ({ ...sized(1, 1, 11), lexiconFiles });

  const good = checkBundledLexicon(
    { android: withFiles(['assets/good']), ios: withFiles(['assets/good']) },
    descriptor,
    inspect,
    ['android', 'ios'],
  );
  assert.equal(good.ok, true);
  assert.equal(good.lines.length, 2);

  const wrong = checkBundledLexicon({ android: withFiles(['assets/other']) }, descriptor, inspect, [
    'android',
  ]);
  assert.equal(wrong.ok, false);
  assert.match(wrong.lines[0], /FAIL android: assets\/other .* descriptor says/);

  const none = checkBundledLexicon({ android: withFiles([]) }, descriptor, inspect, [
    'android',
    'ios',
  ]);
  assert.equal(none.ok, false);
  assert.match(none.lines[0], /android: 0 \.clxi assets/);
  assert.match(none.lines[1], /ios: 0 \.clxi assets/);

  const twice = checkBundledLexicon(
    { ios: withFiles(['assets/good', 'assets/good']) },
    descriptor,
    inspect,
    ['ios'],
  );
  assert.equal(twice.ok, false);
});
