#!/usr/bin/env node
// SessionStart: prints a compact orientation (branch, current sprint, open tasks) into the session context.
import { projectDir } from './lib.mjs';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = projectDir();
const sh = (c) => { try { return execSync(c, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const lines = ['## CODELEX session context'];
lines.push(`- Branch: ${sh('git rev-parse --abbrev-ref HEAD') || 'unknown'}`);
const last = sh('git log --oneline -5');
if (last) lines.push('- Recent commits:\n' + last.split('\n').map((l) => `  - ${l}`).join('\n'));
const sprintDir = join(root, 'docs/sprints');
const sprints = existsSync(sprintDir)
  ? readdirSync(sprintDir).filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f)).sort()
  : [];
const cur = sprints.at(-1);
if (cur) {
  const open = readFileSync(join(sprintDir, cur), 'utf8').split('\n').filter((l) => /^\|/.test(l) && /\b(todo|in[_ -]progress|blocked)\b/i.test(l));
  lines.push(`- Current sprint: docs/sprints/${cur} (${open.length} open tasks)`);
} else {
  lines.push('- No sprint yet: start with /sprint-plan (Phase 0 in docs/roadmap/ROADMAP.md).');
}
lines.push('- Workflow: /sprint-plan → /feature-spec → /design → /implement → /review → /ship. Routing table: CLAUDE.md §4.');
process.stdout.write(lines.join('\n') + '\n');
