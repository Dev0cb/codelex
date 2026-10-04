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

/** `options.repoRoot`, or the nearest workspace root above `tsconfigRootDir` (shared by every preset). */
function repoRootOf(options: CodelexEslintOptions): string {
  return options.repoRoot ?? findRepoRoot(options.tsconfigRootDir);
}

const require = createRequire(import.meta.url);

const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];
const JS_FILES = ['**/*.{js,mjs,cjs}'];
const TEST_FILES = ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}'];
const TOOLING_FILES = ['**/*.config.{js,mjs,cjs,ts,mts}'];
const DETERMINISTIC_FILES = ['packages/game-engine/**', 'packages/bots/**'];
const PURE_FILES = ['packages/game-engine/**'];
/** ADR-0014 §D1: the one file allowed to tell rules versions apart. */
const RULES_REGISTRY_FILE = 'packages/game-engine/src/rules/registry.ts';
const ENGINE_SOURCE_FILES = ['packages/game-engine/src/**'];
/** ADR-0014 §D4: code that must never reach a draft rules version. */
const DRAFT_BANNED_FILES = ['apps/**', 'services/**'];
const DRAFT_ENTRY = '@codelex/game-engine/draft';
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
      'boundaries/root-path': repoRootOf(options),
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
  'queueMicrotask',
].map((name) => ({
  name,
  message: 'game-engine must be pure: no IO, timers or environment access (ENGINEERING §2, §3).',
}));

/** Allow-list of module specifiers (besides relative imports) for game-engine. */
const GAME_ENGINE_ALLOWED_IMPORTS = ['^@codelex/lexicon(/.*)?$', '^@codelex/config/result$'];

/**
 * ADR-0013 §D4.2/§D4.6: banned globals in every deterministic file (shipped code and tests). Date, crypto and
 * performance are banned outright (not only `now`/`random`): `new Date(0).getHours()`, `Date.parse`, `Date.UTC`,
 * `performance.timeOrigin`, `crypto.subtle` all depend on the host (time zone, clock, platform). Timers, `process`
 * and microtasks are included so that `packages/bots` (no import allow-list) cannot read clocks or schedule work.
 */
const DETERMINISM_GLOBALS = [
  ['Date', 'Date depends on the time zone and the wall clock (ADR-0013 §D4.2): inject a Clock.'],
  ['crypto', 'crypto is non-deterministic (ADR-0013 §D4.2): use the seeded Rng.'],
  ['performance', 'performance reads a clock (ADR-0013 §D4.2, §D4.6): bots use budgets, not time.'],
  ['Intl', 'Intl is locale- and ICU-dependent (ADR-0013 §D4.2): compare by code unit.'],
  [
    'TextEncoder',
    'TextEncoder is not available on every runtime (Hermes): encode ASCII by hand (ADR-0013 §D3, §D4.2).',
  ],
  ['TextDecoder', 'TextDecoder is not available on every runtime (Hermes): ADR-0013 §D3, §D4.2.'],
  ['parseFloat', 'Floats are banned (ADR-0013 §D4.1): parse integers explicitly.'],
  [
    'Reflect',
    'Reflect hides banned calls (Reflect.apply(Array.prototype.sort, ...)): ADR-0013 §D4.2.',
  ],
  ['WeakRef', 'WeakRef exposes garbage-collection timing (ADR-0013 §D4.4): not deterministic.'],
  [
    'FinalizationRegistry',
    'FinalizationRegistry exposes garbage-collection timing (ADR-0013 §D4.4): not deterministic.',
  ],
  ['process', 'process reads the environment and clocks (hrtime): ADR-0013 §D4.2, §D4.6.'],
  ['setTimeout', 'Timers read time (ADR-0013 §D4.6): bots stop on node/candidate budgets.'],
  ['setInterval', 'Timers read time (ADR-0013 §D4.6): bots stop on node/candidate budgets.'],
  ['setImmediate', 'Scheduling is async (ADR-0013 §D4.2): stay synchronous.'],
  ['queueMicrotask', 'Scheduling is async (ADR-0013 §D4.2): stay synchronous.'],
].map(([name, message]) => ({ name: name ?? '', message }));

/**
 * Shipped code only (tests may use `fc.asyncProperty`, `expect().resolves`, BigInt oracles). ADR-0013 §D4.2:
 * `BigInt` is banned "outside tests" and async code is banned. Value positions only for `Promise`: the
 * `async`/`await` selectors cover the syntax, `no-restricted-globals` also catches `Promise<T>` type references.
 */
const SHIPPED_GLOBALS = [
  ...['BigInt', 'BigInt64Array', 'BigUint64Array'].map((name) => ({
    name,
    message: 'BigInt is banned outside tests (ADR-0013 §D4.2): use safe integers (< 2^53).',
  })),
  {
    name: 'Promise',
    message: 'Async code is banned in the engine and bots (ADR-0013 §D4.2): stay synchronous.',
  },
];

/** Module specifiers (bare and `node:`) that give access to clocks, entropy, timers or threads. */
const BANNED_MODULES = [
  'crypto',
  'perf_hooks',
  'timers',
  'timers/promises',
  'worker_threads',
  'async_hooks',
].flatMap((name) => [name, `node:${name}`]);

/** Shipped code only: tests may import `node:crypto` as a hash oracle (the engine itself never does). */
const SHIPPED_RESTRICTED_IMPORTS = {
  paths: BANNED_MODULES.map((name) => ({
    name,
    message: `${name} gives access to entropy, clocks, timers or threads (ADR-0013 §D4.2, §D4.6).`,
  })),
};

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

/**
 * Attribute selectors matching a member whose name matches `re`, written as `.name`, `['name']` or
 * `[`name`]`. `prefix` is the path to the MemberExpression ('' for the node itself, 'callee.' for a call).
 */
function namedMember(prefix: string, re: string): string[] {
  return [
    `[${prefix}computed=false][${prefix}property.name=${re}]`,
    `[${prefix}computed=true][${prefix}property.value=${re}]`,
    `[${prefix}computed=true][${prefix}property.type='TemplateLiteral'][${prefix}property.quasis.0.value.cooked=${re}]`,
  ];
}

const LOCALE_RE = '/^(localeCompare|toLocale.*)$/';
const SORT_RE = '/^(sort|toSorted)$/';
const BANNED_METHOD_RE = '/^(sort|toSorted|localeCompare|normalize|toLocale.*)$/';
const SORT_MESSAGE =
  'sort() without a comparator orders by UTF-16 string conversion (ADR-0013 §D4.2-3): pass a total-order comparator.';

/** ADR-0013 §D4.1-3: selectors that apply to every deterministic file (shipped code and tests). */
const ADR_D4_SELECTORS = [
  ...namedMember('', LOCALE_RE).map((attrs) => ({
    selector: `MemberExpression${attrs}`,
    message: LOCALE_MESSAGE,
  })),
  ...namedMember('callee.', '/^normalize$/').map((attrs) => ({
    selector: `CallExpression${attrs}`,
    message:
      'String.prototype.normalize depends on Unicode tables (ADR-0013 §D4.2): engine data is ASCII.',
  })),
  ...namedMember('callee.', SORT_RE).flatMap((attrs) => [
    { selector: `CallExpression${attrs}[arguments.length=0]`, message: SORT_MESSAGE },
    {
      selector: `CallExpression${attrs}[arguments.0.type='SpreadElement']`,
      message: 'sort(...args) may be sort() (ADR-0013 §D4.2-3): pass a total-order comparator.',
    },
    {
      selector: `CallExpression${attrs}[arguments.0.type='Identifier'][arguments.0.name='undefined']`,
      message: 'sort(undefined) is sort() (ADR-0013 §D4.2-3): pass a total-order comparator.',
    },
    {
      selector: `CallExpression${attrs}[arguments.0.type='UnaryExpression'][arguments.0.operator='void']`,
      message: 'sort(void 0) is sort() (ADR-0013 §D4.2-3): pass a total-order comparator.',
    },
  ]),
  {
    // `[].sort.call(xs)`, `localeCompare.apply(...)`, `normalize.bind(s)`: indirect calls skip the checks above.
    selector: `MemberExpression[property.name=/^(call|apply|bind)$/] > MemberExpression.object${namedMember('', BANNED_METHOD_RE)[0] ?? ''}`,
    message:
      'Indirect call (.call/.apply/.bind) of sort/localeCompare/normalize hides the comparator checks (ADR-0013 §D4.2).',
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
];

/**
 * Shipped code only: tests probe invalid inputs (fractional values), cross-check with BigInt oracles and may use
 * async helpers (`fc.asyncProperty`, `expect().resolves`).
 */
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
    // `[\d_]*` accepts numeric separators: `1_000.5`, `1_0e-3`. Hex/octal/binary and `1e3` are integers.
    selector: 'Literal[raw=/^(?!0[xXbBoO])[\\d_]*(\\.|[eE]-)/]',
    message:
      'Fractional numeric literals are banned in engine source (ADR-0013 §D4.1): use rationals, floorDiv(a * num, den).',
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

/** One side of a comparison that reads a rules version: `x.engineRulesVersion`, `x['engineRulesVersion']`, a variable of that name, or any of them under `as`/`!`. */
function versionSide(side: string): string[] {
  const name = '/^(engineRulesVersion|ENGINE_RULES_VERSION)$/';
  return [side, `${side}.expression`].flatMap((path) => [
    `[${path}.name=${name}]`,
    `[${path}.property.name=${name}]`,
    `[${path}.property.value=${name}]`,
  ]);
}

/** The other side: a literal (`1`, `'2'`), possibly under `as`, or the deprecated `ENGINE_RULES_VERSION`. */
function constantSide(side: string): string[] {
  return [
    `[${side}.type='Literal']`,
    `[${side}.expression.type='Literal']`,
    `[${side}.name='ENGINE_RULES_VERSION']`,
    `[${side}.property.name='ENGINE_RULES_VERSION']`,
  ];
}

const VERSION_MESSAGE =
  'Rules versions differ in data only (ADR-0014 §D1): resolve rulesFor(x.engineRulesVersion) / resolveRules once and read the RulesSet; only rules/registry.ts may compare versions.';
const COMPARISON = 'BinaryExpression[operator=/^([=!]==?|[<>]=?)$/]';

/** ADR-0014 §D1: no `engineRulesVersion` comparison with a constant, and no `switch` on it, in engine source. */
const VERSION_SELECTORS = [
  {
    selector: `${COMPARISON}:matches(${versionSide('left').join(', ')}):matches(${constantSide('right').join(', ')})`,
    message: VERSION_MESSAGE,
  },
  {
    selector: `${COMPARISON}:matches(${constantSide('left').join(', ')}):matches(${versionSide('right').join(', ')})`,
    message: VERSION_MESSAGE,
  },
  {
    selector: `SwitchStatement:matches(${versionSide('discriminant').join(', ')})`,
    message: VERSION_MESSAGE,
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

/** First entry wins, so the determinism message is the one reported for names present in several lists. */
function uniqueByName<T extends { name: string }>(entries: readonly T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => !seen.has(entry.name) && !!seen.add(entry.name));
}

/**
 * Determinism bans (ENGINEERING §3) for game-engine and bots; purity (import allow-list, IO globals)
 * for game-engine only. `basePath` anchors the globs at the repository root, so the bans apply
 * whatever the cwd / config location (per-package eslint.config.js, as under `turbo run lint`).
 */
export function gameEnginePreset(options: CodelexEslintOptions): Linter.Config[] {
  const basePath = repoRootOf(options);
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
          ...SHIPPED_GLOBALS,
        ],
        'no-restricted-imports': ['error', SHIPPED_RESTRICTED_IMPORTS],
      },
    },
    {
      // ADR-0014 §D1: shipped engine source outside the registry never branches on a rules version. Repeats the
      // shipped selectors above, because this entry replaces them for these files.
      basePath,
      files: ENGINE_SOURCE_FILES,
      ignores: [...TEST_FILES, RULES_REGISTRY_FILE],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...DETERMINISM_SELECTORS,
          ...ADR_D4_SELECTORS,
          ...SHIPPED_SELECTORS,
          ...VERSION_SELECTORS,
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
          ...uniqueByName([
            ...GLOBAL_OBJECTS,
            ...DETERMINISM_GLOBALS,
            ...SHIPPED_GLOBALS,
            ...IO_GLOBALS,
          ]),
        ],
      },
    },
  );
}

/**
 * ADR-0014 §D4: apps and services never import the draft opt-in token (`@codelex/game-engine/draft`), so a draft
 * rules version can never be created, resumed or replayed by them. Allowed elsewhere (simulator, engine and bot
 * tests); `packages/bots/src` bans every engine subpath but `./rng` in its own config.
 */
export function draftRulesPreset(options: CodelexEslintOptions): Linter.Config[] {
  const basePath = repoRootOf(options);
  const message =
    'Draft rules versions are for the simulator and engine tests only (ADR-0014 §D4): apps and services pin a frozen engineRulesVersion.';
  return defineConfig({
    basePath,
    files: DRAFT_BANNED_FILES,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: DRAFT_ENTRY, message }],
          patterns: [{ group: [`${DRAFT_ENTRY}/*`, '@codelex/game-engine/dist/*'], message }],
        },
      ],
    },
  });
}

/** Full CODELEX flat config. `prettier` is last so formatting rules never conflict. */
export function codelex(options: CodelexEslintOptions): Linter.Config[] {
  return defineConfig(
    genericPreset(options),
    boundariesPreset(options),
    gameEnginePreset(options),
    draftRulesPreset(options),
    prettierConfig,
  );
}
