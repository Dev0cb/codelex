import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codelex } from '../src/eslint/index.js';

/**
 * Integration tests: run the real ESLint API with the real preset on fixture files copied to a
 * scratch repo root (so boundary element paths are exactly `apps/*`, `services/*`, `packages/*`).
 * Every `bad-*` fixture must FAIL with the expected rule; `clean*` fixtures must PASS.
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixtureRepo = resolve(here, 'fixtures', 'repo');
const scratchParent = resolve(here, '..');

let root = '';
let eslint: ESLint;

beforeAll(() => {
  root = mkdtempSync(join(scratchParent, '.tmp-fixtures-'));
  cpSync(fixtureRepo, root, { recursive: true });
  // Simulate pnpm workspace linking: node_modules/@codelex/svc-b -> services/svc-b
  writeFileSync(
    join(root, 'services', 'svc-b', 'package.json'),
    JSON.stringify({
      name: '@codelex/svc-b',
      type: 'module',
      exports: { '.': './src/index.ts' },
    }),
  );
  mkdirSync(join(root, 'node_modules', '@codelex'), { recursive: true });
  symlinkSync(
    join(root, 'services', 'svc-b'),
    join(root, 'node_modules', '@codelex', 'svc-b'),
    'dir',
  );
  eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: codelex({ tsconfigRootDir: root, repoRoot: root }),
  });
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

async function ruleIds(file: string): Promise<string[]> {
  const [result] = await eslint.lintFiles([file]);
  if (!result) throw new Error(`no lint result for ${file}`);
  const fatal = result.messages.filter((m) => m.fatal);
  expect(fatal, JSON.stringify(fatal)).toEqual([]);
  return result.messages.map((m) => m.ruleId ?? 'parse-error');
}

describe('clean code passes', () => {
  it.each([
    'packages/clean/src/index.ts',
    'packages/clean/src/allowed-bang.test.ts',
    'packages/other/src/index.ts',
    'packages/lexicon/src/index.ts',
    'packages/game-engine/src/clean.ts',
    'services/svc-a/src/clean.ts',
    'services/svc-a/src/helper.ts',
    'apps/web/src/clean.ts',
  ])('%s has no problems', async (file) => {
    expect(await ruleIds(file)).toEqual([]);
  });
});

describe('boundaries (ENGINEERING §2)', () => {
  it('a service importing another service (relative path) FAILS', async () => {
    expect(await ruleIds('services/svc-a/src/bad-cross-service-relative.ts')).toContain(
      'boundaries/dependencies',
    );
  });

  it('a service importing another service through its workspace package name FAILS', async () => {
    expect(await ruleIds('services/svc-a/src/bad-cross-service-package.ts')).toContain(
      'boundaries/dependencies',
    );
  });

  it('an app importing a service FAILS', async () => {
    expect(await ruleIds('apps/web/src/bad-imports-service.ts')).toContain(
      'boundaries/dependencies',
    );
  });

  it('a package importing an app FAILS', async () => {
    expect(await ruleIds('packages/clean/src/bad-imports-app.ts')).toContain(
      'boundaries/dependencies',
    );
  });

  it('a package importing a service FAILS', async () => {
    expect(await ruleIds('packages/clean/src/bad-imports-service.ts')).toContain(
      'boundaries/dependencies',
    );
  });

  it('game-engine importing a package other than lexicon FAILS', async () => {
    expect(await ruleIds('packages/game-engine/src/bad-package-import.ts')).toContain(
      'boundaries/dependencies',
    );
  });
});

describe('game-engine determinism and purity (ENGINEERING §3)', () => {
  it('Math.random FAILS', async () => {
    expect(await ruleIds('packages/game-engine/src/bad-math-random.ts')).toContain(
      'no-restricted-properties',
    );
  });

  it('Date.now FAILS', async () => {
    expect(await ruleIds('packages/game-engine/src/bad-date-now.ts')).toContain(
      'no-restricted-properties',
    );
  });

  it('new Date() FAILS', async () => {
    expect(await ruleIds('packages/game-engine/src/bad-new-date.ts')).toContain(
      'no-restricted-syntax',
    );
  });

  it('crypto.randomUUID FAILS', async () => {
    expect(await ruleIds('packages/game-engine/src/bad-random-uuid.ts')).toContain(
      'no-restricted-properties',
    );
  });

  it('importing a Node built-in (IO) FAILS', async () => {
    expect(await ruleIds('packages/game-engine/src/bad-io-import.ts')).toContain(
      'no-restricted-imports',
    );
  });

  it('bots share the determinism bans', async () => {
    expect(await ruleIds('packages/bots/src/bad-math-random.ts')).toContain(
      'no-restricted-properties',
    );
  });

  it('the bans do not apply outside game-engine and bots', async () => {
    const lintOutside = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: codelex({ tsconfigRootDir: root, repoRoot: root }),
    });
    const [result] = await lintOutside.lintFiles(['packages/clean/src/index.ts']);
    expect(result?.messages.map((m) => m.ruleId)).not.toContain('no-restricted-properties');
  });
});

describe('type-aware rules (ENGINEERING §1)', () => {
  it('a floating promise FAILS', async () => {
    expect(await ruleIds('packages/clean/src/bad-floating-promise.ts')).toContain(
      '@typescript-eslint/no-floating-promises',
    );
  });

  it('any and non-null assertion FAIL', async () => {
    const ids = await ruleIds('packages/clean/src/bad-any-and-bang.ts');
    expect(ids).toContain('@typescript-eslint/no-explicit-any');
    expect(ids).toContain('@typescript-eslint/no-non-null-assertion');
  });
});
