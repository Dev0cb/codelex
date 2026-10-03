#!/usr/bin/env node
// Usage: node scripts/check-bundle-contents.mjs [exportDir=dist]. Run after `pnpm build` (expo export --source-maps);
// exits 1 when a package from bundle-forbidden-packages.json is in an android or ios bundle, or a map is missing.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkContents, readExportSources } from './bundle-contents.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const exportDir = join(appDir, process.argv[2] ?? 'dist');
const { packages } = JSON.parse(
  readFileSync(join(appDir, 'bundle-forbidden-packages.json'), 'utf8'),
);
const { ok, lines } = checkContents(readExportSources(exportDir), packages, ['android', 'ios']);
for (const line of lines) console.log(line);
process.exitCode = ok ? 0 : 1;
