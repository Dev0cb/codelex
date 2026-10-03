#!/usr/bin/env node
// Usage: node scripts/check-bundle-size.mjs [exportDir=dist]. Run after `pnpm build` (expo export); exits 1 when a
// platform exceeds bundle-budget.json or does not bundle exactly the lexicon index that assets/lexicon/lexicon.json
// names.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkBudget, checkBundledLexicon, measureExport } from './bundle-budget.mjs';
import { DESCRIPTOR_FILE } from './lexicon-asset.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const exportDir = join(appDir, process.argv[2] ?? 'dist');
const budget = JSON.parse(readFileSync(join(appDir, 'bundle-budget.json'), 'utf8'));
const descriptor = JSON.parse(
  readFileSync(join(appDir, 'assets', 'lexicon', DESCRIPTOR_FILE), 'utf8'),
);
const sizes = measureExport(exportDir);
const inspect = (rel) => {
  const bytes = readFileSync(join(exportDir, rel));
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
};
const results = [
  checkBudget(sizes, budget),
  checkBundledLexicon(sizes, descriptor, inspect, ['android', 'ios']),
];
for (const line of results.flatMap((r) => r.lines)) console.log(line);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
