#!/usr/bin/env node
/**
 * Writes the synthetic Stage 0 dry-run set to a directory: `node tools/readout/gen-dry-run.mjs <dir>`.
 * Then: `node tools/readout/cli.mjs --roster <dir>/roster.csv <dir>/*-export*.json`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { stage0Dataset } from "./fixtures.mjs";

const dir = process.argv[2];
if (dir === undefined) {
  console.error("usage: gen-dry-run.mjs <output-dir>");
  process.exit(2);
}
mkdirSync(dir, { recursive: true });
const { files, rosterCsv } = stage0Dataset();
for (const f of files) writeFileSync(join(dir, f.name), f.text);
writeFileSync(join(dir, "roster.csv"), rosterCsv);
console.log(`wrote ${files.length} export files and roster.csv to ${dir}`);
