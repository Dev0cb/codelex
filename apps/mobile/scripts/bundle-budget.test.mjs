import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { checkBudget, measureExport } from './bundle-budget.mjs';

const budget = {
  $comment: 'ignored',
  android: { bundleBytes: 100, assetBytes: 10 },
  ios: { bundleBytes: 100, assetBytes: 10 },
};

test('passes within budget and reports every metric', () => {
  const sizes = {
    android: { bundleBytes: 100, assetBytes: 0 },
    ios: { bundleBytes: 50, assetBytes: 10 },
  };
  const { ok, lines } = checkBudget(sizes, budget);
  assert.equal(ok, true);
  assert.equal(lines.length, 4);
});

test('fails over budget, on a missing platform and on a missing limit', () => {
  assert.equal(
    checkBudget(
      { android: { bundleBytes: 101, assetBytes: 0 }, ios: { bundleBytes: 1, assetBytes: 1 } },
      budget,
    ).ok,
    false,
  );
  const missing = checkBudget({ android: { bundleBytes: 1, assetBytes: 1 } }, budget);
  assert.equal(missing.ok, false);
  assert.match(missing.lines.at(-1), /ios: not in the export/);
  const noLimit = checkBudget(
    { web: { bundleBytes: 1, assetBytes: 1 } },
    { web: { bundleBytes: 2 } },
  );
  assert.equal(noLimit.ok, false);
});

test('measures an export directory from metadata.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codelex-export-'));
  try {
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'a.hbc'), Buffer.alloc(7));
    writeFileSync(join(dir, 'assets', 'x'), Buffer.alloc(3));
    writeFileSync(join(dir, 'assets', 'y'), Buffer.alloc(2));
    writeFileSync(
      join(dir, 'metadata.json'),
      JSON.stringify({
        fileMetadata: {
          android: { bundle: 'a.hbc', assets: [{ path: 'assets/x' }, { path: 'assets/y' }] },
          ios: { bundle: 'a.hbc' },
        },
      }),
    );
    assert.deepEqual(measureExport(dir), {
      android: { bundleBytes: 7, assetBytes: 5 },
      ios: { bundleBytes: 7, assetBytes: 0 },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
