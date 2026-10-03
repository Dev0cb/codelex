#!/usr/bin/env node
// Usage: node scripts/check-bundle-size.mjs [exportDir=dist]. Run after `pnpm build` (expo export); exits 1 when a
// platform exceeds bundle-budget.json.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkBudget, measureExport } from './bundle-budget.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const exportDir = join(appDir, process.argv[2] ?? 'dist');
const budget = JSON.parse(readFileSync(join(appDir, 'bundle-budget.json'), 'utf8'));
const { ok, lines } = checkBudget(measureExport(exportDir), budget);
for (const line of lines) console.log(line);
process.exitCode = ok ? 0 : 1;
