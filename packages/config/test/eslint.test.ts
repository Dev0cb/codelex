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
    'game-engine': {
      dir: 'packages/game-engine',
      exports: { '.': './src/clean.ts', './draft': './src/draft.ts' },
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
async function messagesIn(
  mode: Mode,
  file: string,
): Promise<{ ruleId: string; message: string }[]> {
  const [group, name, ...rest] = file.split('/');
  const pkgDir = join(root, group ?? '', name ?? '');
  const eslint = eslintFor(mode, pkgDir);
  const target = mode === 'source preset (cwd = repo root)' ? file : rest.join('/');
  const [result] = await eslint.lintFiles([target]);
  if (!result) throw new Error(`no lint result for ${file}`);
  const fatal = result.messages.filter((m) => m.fatal);
  expect(fatal, JSON.stringify(fatal)).toEqual([]);
  return result.messages.map((m) => ({ ruleId: m.ruleId ?? 'parse-error', message: m.message }));
}

async function ruleIdsIn(mode: Mode, file: string): Promise<string[]> {
  return (await messagesIn(mode, file)).map((m) => m.ruleId);
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
      'packages/game-engine/src/clean-integer-separators.ts',
      'packages/game-engine/src/clean-tooling.config.ts',
      'packages/game-engine/src/clean-tooling-import.test.ts',
      'packages/game-engine/src/clean-allowed-apis.ts',
      'packages/game-engine/src/clean-test-only-apis.test.ts',
      'packages/bots/src/clean-integer-bot.ts',
      'services/svc-a/src/clean.ts',
      'services/svc-a/src/helper.ts',
      'services/svc-a/src/clean-game-engine.ts',
      'apps/web/src/clean.ts',
      'apps/web/src/clean-game-engine.ts',
      'apps/web/src/clean-game-engine-root.ts',
      'packages/other/src/clean-draft-import.ts',
      'packages/game-engine/src/rules/registry.ts',
      'packages/game-engine/src/clean-version-lookup.ts',
      'packages/game-engine/src/clean-version-compare.test.ts',
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

  describe('ADR-0013 §D4 bans (engine and bots)', () => {
    const E = 'packages/game-engine/src/';
    const B = 'packages/bots/src/';
    const SYNTAX = 'no-restricted-syntax';
    const PROPS = 'no-restricted-properties';
    const GLOBALS = 'no-restricted-globals';
    const IMPORTS = 'no-restricted-imports';
    // [name, file, rule id, substring of the message]: the message proves the intended ban fired.
    it.each([
      ['BigInt literal', `${E}bad-bigint-literal.ts`, SYNTAX, 'BigInt literals'],
      ['BigInt() call', `${E}bad-bigint-call.ts`, GLOBALS, "'BigInt'"],
      ['bigint type', `${E}bad-bigint-type.ts`, SYNTAX, 'bigint is banned'],
      ['BigInt64Array', `${E}bad-bigint64array.ts`, GLOBALS, "'BigInt64Array'"],
      [
        'BigInt literal in a tooling config',
        `${E}bad-bigint-in-config.config.ts`,
        SYNTAX,
        'BigInt',
      ],
      [
        'JSON.stringify in a tooling config',
        `${E}bad-json-stringify-in-config.config.ts`,
        PROPS,
        'canonical',
      ],
      ['Intl.*', `${E}bad-intl.ts`, GLOBALS, "'Intl'"],
      ['localeCompare', `${E}bad-locale-compare.ts`, SYNTAX, 'Locale-dependent'],
      ['toLocaleString', `${E}bad-to-locale-string.ts`, SYNTAX, 'Locale-dependent'],
      ['toLocaleUpperCase', `${E}bad-to-locale-upper.ts`, SYNTAX, 'Locale-dependent'],
      [
        "x['toLocaleString']",
        `${E}bad-locale-computed-tolocalestring.ts`,
        SYNTAX,
        'Locale-dependent',
      ],
      ["'a'[`localeCompare`]", `${E}bad-locale-template-key.ts`, SYNTAX, 'Locale-dependent'],
      ['String.prototype.normalize', `${E}bad-normalize.ts`, SYNTAX, 'normalize'],
      ["s['normalize']()", `${E}bad-normalize-computed.ts`, SYNTAX, 'normalize'],
      [
        'sort() without comparator',
        `${E}bad-sort-no-comparator.ts`,
        SYNTAX,
        'without a comparator',
      ],
      [
        'toSorted() without comparator',
        `${E}bad-to-sorted-no-comparator.ts`,
        SYNTAX,
        'without a comparator',
      ],
      ["[3, 1]['sort']()", `${E}bad-sort-computed.ts`, SYNTAX, 'without a comparator'],
      ['[3, 1][`sort`]()', `${E}bad-sort-template-key.ts`, SYNTAX, 'without a comparator'],
      ['sort(undefined)', `${E}bad-sort-undefined.ts`, SYNTAX, 'sort(undefined)'],
      ['sort(void 0)', `${E}bad-sort-void.ts`, SYNTAX, 'sort(void 0)'],
      ['sort(...args)', `${E}bad-sort-spread.ts`, SYNTAX, 'sort(...args)'],
      ['[].sort.call(xs)', `${E}bad-sort-call.ts`, SYNTAX, 'Indirect call'],
      [
        'Reflect.apply(Array.prototype.sort, ...)',
        `${E}bad-reflect-apply.ts`,
        GLOBALS,
        "'Reflect'",
      ],
      ['TextEncoder', `${E}bad-text-encoder.ts`, GLOBALS, "'TextEncoder'"],
      ['TextDecoder', `${E}bad-text-decoder.ts`, GLOBALS, "'TextDecoder'"],
      ['Math.sqrt', `${E}bad-math-sqrt.ts`, PROPS, 'Math.sqrt'],
      ['Math.pow', `${E}bad-math-pow.ts`, PROPS, 'Math.pow'],
      ['Math.exp', `${E}bad-math-exp.ts`, PROPS, 'Math.exp'],
      ['Math.log', `${E}bad-math-log.ts`, PROPS, 'Math.log'],
      ['Math trigonometry', `${E}bad-math-trig.ts`, PROPS, 'Math.sin'],
      ['Math.PI', `${E}bad-math-pi.ts`, PROPS, 'Math.PI'],
      ['Number.EPSILON', `${E}bad-number-epsilon.ts`, PROPS, 'Floats are banned'],
      ['Number.parseFloat', `${E}bad-number-parsefloat.ts`, PROPS, 'Floats are banned'],
      ['global parseFloat', `${E}bad-parsefloat.ts`, GLOBALS, "'parseFloat'"],
      ['** on a non-literal operand', `${E}bad-exponent-operator.ts`, SYNTAX, 'integer literals'],
      ['**=', `${E}bad-exponent-assign.ts`, SYNTAX, '`**=`'],
      ['fractional literal 0.5', `${E}bad-fractional-literal.ts`, SYNTAX, 'Fractional'],
      ['fractional literal .6', `${E}bad-fractional-literal-leading-dot.ts`, SYNTAX, 'Fractional'],
      ['fractional literal 1e-3', `${E}bad-negative-exponent-literal.ts`, SYNTAX, 'Fractional'],
      [
        'fractional literal 1_000.5',
        `${E}bad-fractional-literal-separator.ts`,
        SYNTAX,
        'Fractional',
      ],
      ['fractional literal 1_0e-3', `${E}bad-negative-exponent-separator.ts`, SYNTAX, 'Fractional'],
      ['async function', `${E}bad-async-function.ts`, SYNTAX, 'async functions'],
      ['await', `${E}bad-await.ts`, SYNTAX, 'await is banned'],
      ['for await', `${E}bad-for-await.ts`, SYNTAX, 'await is banned'],
      ['import()', `${E}bad-dynamic-import-literal.ts`, SYNTAX, 'Dynamic import()'],
      ['Promise', `${E}bad-promise.ts`, GLOBALS, "'Promise'"],
      ['JSON.stringify', `${E}bad-json-stringify.ts`, PROPS, 'canonical'],
      ['new Date(0).getHours()', `${E}bad-date-getter.ts`, GLOBALS, "'Date'"],
      ['Date.parse', `${E}bad-date-parse.ts`, GLOBALS, "'Date'"],
      ['Date.UTC', `${E}bad-date-utc.ts`, GLOBALS, "'Date'"],
      ['performance.timeOrigin', `${E}bad-performance-timeorigin.ts`, GLOBALS, "'performance'"],
      ['crypto.subtle', `${E}bad-crypto-subtle.ts`, GLOBALS, "'crypto'"],
      ["import from 'node:crypto'", `${E}bad-import-node-crypto.ts`, IMPORTS, 'node:crypto'],
      ['process.hrtime()', `${E}bad-process-hrtime.ts`, GLOBALS, "'process'"],
      ['queueMicrotask', `${E}bad-queue-microtask.ts`, GLOBALS, "'queueMicrotask'"],
      ['WeakRef', `${E}bad-weakref.ts`, GLOBALS, "'WeakRef'"],
      [
        'localeCompare in a game-engine test',
        `${E}bad-locale-compare-in-test.test.ts`,
        SYNTAX,
        'Locale-dependent',
      ],
      [
        'sort() without comparator in a game-engine test',
        `${E}bad-sort-no-comparator-in-test.test.ts`,
        SYNTAX,
        'without a comparator',
      ],
      ['Intl in bots', `${B}bad-intl.ts`, GLOBALS, "'Intl'"],
      [
        'sort() without comparator in bots',
        `${B}bad-sort-no-comparator.ts`,
        SYNTAX,
        'without a comparator',
      ],
      ['localeCompare in bots', `${B}bad-locale-compare.ts`, SYNTAX, 'Locale-dependent'],
      ['Math.sqrt in bots', `${B}bad-math-sqrt.ts`, PROPS, 'Math.sqrt'],
      ['fractional literal in bots', `${B}bad-fractional-literal.ts`, SYNTAX, 'Fractional'],
      ['BigInt literal in bots', `${B}bad-bigint-literal.ts`, SYNTAX, 'BigInt literals'],
      ['async function in bots', `${B}bad-async-function.ts`, SYNTAX, 'async functions'],
      [
        "import from 'node:crypto' in bots",
        `${B}bad-import-node-crypto.ts`,
        IMPORTS,
        'node:crypto',
      ],
      ['process.hrtime() in bots', `${B}bad-process-hrtime.ts`, GLOBALS, "'process'"],
      ['setTimeout in bots', `${B}bad-set-timeout.ts`, GLOBALS, "'setTimeout'"],
      ['queueMicrotask in bots', `${B}bad-queue-microtask.ts`, GLOBALS, "'queueMicrotask'"],
      ['Date getter in bots', `${B}bad-date-getter.ts`, GLOBALS, "'Date'"],
      [
        'performance.timeOrigin in bots',
        `${B}bad-performance-now-timeorigin.ts`,
        GLOBALS,
        "'performance'",
      ],
    ])('%s FAILS', async (_name, file, rule, text) => {
      const messages = await messagesIn(mode, file);
      expect(
        messages.some((m) => m.ruleId === rule && m.message.includes(text)),
        JSON.stringify(messages),
      ).toBe(true);
    });
  });

  describe('ADR-0014 rules versions (engine) and draft entry (apps, services)', () => {
    const E = 'packages/game-engine/src/';
    it.each([
      [
        'x.engineRulesVersion === 1',
        `${E}bad-version-literal.ts`,
        'no-restricted-syntax',
        'ADR-0014',
      ],
      [
        '2 !== x.engineRulesVersion',
        `${E}bad-version-literal-left.ts`,
        'no-restricted-syntax',
        'ADR-0014',
      ],
      [
        '(x.engineRulesVersion as number) >= 2',
        `${E}bad-version-cast.ts`,
        'no-restricted-syntax',
        'ADR-0014',
      ],
      [
        "x['engineRulesVersion'] !== 2",
        `${E}bad-version-computed.ts`,
        'no-restricted-syntax',
        'ADR-0014',
      ],
      [
        'x.engineRulesVersion !== ENGINE_RULES_VERSION',
        `${E}bad-version-legacy.ts`,
        'no-restricted-syntax',
        'ADR-0014',
      ],
      [
        'switch (x.engineRulesVersion)',
        `${E}bad-version-switch.ts`,
        'no-restricted-syntax',
        'ADR-0014',
      ],
      [
        'shipped bans still apply next to the version ban',
        `${E}bad-version-and-fraction.ts`,
        'no-restricted-syntax',
        'Fractional',
      ],
      [
        'draft entry imported by an app',
        'apps/web/src/bad-draft-import.ts',
        'no-restricted-imports',
        'ADR-0014 §D4',
      ],
      [
        'draft entry re-exported by an app',
        'apps/web/src/bad-draft-reexport.ts',
        'no-restricted-imports',
        'ADR-0014 §D4',
      ],
      [
        'draft entry imported by a service',
        'services/svc-a/src/bad-draft-import.ts',
        'no-restricted-imports',
        'ADR-0014 §D4',
      ],
    ])('%s FAILS', async (_name, file, rule, text) => {
      const messages = await messagesIn(mode, file);
      expect(
        messages.some((m) => m.ruleId === rule && m.message.includes(text)),
        JSON.stringify(messages),
      ).toBe(true);
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
