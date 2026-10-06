#!/usr/bin/env node
// Writes tokens/*.json (DTCG board tokens for web) from the TypeScript tokens: `pnpm --filter @codelex/design-system
// tokens:write`. Reads the built package: run `build` first. The test `tokens-json.test.ts` fails on any drift.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { boardTokenFiles, serializeTokenFile } from '../dist/index.js';

const dir = fileURLToPath(new URL('../tokens/', import.meta.url));
mkdirSync(dir, { recursive: true });
const files = boardTokenFiles();
for (const name of readdirSync(dir)) {
  if (!Object.hasOwn(files, name)) rmSync(`${dir}${name}`);
}
for (const [name, document] of Object.entries(files)) {
  writeFileSync(`${dir}${name}`, serializeTokenFile(document));
  console.log(`wrote tokens/${name}`);
}
