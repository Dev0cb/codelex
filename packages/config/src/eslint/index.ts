import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import boundaries from 'eslint-plugin-boundaries';
import prettierConfig from 'eslint-config-prettier';
import { importX } from 'eslint-plugin-import-x';
import { defineConfig } from 'eslint/config';
import type { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { pureImportsRule } from './pure-imports.js';

export interface CodelexEslintOptions {
  /** Directory holding the package tsconfig.json (pass `import.meta.dirname`). */
  readonly tsconfigRootDir: string;
  /**
   * Repository root, used to classify files as apps/services/packages. Defaults to the nearest
   * ancestor of `tsconfigRootDir` containing `pnpm-workspace.yaml`.
   */
  readonly repoRoot?: string;
}

export function findRepoRoot(from: string): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`pnpm-workspace.yaml not found above ${from}; pass { repoRoot } explicitly`);
    }
    dir = parent;
  }
}

const require = createRequire(import.meta.url);

const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];
const JS_FILES = ['**/*.{js,mjs,cjs}'];
const TEST_FILES = ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}'];
const TOOLING_FILES = ['**/*.config.{js,mjs,cjs,ts,mts}'];
const DETERMINISTIC_FILES = ['packages/game-engine/**', 'packages/bots/**'];
const PURE_FILES = ['packages/game-engine/**'];
// Purity guards shipped code: tests and tooling configs may import test libraries and @codelex/config.
// Determinism still applies to them (seeded tests only).
const PURE_EXEMPT_FILES = [...TEST_FILES, ...TOOLING_FILES];

/** Generic TypeScript package rules: typescript-eslint strictTypeChecked + import hygiene. */
export function genericPreset(options: CodelexEslintOptions): Linter.Config[] {
  return defineConfig(
    {
      ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/.tmp-*/**'],
    },
    {
      files: TS_FILES,
      extends: [tseslint.configs.strictTypeChecked],
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir: options.tsconfigRootDir,
        },
      },
      plugins: { 'import-x': importX },
      rules: {
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
        'import-x/no-cycle': 'error',
        'import-x/no-default-export': 'error',
        // A missing/unbuilt workspace package must fail loudly, not bypass the boundaries rule.
        'import-x/no-unresolved': ['error', { ignore: ['^(?!@codelex/)'] }],
      },
    },
    {
      // Plain JS (config files): no type information available.
      files: JS_FILES,
      extends: [tseslint.configs.disableTypeChecked],
    },
    {
      // Tooling (eslint/prettier/vitest/next configs) requires default exports.
      files: TOOLING_FILES,
      rules: { 'import-x/no-default-export': 'off' },
    },
    {
      // ENGINEERING §1: `!` is only allowed in tests.
      files: TEST_FILES,
      rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
    },
  );
}

/**
 * Architecture boundaries (ENGINEERING §2). Paths are relative to the repository root (ESLint cwd):
 * apps -> packages; services -> packages and themselves; game-engine -> lexicon, config; packages -> packages.
 * Nothing imports apps; services never import other services.
 */
export function boundariesPreset(options: CodelexEslintOptions): Linter.Config[] {
  return defineConfig({
    files: [...TS_FILES, ...JS_FILES],
    plugins: { boundaries: boundaries as unknown as ESLint.Plugin },
    settings: {
      'boundaries/root-path': options.repoRoot ?? findRepoRoot(options.tsconfigRootDir),
      'import/resolver': {
        // Absolute path: the resolver must be found even when the linted repo has no node_modules.
        [require.resolve('eslint-import-resolver-typescript')]: { alwaysTryTypes: true },
      },
      'boundaries/elements': [
        {
          type: 'game-engine',
          pattern: 'packages/game-engine',
        },
        {
          type: 'package',
          pattern: 'packages/*',
          capture: ['name'],
        },
        {
          type: 'service',
          pattern: 'services/*',
          capture: ['name'],
        },
        { type: 'app', pattern: 'apps/*', capture: ['name'] },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'app' } },
              allow: { to: { element: { type: ['package', 'game-engine'] } } },
            },
            {
              from: { element: { type: 'app' } },
              allow: {
                to: {
                  element: {
                    type: 'app',
                    captured: { name: '{{ from.captured.name }}' },
                  },
                },
              },
            },
            {
              from: { element: { type: 'service' } },
              allow: { to: { element: { type: ['package', 'game-engine'] } } },
            },
            {
              from: { element: { type: 'service' } },
              allow: {
                to: {
                  element: {
                    type: 'service',
                    captured: { name: '{{ from.captured.name }}' },
                  },
                },
              },
            },
            {
              from: { element: { type: 'game-engine' } },
              allow: { to: { element: { type: 'game-engine' } } },
            },
            {
              from: { element: { type: 'game-engine' } },
              allow: {
                to: {
                  element: {
                    type: 'package',
                    captured: { name: ['lexicon', 'config'] },
                  },
                },
              },
            },
            {
              from: { element: { type: 'package' } },
              allow: { to: { element: { type: ['package', 'game-engine'] } } },
            },
          ],
        },
      ],
    },
  });
}

const GLOBAL_OBJECTS = ['globalThis', 'global', 'self', 'window'].map((name) => ({
  name,
  message:
    'Reaching globals indirectly hides non-determinism and IO: import what you need (ENGINEERING §3).',
}));

const IO_GLOBALS = [
  'fetch',
  'process',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'clearTimeout',
  'clearInterval',
  'clearImmediate',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'Buffer',
].map((name) => ({
  name,
  message: 'game-engine must be pure: no IO, timers or environment access (ENGINEERING §2, §3).',
}));

/** Allow-list of module specifiers (besides relative imports) for game-engine. */
const GAME_ENGINE_ALLOWED_IMPORTS = ['^@codelex/lexicon(/.*)?$', '^@codelex/config/result$'];

/** ADR-0013 §D4.2: banned globals in every deterministic file (shipped code and tests). */
const DETERMINISM_GLOBALS = [
  ['Intl', 'Intl is locale- and ICU-dependent (ADR-0013 §D4.2): compare by code unit.'],
  [
    'TextEncoder',
    'TextEncoder is not available on every runtime (Hermes): encode ASCII by hand (ADR-0013 §D3, §D4.2).',
  ],
  ['TextDecoder', 'TextDecoder is not available on every runtime (Hermes): ADR-0013 §D3, §D4.2.'],
  ['Promise', 'Async code is banned in the engine and bots (ADR-0013 §D4.2): stay synchronous.'],
].map(([name, message]) => ({ name: name ?? '', message }));

/** ADR-0013 §D4.2: `BigInt` is banned "outside tests"; these apply to shipped code only. */
const BIGINT_GLOBALS = ['BigInt', 'BigInt64Array', 'BigUint64Array'].map((name) => ({
  name,
  message: 'BigInt is banned outside tests (ADR-0013 §D4.2): use safe integers (< 2^53).',
}));

/** Transcendental / float-producing Math members (ADR-0013 §D4.1-2); `Math.floor`, `imul`, ... stay allowed. */
const BANNED_MATH_FUNCTIONS = [
  'pow',
  'sqrt',
  'cbrt',
  'hypot',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'fround',
];
const BANNED_MATH_CONSTANTS = ['PI', 'E', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT2', 'SQRT1_2'];

const FLOAT_PROPERTIES = [
  ...BANNED_MATH_FUNCTIONS.map((property) => ({
    object: 'Math',
    property,
    message: `Math.${property} is float-producing / implementation-defined (ADR-0013 §D4.2): use integer arithmetic.`,
  })),
  ...BANNED_MATH_CONSTANTS.map((property) => ({
    object: 'Math',
    property,
    message: `Math.${property} is a float constant (ADR-0013 §D4.1): integers only.`,
  })),
  {
    object: 'Number',
    property: 'EPSILON',
    message: 'Floats are banned (ADR-0013 §D4.1): integers only.',
  },
  {
    object: 'Number',
    property: 'parseFloat',
    message: 'Floats are banned (ADR-0013 §D4.1): parse integers explicitly.',
  },
];

/** Shipped code only (tests may use JSON.stringify to compare). ADR-0013 §D4.2: use the canonical serialiser. */
const SHIPPED_PROPERTIES = [
  {
    object: 'JSON',
    property: 'stringify',
    message:
      'JSON.stringify key order and number format are not canonical (ADR-0013 §D3, §D4.2): use the canonical serialiser.',
  },
];

const NON_DETERMINISTIC_OBJECTS = '(Math|crypto|performance)';

const DETERMINISM_SELECTORS = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'new Date() reads the wall clock: inject a Clock (ENGINEERING §3).',
  },
  {
    selector: "NewExpression[callee.name='Date'] > SpreadElement",
    message: 'new Date(...args) may read the wall clock: pass explicit arguments (ENGINEERING §3).',
  },
  {
    selector: "CallExpression[callee.name='Date']",
    message: 'Date() reads the wall clock: inject a Clock (ENGINEERING §3).',
  },
  {
    // `const D = Date; D.now()`, `f(Date)`, ... Only `new Date(x)`, `Date.<member>` and `instanceof Date`.
    selector:
      "Identifier[name='Date']:not(NewExpression > Identifier.callee):not(MemberExpression > Identifier.object):not(BinaryExpression > Identifier.right):not(MemberExpression > Identifier.property):not(Property > Identifier.key):not(TSTypeReference > Identifier.typeName)",
    message: 'Do not alias Date: it hides wall-clock access (ENGINEERING §3).',
  },
  {
    // `const M = Math; M.random()`, `const { random } = Math`, `Reflect.get(Math, 'random')`, ...
    selector: `Identifier[name=/^${NON_DETERMINISTIC_OBJECTS}$/]:not(MemberExpression > Identifier.object):not(MemberExpression > Identifier.property):not(Property > Identifier.key):not(TSTypeReference > Identifier.typeName)`,
    message:
      'Do not alias Math/crypto/performance: use them only via direct member access (ENGINEERING §3).',
  },
  {
    selector: `MemberExpression[computed=true][object.name=/^(Date|${NON_DETERMINISTIC_OBJECTS.slice(1)}$/][property.type!='Literal']`,
    message:
      'Computed access on Date/Math/crypto/performance hides banned members (ENGINEERING §3).',
  },
];

const LOCALE_MESSAGE =
  'Locale-dependent (ADR-0013 §D4.2): compare strings by code unit (a < b ? -1 : a > b ? 1 : 0).';

/** ADR-0013 §D4.1-3: selectors that apply to every deterministic file (shipped code and tests). */
const ADR_D4_SELECTORS = [
  {
    selector: 'MemberExpression[computed=false][property.name=/^(localeCompare|toLocale.*)$/]',
    message: LOCALE_MESSAGE,
  },
  {
    selector: 'MemberExpression[computed=true][property.value=/^(localeCompare|toLocale.*)$/]',
    message: LOCALE_MESSAGE,
  },
  {
    selector: "CallExpression[callee.property.name='normalize']",
    message:
      'String.prototype.normalize depends on Unicode tables (ADR-0013 §D4.2): engine data is ASCII.',
  },
  {
    selector: 'CallExpression[callee.property.name=/^(sort|toSorted)$/][arguments.length=0]',
    message:
      'sort() without a comparator orders by UTF-16 string conversion (ADR-0013 §D4.2-3): pass a total-order comparator.',
  },
  {
    selector:
      "CallExpression[callee.property.name=/^(sort|toSorted)$/][arguments.0.type='Identifier'][arguments.0.name='undefined']",
    message: 'sort(undefined) is sort() (ADR-0013 §D4.2-3): pass a total-order comparator.',
  },
  {
    selector: "BinaryExpression[operator='**']:not([left.type='Literal'][right.type='Literal'])",
    message:
      '`**` is allowed only between integer literals (ADR-0013 §D4.2): use integer multiplication or a lookup table.',
  },
  {
    selector: "AssignmentExpression[operator='**=']",
    message: '`**=` is banned (ADR-0013 §D4.2): use integer multiplication.',
  },
  {
    selector:
      'FunctionDeclaration[async=true], FunctionExpression[async=true], ArrowFunctionExpression[async=true]',
    message: 'async functions are banned in the engine and bots (ADR-0013 §D4.2).',
  },
  {
    selector: 'AwaitExpression, ForOfStatement[await=true]',
    message: 'await is banned in the engine and bots (ADR-0013 §D4.2).',
  },
  {
    selector: 'ImportExpression',
    message: 'Dynamic import() is async (ADR-0013 §D4.2): use static imports.',
  },
];

/** Shipped code only: tests probe invalid inputs (fractional values) and cross-check with BigInt oracles. */
const SHIPPED_SELECTORS = [
  {
    selector: 'Literal[bigint]',
    message: 'BigInt literals are banned outside tests (ADR-0013 §D4.2): use safe integers.',
  },
  {
    selector: 'TSBigIntKeyword',
    message: 'bigint is banned outside tests (ADR-0013 §D4.2): use safe integers.',
  },
  {
    selector: 'Literal[raw=/^(?!0[xXbBoO])(\\d*\\.|\\d+[eE]-)/]',
    message:
      'Fractional numeric literals are banned in engine source (ADR-0013 §D4.1): use rationals, floorDiv(a * num, den).',
  },
];

const DETERMINISM_PROPERTIES = [
  {
    object: 'Date',
    property: 'now',
    message: 'Non-deterministic: inject a Clock (ENGINEERING §3).',
  },
  {
    object: 'Math',
    property: 'random',
    message: 'Non-deterministic: use the injected seeded Rng (ENGINEERING §3).',
  },
  {
    object: 'crypto',
    property: 'randomUUID',
    message: 'Non-deterministic: derive ids from the seeded Rng (ENGINEERING §3).',
  },
  {
    object: 'crypto',
    property: 'getRandomValues',
    message: 'Non-deterministic: use the injected seeded Rng (ENGINEERING §3).',
  },
  {
    object: 'performance',
    property: 'now',
    message: 'Non-deterministic: inject a Clock (ENGINEERING §3).',
  },
];

/**
 * Determinism bans (ENGINEERING §3) for game-engine and bots; purity (import allow-list, IO globals)
 * for game-engine only. `basePath` anchors the globs at the repository root, so the bans apply
 * whatever the cwd / config location (per-package eslint.config.js, as under `turbo run lint`).
 */
export function gameEnginePreset(options: CodelexEslintOptions): Linter.Config[] {
  const basePath = options.repoRoot ?? findRepoRoot(options.tsconfigRootDir);
  return defineConfig(
    {
      basePath,
      files: DETERMINISTIC_FILES,
      rules: {
        'no-restricted-properties': ['error', ...DETERMINISM_PROPERTIES, ...FLOAT_PROPERTIES],
        'no-restricted-syntax': ['error', ...DETERMINISM_SELECTORS, ...ADR_D4_SELECTORS],
        'no-restricted-globals': ['error', ...GLOBAL_OBJECTS, ...DETERMINISM_GLOBALS],
      },
    },
    {
      // Shipped code (not tests): BigInt, fractional literals and JSON.stringify are banned as well.
      // These rule entries replace the ones above, so they repeat them.
      basePath,
      files: DETERMINISTIC_FILES,
      ignores: TEST_FILES,
      rules: {
        'no-restricted-properties': [
          'error',
          ...DETERMINISM_PROPERTIES,
          ...FLOAT_PROPERTIES,
          ...SHIPPED_PROPERTIES,
        ],
        'no-restricted-syntax': [
          'error',
          ...DETERMINISM_SELECTORS,
          ...ADR_D4_SELECTORS,
          ...SHIPPED_SELECTORS,
        ],
        'no-restricted-globals': [
          'error',
          ...GLOBAL_OBJECTS,
          ...DETERMINISM_GLOBALS,
          ...BIGINT_GLOBALS,
        ],
      },
    },
    {
      basePath,
      files: PURE_FILES,
      ignores: PURE_EXEMPT_FILES,
      plugins: { codelex: { rules: { 'pure-imports': pureImportsRule } } },
      rules: {
        'codelex/pure-imports': ['error', { allow: GAME_ENGINE_ALLOWED_IMPORTS }],
        'no-restricted-globals': [
          'error',
          ...GLOBAL_OBJECTS,
          ...DETERMINISM_GLOBALS,
          ...BIGINT_GLOBALS,
          ...IO_GLOBALS,
        ],
      },
    },
  );
}

/** Full CODELEX flat config. `prettier` is last so formatting rules never conflict. */
export function codelex(options: CodelexEslintOptions): Linter.Config[] {
  return defineConfig(
    genericPreset(options),
    boundariesPreset(options),
    gameEnginePreset(options),
    prettierConfig,
  );
}
