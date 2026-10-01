import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'tools/framework/validate.mjs');
const runOn = (root) => spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { ...process.env, CODELEX_ROOT: root } });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'codelex-fw-'));
  for (const p of ['CLAUDE.md', '.claude', 'docs', 'tools']) cpSync(join(ROOT, p), join(dir, p), { recursive: true });
  return dir;
}

test('the repository framework is valid', () => {
  const r = runOn(ROOT);
  assert.equal(r.status, 0, r.stderr);
});

test('detects an agent missing from the routing table and a bad model', () => {
  const dir = fixture();
  try {
    writeFileSync(join(dir, '.claude/agents/rogue-engineer.md'), `---\nname: rogue-engineer\ndescription: A test agent that is intentionally not referenced anywhere in CLAUDE.md.\ntools: Read\nmodel: gpt\n---\n${'x'.repeat(400)}\n`);
    const r = runOn(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /rogue-engineer.*not referenced/);
    assert.match(r.stderr, /unknown model "gpt"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detects references to unknown agents, skills and missing docs', () => {
  const dir = fixture();
  try {
    writeFileSync(join(dir, '.claude/skills/review/SKILL.md'), '---\nname: review\ndescription: Review skill rewritten for the test with dangling references inside.\n---\nAsk `ghost-engineer`, then run /nonexistent and read `docs/missing/FILE.md`.\n');
    const r = runOn(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown agent "ghost-engineer"/);
    assert.match(r.stderr, /unknown skill "\/nonexistent"/);
    assert.match(r.stderr, /missing path "docs\/missing\/FILE.md"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('keeps code-reviewer read-only', () => {
  const dir = fixture();
  try {
    const p = join(dir, '.claude/agents/code-reviewer.md');
    writeFileSync(p, readFileSync(p, 'utf8').replace('tools: Read, Grep, Glob, Bash', 'tools: Read, Grep, Glob, Bash, Edit'));
    const r = runOn(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /code-reviewer must be read-only/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

