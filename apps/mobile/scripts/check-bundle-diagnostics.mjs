#!/usr/bin/env node
// Usage: node scripts/check-bundle-diagnostics.mjs [productionDir=dist]. Positive control of the DG1 absence proof
// (diagnostics note §3.3, security condition SC-3): exports the android bundle with EXPO_PUBLIC_CODELEX_DIAGNOSTICS=1
// to dist-diagnostics/ (what the `preview-diagnostics` EAS profile bundles) and requires a diagnostics module, a
// golden-runner module and both markers of bundle-preview-only.json. Then prints the preview bundle delta against
// the production export (note §9: reported, not gated). Exits 1 if anything is missing.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkPreviewOnlyPresent, readExportBundles } from './bundle-contents.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const productionDir = join(appDir, process.argv[2] ?? 'dist');
const outDir = join(appDir, 'dist-diagnostics');
const previewOnly = JSON.parse(readFileSync(join(appDir, 'bundle-preview-only.json'), 'utf8'));

rmSync(outDir, { recursive: true, force: true });
const exported = spawnSync(
  'pnpm',
  [
    'exec',
    'expo',
    'export',
    '--platform',
    'android',
    '--source-maps',
    '--output-dir',
    'dist-diagnostics',
  ],
  {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, EXPO_PUBLIC_CODELEX_DIAGNOSTICS: '1' },
  },
);
if (exported.status !== 0) {
  console.log('FAIL android: the diagnostics export failed');
  process.exit(1);
}

const result = checkPreviewOnlyPresent(readExportBundles(outDir).android, previewOnly, 'android');
for (const line of result.lines) console.log(line);

const sizeOf = (dir) => {
  if (!existsSync(join(dir, 'metadata.json'))) return null;
  return readExportBundles(dir).android?.bytes?.length ?? null;
};
const preview = sizeOf(outDir);
const production = sizeOf(productionDir);
if (preview !== null && production !== null) {
  console.log(
    `info android: preview-diagnostics bundle ${String(preview)} B, production ${String(production)} B, delta +${String(preview - production)} B`,
  );
}
process.exitCode = result.ok ? 0 : 1;
