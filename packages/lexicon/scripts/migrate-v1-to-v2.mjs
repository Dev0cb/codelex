#!/usr/bin/env node
// Term-file migration schema v1 -> v2 (docs/game/LEXICON_SPEC.md §8). v2 only adds the optional `inflections`
// field, so the migration bumps `schemaVersion` and changes nothing else: the playable form set and the
// lexiconVersion are unchanged (spec E-1.7 AC-2). Idempotent. Usage: node scripts/migrate-v1-to-v2.mjs [dataDir]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCHEMA_VERSION_RE = /("schemaVersion"\s*:\s*)(\d+)/;

/**
 * Returns the v2 text of a term file, preserving every other byte (formatting, key order, line endings).
 * @param {string} text raw JSON text of a v1 or v2 term file
 */
export function migrateTermFileText(text) {
  const data = JSON.parse(text);
  if (data?.schemaVersion === 2) return text;
  if (data?.schemaVersion !== 1) throw new Error(`cannot migrate schemaVersion ${JSON.stringify(data?.schemaVersion)}`);
  const out = text.replace(SCHEMA_VERSION_RE, (_match, prefix) => `${prefix}2`);
  const check = JSON.parse(out);
  if (check.schemaVersion !== 2) throw new Error('schemaVersion rewrite did not hit the top-level field');
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dataDir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const termsDir = join(dataDir, 'terms');
  let changed = 0;
  for (const f of readdirSync(termsDir).filter((x) => x.endsWith('.json')).sort()) {
    const p = join(termsDir, f);
    const before = readFileSync(p, 'utf8');
    const after = migrateTermFileText(before);
    if (after !== before) { writeFileSync(p, after); changed++; }
  }
  console.log(`Migrated ${changed} term file(s) to schemaVersion 2.`);
}
