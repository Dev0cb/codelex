#!/usr/bin/env node
// Usage: node scripts/check-bundle-diagnostics.mjs [productionDir=dist]. Positive control of the DG1 absence proof
// (diagnostics note §3.3, security condition SC-3): exports the android and ios bundles with
// EXPO_PUBLIC_CODELEX_DIAGNOSTICS=1 to dist-diagnostics/ (what the `preview-diagnostics` EAS profile bundles) and
// requires, on each platform, a diagnostics module, a golden-runner module and every marker of
// bundle-preview-only.json. Then prints the preview bundle delta against the production export (note §9: reported,
// not gated). Exits 1 if anything is missing.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkPreviewOnlyPresent, readExportBundles } from './bundle-contents.mjs';

const PLATFORMS = ['android', 'ios'];
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
    ...PLATFORMS.flatMap((platform) => ['--platform', platform]),
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
  console.log('FAIL the diagnostics export failed');
  process.exit(1);
}

const preview = readExportBundles(outDir);
const production = existsSync(join(productionDir, 'metadata.json'))
  ? readExportBundles(productionDir)
  : {};
let ok = true;
for (const platform of PLATFORMS) {
  const result = checkPreviewOnlyPresent(preview[platform], previewOnly, platform);
  for (const line of result.lines) console.log(line);
  ok &&= result.ok;
  const previewSize = preview[platform]?.bundleSize ?? null;
  const productionSize = production[platform]?.bundleSize ?? null;
  if (previewSize !== null && productionSize !== null) {
    console.log(
      `info ${platform}: preview-diagnostics bundle ${String(previewSize)} B, production ${String(productionSize)} B, delta +${String(previewSize - productionSize)} B`,
    );
  }
}
process.exitCode = ok ? 0 : 1;
