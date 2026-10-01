#!/usr/bin/env node
// PostToolUse(Edit|Write|MultiEdit): runs the relevant fast validator and feeds failures back to Claude.
import { readPayload, projectDir } from './lib.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const file = String(readPayload()?.tool_input?.file_path ?? '');
const root = projectDir();
const checks = [];
if (/\/packages\/lexicon\/(data|schema)\//.test(file)) checks.push(['lexicon', join(root, 'packages/lexicon/scripts/validate.mjs')]);
if (/\/\.claude\/(agents|skills|hooks|settings\.json)/.test(file)) checks.push(['framework', join(root, 'tools/framework/validate.mjs')]);

for (const [label, script] of checks) {
  if (!existsSync(script)) continue;
  const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) {
    process.stderr.write(`[codelex-validate] ${label} validation failed after editing ${file}:\n${r.stdout}${r.stderr}`);
    process.exit(2);
  }
}
process.exit(0);
