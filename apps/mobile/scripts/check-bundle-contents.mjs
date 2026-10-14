#!/usr/bin/env node
// Usage: node scripts/check-bundle-contents.mjs [exportDir=dist]. Run after `pnpm build` (expo export --source-maps);
// exits 1 when a package from bundle-forbidden-packages.json (security) or bundle-must-be-absent.json (size) is in an
// android or ios bundle, or a map is missing.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkAbsent, checkContents, readExportSources } from './bundle-contents.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const exportDir = join(appDir, process.argv[2] ?? 'dist');
const { packages } = JSON.parse(
  readFileSync(join(appDir, 'bundle-forbidden-packages.json'), 'utf8'),
);
const absent = JSON.parse(
  readFileSync(join(appDir, 'bundle-must-be-absent.json'), 'utf8'),
).packages;
const sources = readExportSources(exportDir);
const results = [
  checkContents(sources, packages, ['android', 'ios']),
  checkAbsent(sources, absent, ['android', 'ios']),
];
for (const line of results.flatMap((r) => r.lines)) console.log(line);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
