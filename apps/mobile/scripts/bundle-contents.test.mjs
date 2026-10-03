import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkContents, packagesInSources, readExportSources } from './bundle-contents.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(appDir, '..', '..');
const forbidden = [
  { name: 'node-forge', advisory: 'GHSA-86w9-cpqp-85rv' },
  { name: '@expo/code-signing-certificates', advisory: 'GHSA-86w9-cpqp-85rv' },
];

// Shapes taken from a real `expo export --source-maps` map (SDK 57, pnpm virtual store).
const CLEAN = [
  '/node_modules/.pnpm/@expo+cli@57.0.27_abc/node_modules/@expo/cli/build/metro-require/require.js',
  '/node_modules/.pnpm/query-string@7.1.3/node_modules/query-string/index.js',
  '/apps/mobile/src/app/index.tsx',
];
const TAINTED = [
  ...CLEAN,
  '/node_modules/.pnpm/node-forge@1.4.0/node_modules/node-forge/lib/rsa.js',
];

test('extracts package names, scoped included, skipping the .pnpm segment', () => {
  assert.deepEqual([...packagesInSources(TAINTED)].sort(), [
    '@expo/cli',
    'node-forge',
    'query-string',
  ]);
  assert.ok(
    packagesInSources(['C:\\x\\node_modules\\@expo\\code-signing-certificates\\a.js']).has(
      '@expo/code-signing-certificates',
    ),
  );
});

test('negative: passes when no forbidden package is bundled', () => {
  const { ok, lines } = checkContents({ android: CLEAN, ios: CLEAN }, forbidden, [
    'android',
    'ios',
  ]);
  assert.equal(ok, true);
  assert.equal(lines.length, 4);
});

test('positive: fails when a forbidden package is in one platform bundle', () => {
  const { ok, lines } = checkContents({ android: CLEAN, ios: TAINTED }, forbidden, [
    'android',
    'ios',
  ]);
  assert.equal(ok, false);
  assert.match(lines.join('\n'), /FAIL ios: node-forge is in the bundle; the GHSA-86w9-cpqp-85rv/);
});

test('fails closed on a missing map, a missing platform or an empty list', () => {
  assert.equal(
    checkContents({ android: CLEAN, ios: null }, forbidden, ['android', 'ios']).ok,
    false,
  );
  assert.equal(checkContents({ android: CLEAN }, forbidden, ['android', 'ios']).ok, false);
  assert.equal(checkContents({ android: CLEAN, ios: CLEAN }, [], ['android', 'ios']).ok, false);
});

test('reads the source map next to each bundle of an export directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codelex-export-'));
  try {
    mkdirSync(join(dir, 'js'));
    writeFileSync(join(dir, 'js', 'a.hbc'), '');
    writeFileSync(join(dir, 'js', 'a.hbc.map'), JSON.stringify({ version: 3, sources: TAINTED }));
    writeFileSync(join(dir, 'js', 'i.hbc'), '');
    writeFileSync(
      join(dir, 'metadata.json'),
      JSON.stringify({
        fileMetadata: { android: { bundle: 'js/a.hbc' }, ios: { bundle: 'js/i.hbc' } },
      }),
    );
    const sources = readExportSources(dir);
    assert.deepEqual(sources, { android: TAINTED, ios: null });
    assert.equal(checkContents(sources, forbidden, ['android', 'ios']).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the forbidden list matches the audit register and pnpm auditConfig (no drift)', () => {
  const { packages } = JSON.parse(
    readFileSync(join(appDir, 'bundle-forbidden-packages.json'), 'utf8'),
  );
  const register = readFileSync(join(repoRoot, 'docs/security/audit-exceptions.md'), 'utf8');
  const workspace = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  assert.ok(packages.length > 0);
  for (const { name, advisory, expires } of packages) {
    assert.match(advisory, /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    assert.ok(register.includes(advisory), `${advisory} missing from the register`);
    assert.ok(register.includes(`\`${name}\``), `${name} missing from the register`);
    assert.ok(
      register.includes(expires),
      `${advisory} expiry ${expires} differs from the register`,
    );
    assert.match(
      workspace,
      new RegExp(`^\\s+- ${advisory}\\s*$`, 'm'),
      `${advisory} not in ignoreGhsas`,
    );
  }
});
