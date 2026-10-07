import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'tools/framework/validate.mjs');
const runOn = (root) =>
  spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, CODELEX_ROOT: root },
  });

// Copy only what validate.mjs reads. Never copy .claude/worktrees (git-ignored agent worktrees that
// carry their own node_modules and can reach tens of GB), node_modules, .git or .turbo.
const SKIP = new Set(['node_modules', '.git', '.turbo', 'worktrees']);
const keep = (src) =>
  !relative(ROOT, src)
    .split(sep)
    .some((seg) => SKIP.has(seg));
const COPY = ['CLAUDE.md', '.claude/agents', '.claude/skills', '.claude/hooks', '.claude/settings.json', 'docs', 'tools'];

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'codelex-fw-'));
  try {
    for (const p of COPY) {
      if (existsSync(join(ROOT, p))) cpSync(join(ROOT, p), join(dir, p), { recursive: true, filter: keep });
    }
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

// The fixture is always removed, even when the body throws (e.g. a failed assertion).
function withFixture(fn) {
  const dir = makeFixture();
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the repository framework is valid', () => {
  const r = runOn(ROOT);
  assert.equal(r.status, 0, r.stderr);
});

test('fixture excludes worktrees and node_modules and stays small', () => {
  withFixture((dir) => {
    let bytes = 0;
    const bad = [];
    const walk = (d) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        const st = statSync(p);
        if (name === 'worktrees' || name === 'node_modules') bad.push(p);
        if (st.isDirectory()) walk(p);
        else bytes += st.size;
      }
    };
    walk(dir);
    assert.deepEqual(bad, []);
    assert.ok(bytes < 50 * 1024 * 1024, `fixture is ${bytes} bytes, expected < 50 MB`);
  });
});

test('fixture is removed even when the body throws', () => {
  let seen;
  assert.throws(
    () =>
      withFixture((dir) => {
        seen = dir;
        throw new Error('boom');
      }),
    /boom/,
  );
  assert.equal(existsSync(seen), false);
});

test('detects an agent missing from the routing table and a bad model', () => {
  withFixture((dir) => {
    writeFileSync(
      join(dir, '.claude/agents/rogue-engineer.md'),
      `---\nname: rogue-engineer\ndescription: A test agent that is intentionally not referenced anywhere in CLAUDE.md.\ntools: Read\nmodel: gpt\n---\n${'x'.repeat(400)}\n`,
    );
    const r = runOn(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /rogue-engineer.*not referenced/);
    assert.match(r.stderr, /unknown model "gpt"/);
  });
});

test('detects references to unknown agents, skills and missing docs', () => {
  withFixture((dir) => {
    writeFileSync(
      join(dir, '.claude/skills/review/SKILL.md'),
      '---\nname: review\ndescription: Review skill rewritten for the test with dangling references inside.\n---\nAsk `ghost-engineer`, then run /nonexistent and read `docs/missing/FILE.md`.\n',
    );
    const r = runOn(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown agent "ghost-engineer"/);
    assert.match(r.stderr, /unknown skill "\/nonexistent"/);
    assert.match(r.stderr, /missing path "docs\/missing\/FILE.md"/);
  });
});

test('keeps code-reviewer read-only', () => {
  withFixture((dir) => {
    const p = join(dir, '.claude/agents/code-reviewer.md');
    writeFileSync(p, readFileSync(p, 'utf8').replace('tools: Read, Grep, Glob, Bash', 'tools: Read, Grep, Glob, Bash, Edit'));
    const r = runOn(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /code-reviewer must be read-only/);
  });
});
