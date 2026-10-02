import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codelex } from '../src/eslint/index.js';

/**
 * Integration tests in the CONSUMER layout: a scratch monorepo (under os.tmpdir()) where every
 * app/service/package has its own `eslint.config.js` (`codelex({ tsconfigRootDir })`) and ESLint runs
 * with cwd = that package directory, exactly like `turbo run lint`. The preset is loaded from the
 * built `dist/` (turbo makes `test` depend on `build` for this package).
 * Every `bad-*` fixture must FAIL with the expected rule; every `clean*` fixture must PASS.
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixtureRepo = resolve(here, 'fixtures', 'repo');
const distEntry = resolve(here, '..', 'dist', 'eslint', 'index.js');

let root = '';
const instances = new Map<string, ESLint>();

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

beforeAll(() => {
  if (!existsSync(distEntry)) {
    throw new Error(`${distEntry} is missing: run \`pnpm --filter @codelex/config build\` first`);
  }
  root = mkdtempSync(join(tmpdir(), 'codelex-config-lint-'));
  cpSync(fixtureRepo, root, { recursive: true });
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - "apps/*"\n  - "services/*"\n  - "packages/*"\n',
  );

  // Simulate pnpm workspace linking: node_modules/@codelex/<name> -> <dir>
  const links: Record<string, { dir: string; exports: Record<string, string> }> = {
    'svc-b': { dir: 'services/svc-b', exports: { '.': './src/index.ts' } },
    lexicon: {
      dir: 'packages/lexicon',
      exports: { '.': './src/index.ts', './index': './src/index.ts' },
    },
    config: {
      dir: 'packages/config',
      exports: { './result': './src/result/index.ts', './eslint': './src/eslint/index.ts' },
    },
  };
  mkdirSync(join(root, 'node_modules', '@codelex'), { recursive: true });
  for (const [name, { dir, exports }] of Object.entries(links)) {
    writeJson(join(root, dir, 'package.json'), {
      name: `@codelex/${name}`,
      type: 'module',
      exports,
    });
    symlinkSync(join(root, dir), join(root, 'node_modules', '@codelex', name), 'dir');
  }

  for (const group of ['apps', 'services', 'packages']) {
    for (const name of readdirSync(join(root, group))) {
      const dir = join(root, group, name);
      writeJson(join(dir, 'tsconfig.json'), { extends: '../../tsconfig.json', include: ['src'] });
      writeFileSync(
        join(dir, 'eslint.config.js'),
        `import { codelex } from ${JSON.stringify(pathToFileURL(distEntry).href)};\n` +
          'export default codelex({ tsconfigRootDir: import.meta.dirname });\n',
      );
    }
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

type Mode = 'consumer layout (built dist, cwd = package dir)' | 'source preset (cwd = repo root)';
const MODES: Mode[] = [
  'consumer layout (built dist, cwd = package dir)',
  'source preset (cwd = repo root)',
];

function eslintFor(mode: Mode, pkgDir: string): ESLint {
  const key = `${mode}:${pkgDir}`;
  let eslint = instances.get(key);
  if (!eslint) {
    eslint =
      mode === 'source preset (cwd = repo root)'
        ? new ESLint({
            cwd: root,
            overrideConfigFile: true,
            overrideConfig: codelex({ tsconfigRootDir: root, repoRoot: root }),
          })
        : new ESLint({ cwd: pkgDir });
    instances.set(key, eslint);
  }
  return eslint;
}

/** Lints `<group>/<name>/<rest>`; consumer mode uses cwd = `<group>/<name>`, source mode cwd = root. */
async function ruleIdsIn(mode: Mode, file: string): Promise<string[]> {
  const [group, name, ...rest] = file.split('/');
  const pkgDir = join(root, group ?? '', name ?? '');
  const eslint = eslintFor(mode, pkgDir);
  const target = mode === 'source preset (cwd = repo root)' ? file : rest.join('/');
  const [result] = await eslint.lintFiles([target]);
  if (!result) throw new Error(`no lint result for ${file}`);
  const fatal = result.messages.filter((m) => m.fatal);
  expect(fatal, JSON.stringify(fatal)).toEqual([]);
  return result.messages.map((m) => m.ruleId ?? 'parse-error');
}

// The first lint of each ESLint instance builds a TypeScript program (~4 s on CI, more when turbo runs
// other packages' tests on the same cores): the default 5 s test timeout is too tight for it.
describe.each(MODES)('%s', { timeout: 30_000 }, (mode) => {
  const ruleIds = (file: string): Promise<string[]> => ruleIdsIn(mode, file);

  describe('clean code passes (consumer layout)', () => {
    it.each([
      'packages/clean/src/index.ts',
      'packages/clean/src/allowed-bang.test.ts',
      'packages/other/src/index.ts',
      'packages/lexicon/src/index.ts',
      'packages/game-engine/src/clean.ts',
      'packages/game-engine/src/clean-lexicon-and-result.ts',
      'packages/game-engine/src/clean-lexicon-index-subpath.ts',
      'packages/game-engine/src/clean-date-with-argument.ts',
      'packages/game-engine/src/clean-tooling.config.ts',
      'packages/game-engine/src/clean-tooling-import.test.ts',
      'services/svc-a/src/clean.ts',
      'services/svc-a/src/helper.ts',
      'services/svc-a/src/clean-game-engine.ts',
      'apps/web/src/clean.ts',
      'apps/web/src/clean-game-engine.ts',
    ])('%s has no problems', async (file) => {
      expect(await ruleIds(file)).toEqual([]);
    });
  });

  describe('boundaries (ENGINEERING §2)', () => {
    it.each([
      [
        'a service importing another service (relative)',
        'services/svc-a/src/bad-cross-service-relative.ts',
      ],
      [
        'a service importing another service by package name',
        'services/svc-a/src/bad-cross-service-package.ts',
      ],
      ['an app importing a service', 'apps/web/src/bad-imports-service.ts'],
      ['a package importing an app', 'packages/clean/src/bad-imports-app.ts'],
      ['a package importing a service', 'packages/clean/src/bad-imports-service.ts'],
      [
        'game-engine importing a package other than lexicon/config',
        'packages/game-engine/src/bad-package-import.ts',
      ],
    ])('%s FAILS', async (_name, file) => {
      expect(await ruleIds(file)).toContain('boundaries/dependencies');
    });

    it('an unresolvable @codelex/* import FAILS', async () => {
      expect(await ruleIds('packages/clean/src/bad-unresolved-codelex.ts')).toContain(
        'import-x/no-unresolved',
      );
    });
  });

  describe('game-engine determinism (ENGINEERING §3)', () => {
    it.each([
      ['Math.random', 'packages/game-engine/src/bad-math-random.ts', 'no-restricted-properties'],
      ['Date.now', 'packages/game-engine/src/bad-date-now.ts', 'no-restricted-properties'],
      ['new Date()', 'packages/game-engine/src/bad-new-date.ts', 'no-restricted-syntax'],
      [
        'crypto.randomUUID',
        'packages/game-engine/src/bad-random-uuid.ts',
        'no-restricted-properties',
      ],
      [
        'globalThis.Math.random()',
        'packages/game-engine/src/bad-globalthis-math.ts',
        'no-restricted-globals',
      ],
      [
        'new globalThis.Date()',
        'packages/game-engine/src/bad-globalthis-date.ts',
        'no-restricted-globals',
      ],
      [
        'const M = Math; M.random()',
        'packages/game-engine/src/bad-alias-math.ts',
        'no-restricted-syntax',
      ],
      [
        'const D = Date; D.now()',
        'packages/game-engine/src/bad-alias-date.ts',
        'no-restricted-syntax',
      ],
      ['new Date(...[])', 'packages/game-engine/src/bad-spread-date.ts', 'no-restricted-syntax'],
      [
        'Math.random in a game-engine test',
        'packages/game-engine/src/bad-math-random-in-test.test.ts',
        'no-restricted-properties',
      ],
      ['Math.random in bots', 'packages/bots/src/bad-math-random.ts', 'no-restricted-properties'],
    ])('%s FAILS', async (_name, file, rule) => {
      expect(await ruleIds(file)).toContain(rule);
    });
  });

  describe('game-engine purity (ENGINEERING §2)', () => {
    it.each([
      [
        'static import of a Node built-in',
        'packages/game-engine/src/bad-io-import.ts',
        'codelex/pure-imports',
      ],
      [
        'dynamic import of a Node built-in',
        'packages/game-engine/src/bad-dynamic-import.ts',
        'codelex/pure-imports',
      ],
      ['require() call', 'packages/game-engine/src/bad-require.ts', 'codelex/pure-imports'],
      [
        'unlisted IO package',
        'packages/game-engine/src/bad-unlisted-package.ts',
        'codelex/pure-imports',
      ],
      [
        '@codelex/config/eslint (only /result is allowed)',
        'packages/game-engine/src/bad-config-eslint-import.ts',
        'codelex/pure-imports',
      ],
      ['global fetch', 'packages/game-engine/src/bad-global-fetch.ts', 'no-restricted-globals'],
      ['global process', 'packages/game-engine/src/bad-global-process.ts', 'no-restricted-globals'],
      [
        'global setTimeout',
        'packages/game-engine/src/bad-global-settimeout.ts',
        'no-restricted-globals',
      ],
      [
        'global setInterval',
        'packages/game-engine/src/bad-global-setinterval.ts',
        'no-restricted-globals',
      ],
      [
        'global XMLHttpRequest',
        'packages/game-engine/src/bad-global-xhr.ts',
        'no-restricted-globals',
      ],
      [
        'global WebSocket',
        'packages/game-engine/src/bad-global-websocket.ts',
        'no-restricted-globals',
      ],
    ])('%s FAILS', async (_name, file, rule) => {
      expect(await ruleIds(file)).toContain(rule);
    });

    it('the bans do not apply outside game-engine and bots', async () => {
      const ids = await ruleIds('packages/clean/src/index.ts');
      expect(ids).not.toContain('no-restricted-properties');
      expect(ids).not.toContain('no-restricted-globals');
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
});
