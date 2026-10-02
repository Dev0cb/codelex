import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'tools/scaffold/scaffold.mjs');

function withRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'codelex-scaffold-'));
  try {
    cpSync(join(ROOT, 'CLAUDE.md'), join(dir, 'CLAUDE.md'));
    cpSync(join(ROOT, '.claude/agents'), join(dir, '.claude/agents'), { recursive: true });
    fn(dir, (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, CODELEX_ROOT: dir } }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('scaffolds a listed package with the owner and purpose from CLAUDE.md', () => {
  withRepo((dir, run) => {
    const r = run('packages/bots');
    assert.equal(r.status, 0, r.stderr);
    const pkgDir = join(dir, 'packages/bots');
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    assert.equal(pkg.name, '@codelex/bots');
    assert.equal(pkg.devDependencies['@codelex/config'], 'workspace:*');
    assert.equal(pkg.scripts.test, 'vitest run --coverage');
    assert.equal(pkg.dependencies, undefined);
    assert.match(readFileSync(join(pkgDir, 'README.md'), 'utf8'), /Owner: `ai-engineer`/);
    assert.match(readFileSync(join(pkgDir, 'vitest.config.ts'), 'utf8'), /basePreset/);
    assert.match(readFileSync(join(pkgDir, 'eslint.config.js'), 'utf8'), /@codelex\/config\/eslint/);
    for (const f of ['tsconfig.json', 'tsconfig.build.json', 'turbo.json', 'prettier.config.js', 'src/index.ts', 'src/version.test.ts']) {
      assert.ok(existsSync(join(pkgDir, f)), f);
    }
    assert.doesNotMatch(readFileSync(join(pkgDir, 'src/version.test.ts'), 'utf8'), /expect\(true\)/);
  });
});

test('forces the strict preset on game-engine and protocol', () => {
  withRepo((dir, run) => {
    assert.equal(run('packages/game-engine').status, 0);
    assert.match(readFileSync(join(dir, 'packages/game-engine/vitest.config.ts'), 'utf8'), /strictPreset/);
    const r = run('packages/protocol', '--preset', 'base');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /requires the strict preset/);
  });
});

test('services get the layered layout and the observability logger', () => {
  withRepo((dir, run) => {
    const r = run('services/game');
    assert.equal(r.status, 0, r.stderr);
    const svc = join(dir, 'services/game');
    const pkg = JSON.parse(readFileSync(join(svc, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies['@codelex/observability'], 'workspace:*');
    assert.ok(pkg.scripts.dev);
    assert.match(readFileSync(join(svc, 'src/app/logger.ts'), 'utf8'), /createLogger\(\{ service: 'game'/);
    assert.ok(existsSync(join(svc, 'src/domain/health.test.ts')));
  });
});

test('refuses unlisted targets unless --unlisted with an owner', () => {
  withRepo((_dir, run) => {
    let r = run('packages/probe');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not in the repository map/);
    r = run('packages/probe', '--unlisted');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--owner is required/);
    r = run('packages/probe', '--unlisted', '--owner', 'ghost-engineer');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown owner agent/);
    assert.equal(run('packages/probe', '--unlisted', '--owner', 'devops-sre').status, 0);
  });
});

test('rejects invalid targets, apps, unknown options and existing directories', () => {
  withRepo((dir, run) => {
    for (const [args, re] of [
      [['packages/Bad_Name'], /invalid target/],
      [['../escape'], /invalid target/],
      [['apps/mobile'], /apps are not supported yet/],
      [['packages/bots', '--force'], /unknown option/],
      [['packages/bots', '--preset', 'loose'], /invalid preset/],
      [[], /missing target/],
    ]) {
      const r = run(...args);
      assert.equal(r.status, 1, args.join(' '));
      assert.match(r.stderr, re);
    }
    mkdirSync(join(dir, 'packages/lexicon'), { recursive: true });
    const r = run('packages/lexicon');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /already exists/);
  });
});
