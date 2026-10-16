#!/usr/bin/env node
// Usage: node scripts/check-bundle-contents.mjs [exportDir=dist]. Run after `pnpm build` (expo export --source-maps);
// exits 1 when a package from bundle-forbidden-packages.json (security) or bundle-must-be-absent.json (size) is in an
// android or ios bundle, when preview-only code (bundle-preview-only.json: Diagnostics modules or markers, DG1) is in
// one (any file under `_expo/static/js/<platform>/`, maps included), when a map or bundle is missing, or when the
// production `expo config --json` carries the diagnostics extra or identifier (DG1, S-m1). Refuses to run with
// EXPO_PUBLIC_CODELEX_DIAGNOSTICS set: that export is not the production one.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkAbsent,
  checkContents,
  checkPreviewOnlyAbsent,
  checkProductionConfig,
  readExportBundles,
  readExportSources,
} from './bundle-contents.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const exportDir = join(appDir, process.argv[2] ?? 'dist');
const readJson = (name) => JSON.parse(readFileSync(join(appDir, name), 'utf8'));
const { packages } = readJson('bundle-forbidden-packages.json');
const absent = readJson('bundle-must-be-absent.json').packages;
const previewOnly = readJson('bundle-preview-only.json');

if (process.env.EXPO_PUBLIC_CODELEX_DIAGNOSTICS !== undefined) {
  console.log('FAIL EXPO_PUBLIC_CODELEX_DIAGNOSTICS is set: this is not a production export (DG1)');
  process.exitCode = 1;
} else {
  const sources = readExportSources(exportDir);
  // The production app config, evaluated as EAS would without the diagnostics variable or a profile.
  const env = { ...process.env };
  delete env.EAS_BUILD_PROFILE;
  const config = spawnSync('pnpm', ['exec', 'expo', 'config', '--json'], {
    cwd: appDir,
    env,
    encoding: 'utf8',
  });
  const results = [
    config.status === 0
      ? checkProductionConfig(config.stdout)
      : { ok: false, lines: ['FAIL expo config --json failed'] },
    checkContents(sources, packages, ['android', 'ios']),
    checkAbsent(sources, absent, ['android', 'ios']),
    checkPreviewOnlyAbsent(readExportBundles(exportDir), previewOnly, ['android', 'ios']),
  ];
  for (const line of results.flatMap((r) => r.lines)) console.log(line);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}
